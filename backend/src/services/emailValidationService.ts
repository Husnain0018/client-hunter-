import dns from 'node:dns/promises';

/**
 * Known placeholder, dummy, documentation, or tech-infrastructure domains
 * that should never be targeted for job application emails.
 */
export const DUMMY_OR_PLACEHOLDER_DOMAINS = new Set([
  'company.com',
  'example.com',
  'example.org',
  'example.net',
  'examplecompany.com',
  'sample.com',
  'test.com',
  'testing.com',
  'domain.com',
  'yourdomain.com',
  'mycompany.com',
  'acme.com',
  'email.com',
  'mail.com',
  'dummy.com',
  'temp.com',
  'fake.com',
  'placeholder.com',
  'localhost',
  'invalid',
  // Documentation / specification sites
  'w3.org',
  'schema.org',
  // Error reporting / tech telemetry
  'sentry.io',
  'sentry.wixpress.com',
  'wixpress.com',
  'cloudflare.com',
  'googleapis.com',
  'googleusercontent.com',
  'gravatar.com',
  'wordpress.org',
  'wp.com',
  // Portals that do not accept incoming email applications at their domain root
  'remoteok.com',
  'jobicy.com',
  'arbeitnow.com',
  'weworkremotely.com',
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'github.com',
  'gitlab.com',
]);

/**
 * System and non-recruitment prefixes that indicate administrative, automated,
 * or customer support addresses rather than a hiring manager or recruitment team.
 */
export const BLOCKED_EMAIL_PREFIXES = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
  'abuse',
  'hostmaster',
  'root',
  'privacy',
  'legal',
  'security',
  'admin',
  'administrator',
  'webmaster',
  'support',
  'help',
  'billing',
  'payments',
  'sales',
  'press',
  'media',
  'investors',
  'investor',
  'feedback',
]);

export interface EmailValidationResult {
  valid: boolean;
  email: string;
  domain: string;
  localPart: string;
  isDummyDomain: boolean;
  isBlockedPrefix: boolean;
  mxValid: boolean;
  mxRecords?: string[];
  reason?: string;
  recommendedAction?: string;
}

export class EmailValidationService {
  /**
   * Checks whether a domain is a placeholder, dummy, or blocked infrastructure domain.
   */
  public static isDummyOrPlaceholderDomain(domain: string): boolean {
    const clean = domain.trim().toLowerCase();
    if (DUMMY_OR_PLACEHOLDER_DOMAINS.has(clean)) return true;

    for (const d of DUMMY_OR_PLACEHOLDER_DOMAINS) {
      if (clean.endsWith(`.${d}`)) return true;
    }

    if (clean.endsWith('.example') || clean.endsWith('.test') || clean.endsWith('.invalid') || clean.endsWith('.local')) {
      return true;
    }

    return false;
  }

  /**
   * Checks whether an email prefix is a blocked system / non-recruitment prefix.
   */
  public static isBlockedPrefix(localPart: string): boolean {
    const clean = localPart.trim().toLowerCase();
    const token = clean.split(/[._+-]/)[0];
    return BLOCKED_EMAIL_PREFIXES.has(clean) || BLOCKED_EMAIL_PREFIXES.has(token);
  }

  /**
   * Resolves MX records for a domain to verify that it can receive email.
   */
  public static async verifyDomainMx(domain: string, timeoutMs = 4000): Promise<{ valid: boolean; mxRecords?: string[]; error?: string }> {
    const clean = domain.trim().toLowerCase();

    // Fast-path for dummy domains
    if (this.isDummyOrPlaceholderDomain(clean)) {
      return {
        valid: false,
        error: `Domain "${clean}" is a placeholder or documentation domain without active mail reception.`,
      };
    }

    try {
      const resolvePromise = dns.resolveMx(clean);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('DNS MX resolution timed out')), timeoutMs);
      });

      const records = await Promise.race([resolvePromise, timeoutPromise]);
      if (!records || records.length === 0) {
        return {
          valid: false,
          error: `Domain "${clean}" does not have any active mail exchanger (MX) records.`,
        };
      }

      const mxHosts = records
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange);

      return {
        valid: true,
        mxRecords: mxHosts,
      };
    } catch (err: any) {
      const code = err.code || err.message;
      if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL') {
        return {
          valid: false,
          error: `Domain "${clean}" could not be resolved or has no mail exchange records (${code}).`,
        };
      }
      return {
        valid: false,
        error: `DNS lookup for "${clean}" failed: ${err.message}`,
      };
    }
  }

  /**
   * Full validation pipeline for an application recipient email:
   * 1. RFC syntax & length checks
   * 2. Placeholder / dummy domain blocklist check
   * 3. Prefix classification
   * 4. Live DNS MX verification
   */
  public static async validateRecipient(email: string, verifyMx = true): Promise<EmailValidationResult> {
    const clean = (email || '').trim().toLowerCase();

    if (!clean || clean.length > 120) {
      return {
        valid: false,
        email: clean,
        domain: '',
        localPart: '',
        isDummyDomain: false,
        isBlockedPrefix: false,
        mxValid: false,
        reason: 'Email address is missing or exceeds maximum character length.',
        recommendedAction: 'Provide a valid email address formatted as user@domain.com.',
      };
    }

    const emailRegex = /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/;
    const match = clean.match(emailRegex);
    if (!match) {
      return {
        valid: false,
        email: clean,
        domain: '',
        localPart: '',
        isDummyDomain: false,
        isBlockedPrefix: false,
        mxValid: false,
        reason: `Invalid email address syntax: "${clean}".`,
        recommendedAction: 'Check for typos or formatting errors before submitting.',
      };
    }

    const [localPart, domain] = clean.split('@');

    // 1. Placeholder / Dummy Domain Check
    const isDummyDomain = this.isDummyOrPlaceholderDomain(domain);
    if (isDummyDomain) {
      return {
        valid: false,
        email: clean,
        domain,
        localPart,
        isDummyDomain: true,
        isBlockedPrefix: false,
        mxValid: false,
        reason: `"${domain}" is a generic placeholder or documentation domain (such as company.com or example.com). Emails sent to this address will bounce or fail delivery.`,
        recommendedAction: 'Do not email placeholder addresses. If the employer uses an ATS or career portal, apply directly via their official application link.',
      };
    }

    // 2. Blocked Prefix Check
    const isBlockedPrefix = this.isBlockedPrefix(localPart);
    if (isBlockedPrefix) {
      return {
        valid: false,
        email: clean,
        domain,
        localPart,
        isDummyDomain: false,
        isBlockedPrefix: true,
        mxValid: false,
        reason: `"${localPart}@" is an automated system, support, or privacy mailbox, not a hiring manager or recruitment contact.`,
        recommendedAction: 'Use an official recruitment address (e.g. careers@, jobs@, hr@, talent@, hiring@) or apply via the employer career portal.',
      };
    }

    // 3. DNS MX Check
    if (verifyMx) {
      const mxResult = await this.verifyDomainMx(domain);
      if (!mxResult.valid) {
        return {
          valid: false,
          email: clean,
          domain,
          localPart,
          isDummyDomain: false,
          isBlockedPrefix: false,
          mxValid: false,
          reason: mxResult.error || `Recipient domain "${domain}" has no reachable mail servers.`,
          recommendedAction: 'Verify the company domain or apply via the official job portal link.',
        };
      }

      return {
        valid: true,
        email: clean,
        domain,
        localPart,
        isDummyDomain: false,
        isBlockedPrefix: false,
        mxValid: true,
        mxRecords: mxResult.mxRecords,
      };
    }

    return {
      valid: true,
      email: clean,
      domain,
      localPart,
      isDummyDomain: false,
      isBlockedPrefix: false,
      mxValid: true,
    };
  }
}
