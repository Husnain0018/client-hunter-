import tls from 'node:tls';
import { env } from '../config/env.js';
import type { Database } from '../db/database.js';
import type { JobApplication, JobApplicationStatus } from '../types/domain.js';

export interface BounceDetectionResult {
  messageNumber: number;
  recipientEmail: string;
  originalSubject: string;
  bounceDate: string;
  smtpStatusCode?: string;
  failureReason: string;
  failureType: 'domain_unreachable' | 'user_unknown' | 'mailbox_full' | 'spam_rejected' | 'timeout' | 'other';
  recommendedAction: string;
  rawSnippet: string;
}

export interface SentVerificationResult {
  found: boolean;
  recipientEmail: string;
  subject?: string;
  date?: string;
}

export interface EmployerReplyDetection {
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  matchedApplicationId?: string;
}

export interface SyncSummary {
  bouncesDetected: number;
  bouncesApplied: number;
  sentConfirmed: number;
  repliesDetected: number;
  details: string[];
}

export class GmailSyncService {
  /**
   * Helper to execute IMAP commands over a secure TLS session.
   */
  private static async executeImapSession<T>(
    runner: (session: {
      send: (cmd: string) => Promise<{ tag: string; lines: string[]; ok: boolean }>;
    }) => Promise<T>,
    timeoutMs = 15000
  ): Promise<T> {
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
      throw new Error('Gmail credentials (SMTP_USER and SMTP_PASSWORD) are not configured.');
    }

    return new Promise<T>((resolve, reject) => {
      let resolved = false;
      let timer: NodeJS.Timeout | null = null;

      const client = tls.connect(
        993,
        'imap.gmail.com',
        {
          rejectUnauthorized: false,
        },
        () => {}
      );

      client.setEncoding('utf8');

      let tagCounter = 1;
      let buffer = '';
      let activeCommand: {
        tag: string;
        resolve: (val: { tag: string; lines: string[]; ok: boolean }) => void;
        lines: string[];
      } | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        try {
          client.end();
          client.destroy();
        } catch {}
      };

      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('IMAP connection timed out'));
        }
      }, timeoutMs);

      client.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      });

      client.on('data', (chunk) => {
        buffer += chunk;
        const parts = buffer.split('\r\n');
        buffer = parts.pop() || '';

        for (const line of parts) {
          if (activeCommand) {
            activeCommand.lines.push(line);
            if (line.startsWith(`${activeCommand.tag} OK`)) {
              const res = activeCommand;
              activeCommand = null;
              res.resolve({ tag: res.tag, lines: res.lines, ok: true });
            } else if (line.startsWith(`${activeCommand.tag} NO`) || line.startsWith(`${activeCommand.tag} BAD`)) {
              const res = activeCommand;
              activeCommand = null;
              res.resolve({ tag: res.tag, lines: res.lines, ok: false });
            }
          }
        }
      });

      const send = (cmd: string): Promise<{ tag: string; lines: string[]; ok: boolean }> => {
        return new Promise((cmdResolve) => {
          const tag = `T${tagCounter++}`;
          activeCommand = { tag, resolve: cmdResolve, lines: [] };
          client.write(`${tag} ${cmd}\r\n`);
        });
      };

      // Wait for initial greeting before starting session
      const onGreeting = async () => {
        try {
          // 1. Authenticate with Gmail
          const loginRes = await send(`LOGIN ${env.SMTP_USER} "${env.SMTP_PASSWORD}"`);
          if (!loginRes.ok) {
            throw new Error(`Gmail IMAP login failed: ${loginRes.lines.join(' ')}`);
          }

          // 2. Execute session actions
          const result = await runner({ send });

          // 3. Logout
          await send('LOGOUT').catch(() => null);

          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(result);
          }
        } catch (sessionErr) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(sessionErr);
          }
        }
      };

      // Wait a moment for the server greeting line
      setTimeout(() => {
        void onGreeting();
      }, 300);
    });
  }

  /**
   * Scans Gmail Inbox for Mailer-Daemon and Delivery Status Notifications (DSNs).
   */
  public static async scanForBounces(): Promise<BounceDetectionResult[]> {
    return this.executeImapSession(async ({ send }) => {
      const selectRes = await send('SELECT INBOX');
      if (!selectRes.ok) return [];

      // Search for bounce messages from mailer-daemon or DSN notifications
      const searchRes = await send('SEARCH OR (FROM "mailer-daemon@googlemail.com") (FROM "postmaster")');
      const searchLines = searchRes.lines.filter((l) => l.startsWith('* SEARCH'));
      if (searchLines.length === 0) return [];

      const rawIds = searchLines.join(' ').replace(/\* SEARCH/g, '').trim().split(/\s+/).filter(Boolean);
      if (rawIds.length === 0) return [];

      // Look at the latest 15 bounce messages
      const recentIds = rawIds.slice(-15);
      const results: BounceDetectionResult[] = [];

      for (const msgId of recentIds) {
        try {
          const fetchRes = await send(`FETCH ${msgId} (BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)] BODY[TEXT]<0.4000>)`);
          const fullText = fetchRes.lines.join('\n');

          // Check if this bounce mentions a recipient email
          const emailMatch =
            fullText.match(/delivering your message to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) ||
            fullText.match(/failed for the following addresses:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) ||
            fullText.match(/Action:\s*failed[\s\S]*?Final-Recipient:\s*rfc822;\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) ||
            fullText.match(/To:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

          const recipient = emailMatch ? emailMatch[1].toLowerCase().trim() : '';
          if (!recipient) continue;

          // Subject match
          const subjectMatch = fullText.match(/Subject:\s*([^\r\n]+)/i);
          const originalSubject = subjectMatch ? subjectMatch[1].trim() : 'Job Application';

          // Date match
          const dateMatch = fullText.match(/Date:\s*([^\r\n]+)/i);
          const bounceDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

          // Classify failure cause
          let failureType: BounceDetectionResult['failureType'] = 'other';
          let failureReason = 'Delivery could not be completed by mail server.';
          let smtpCode: string | undefined;
          let recommendedAction = 'Verify recipient email or apply through the official company careers portal.';

          if (/timed out|timeout|did not accept our requests to connect/i.test(fullText)) {
            failureType = 'timeout';
            const domain = recipient.split('@')[1] || '';
            failureReason = `Recipient server for "${domain}" did not accept connections (Connection timed out). The domain has no reachable mail servers.`;
            recommendedAction = `Do not email ${recipient}. Apply directly via the company's official job portal or verified career site.`;
          } else if (/does not exist|user unknown|mailbox not found|no such user|550 5\.1\.1/i.test(fullText)) {
            failureType = 'user_unknown';
            smtpCode = '550';
            failureReason = `Mailbox "${recipient}" does not exist on the target mail server (550 User unknown).`;
            recommendedAction = 'Verify the email spelling or find an updated recruitment email address.';
          } else if (/mailbox full|quota exceeded|storage full|452|552/i.test(fullText)) {
            failureType = 'mailbox_full';
            smtpCode = '552';
            failureReason = `The recipient's inbox is full and cannot accept incoming messages at this time.`;
            recommendedAction = 'Reach out to the recruiter via LinkedIn or try applying again later.';
          } else if (/spam|blocked|policy violation|reputation|554|571/i.test(fullText)) {
            failureType = 'spam_rejected';
            smtpCode = '554';
            failureReason = `The recipient mail server rejected the email due to spam filters or domain reputation policy.`;
            recommendedAction = 'Apply via the employer portal or contact the hiring manager directly on LinkedIn.';
          } else if (/host not found|domain name not found|dns/i.test(fullText)) {
            failureType = 'domain_unreachable';
            failureReason = `The recipient domain could not be resolved in DNS.`;
            recommendedAction = 'The domain is invalid. Apply via the official company careers link.';
          }

          results.push({
            messageNumber: Number(msgId),
            recipientEmail: recipient,
            originalSubject,
            bounceDate,
            smtpStatusCode: smtpCode,
            failureReason,
            failureType,
            recommendedAction,
            rawSnippet: fullText.slice(0, 400),
          });
        } catch {
          // ignore single message fetch error
        }
      }

      return results;
    });
  }

  /**
   * Checks whether an application email is present in the Gmail Sent Mail folder.
   */
  public static async verifySentInGmail(recipientEmail: string): Promise<SentVerificationResult> {
    const cleanRecipient = recipientEmail.trim().toLowerCase();

    return this.executeImapSession(async ({ send }) => {
      const selectRes = await send('SELECT "[Gmail]/Sent Mail"');
      if (!selectRes.ok) {
        return { found: false, recipientEmail: cleanRecipient };
      }

      const searchRes = await send(`SEARCH TO "${cleanRecipient}"`);
      const searchLines = searchRes.lines.filter((l) => l.startsWith('* SEARCH'));
      const rawIds = searchLines.join(' ').replace(/\* SEARCH/g, '').trim().split(/\s+/).filter(Boolean);

      if (rawIds.length === 0) {
        return { found: false, recipientEmail: cleanRecipient };
      }

      const lastId = rawIds[rawIds.length - 1];
      const fetchRes = await send(`FETCH ${lastId} (BODY[HEADER.FIELDS (SUBJECT DATE)])`);
      const text = fetchRes.lines.join('\n');
      const subjMatch = text.match(/Subject:\s*([^\r\n]+)/i);
      const dateMatch = text.match(/Date:\s*([^\r\n]+)/i);

      return {
        found: true,
        recipientEmail: cleanRecipient,
        subject: subjMatch ? subjMatch[1].trim() : undefined,
        date: dateMatch ? new Date(dateMatch[1]).toISOString() : undefined,
      };
    });
  }

  /**
   * Scans Gmail Inbox for non-automated employer replies to submitted applications.
   */
  public static async scanForEmployerReplies(knownApplicationEmails: string[]): Promise<EmployerReplyDetection[]> {
    if (knownApplicationEmails.length === 0) return [];

    return this.executeImapSession(async ({ send }) => {
      const selectRes = await send('SELECT INBOX');
      if (!selectRes.ok) return [];

      const replies: EmployerReplyDetection[] = [];

      for (const targetEmail of knownApplicationEmails.slice(0, 10)) {
        const clean = targetEmail.trim().toLowerCase();
        const searchRes = await send(`SEARCH FROM "${clean}"`);
        const searchLines = searchRes.lines.filter((l) => l.startsWith('* SEARCH'));
        const rawIds = searchLines.join(' ').replace(/\* SEARCH/g, '').trim().split(/\s+/).filter(Boolean);

        for (const id of rawIds.slice(-2)) {
          const fetchRes = await send(`FETCH ${id} (BODY[HEADER.FIELDS (SUBJECT FROM DATE)] BODY[TEXT]<0.1000>)`);
          const text = fetchRes.lines.join('\n');
          const subjMatch = text.match(/Subject:\s*([^\r\n]+)/i);
          const dateMatch = text.match(/Date:\s*([^\r\n]+)/i);

          replies.push({
            fromEmail: clean,
            subject: subjMatch ? subjMatch[1].trim() : 'Response to your application',
            date: dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
            snippet: text.slice(0, 300),
          });
        }
      }

      return replies;
    });
  }

  /**
   * Complete database synchronization:
   * 1. Inspects Gmail Inbox for any bounce notifications and updates matched applications.
   * 2. Inspects Gmail Sent Mail to verify dispatches for applications marked as 'opened_in_gmail' or 'sending'.
   * 3. Inspects Gmail Inbox for employer replies and creates employer response records.
   */
  public static async syncApplicationsWithGmail(db: Database): Promise<SyncSummary> {
    const summary: SyncSummary = {
      bouncesDetected: 0,
      bouncesApplied: 0,
      sentConfirmed: 0,
      repliesDetected: 0,
      details: [],
    };

    const applications = db.listJobApplications();
    const now = new Date().toISOString();

    // =========================================================================
    // 1. Process Bounces
    // =========================================================================
    try {
      const bounces = await this.scanForBounces();
      summary.bouncesDetected = bounces.length;

      for (const bounce of bounces) {
        // Find matching application by recipientEmail
        const matched = applications.find(
          (a) =>
            a.recipientEmail &&
            a.recipientEmail.toLowerCase().trim() === bounce.recipientEmail.toLowerCase().trim()
        );

        if (matched) {
          // If not already marked as bounced
          if (matched.status !== 'bounced') {
            summary.bouncesApplied++;
            const updatedApp: JobApplication = {
              ...matched,
              status: 'bounced' as JobApplicationStatus,
              deliveryStatus: 'bounced',
              failureReason: bounce.failureReason,
              updatedAt: now,
            };
            db.saveJobApplication(updatedApp);

            db.addApplicationActivityEvent(matched.id, {
              date: now.slice(0, 10),
              time: now.slice(11, 16),
              activity: `Delivery Failed / Email Bounced (${bounce.failureType.toUpperCase().replace(/_/g, ' ')})`,
              details: `${bounce.failureReason} • Recommended Action: ${bounce.recommendedAction}`,
              icon: 'alert-triangle',
            });

            db.addJobNotification({
              type: 'application_submitted',
              title: `Email Bounced: ${matched.job?.company || bounce.recipientEmail}`,
              message: `Delivery to ${bounce.recipientEmail} failed: ${bounce.failureReason}`,
              jobId: matched.jobId,
            });

            summary.details.push(
              `Application for ${matched.job?.company || matched.jobId} marked as BOUNCED (Recipient: ${bounce.recipientEmail})`
            );
          }
        }
      }
    } catch (err: any) {
      summary.details.push(`Bounce scan note: ${err.message}`);
    }

    // =========================================================================
    // 2. Verify Sent Folder for applications awaiting confirmation
    // =========================================================================
    const awaitingConfirmation = applications.filter(
      (a) =>
        (a.status === 'opened_in_gmail' || a.deliveryStatus === 'opened_in_gmail' || a.status === 'awaiting_approval') &&
        a.recipientEmail
    );

    for (const app of awaitingConfirmation) {
      if (!app.recipientEmail) continue;
      try {
        const verifyRes = await this.verifySentInGmail(app.recipientEmail);
        if (verifyRes.found) {
          summary.sentConfirmed++;
          const updatedApp: JobApplication = {
            ...app,
            status: 'sent',
            deliveryStatus: 'sent',
            sentAt: verifyRes.date || now,
            updatedAt: now,
          };
          db.saveJobApplication(updatedApp);

          db.addApplicationActivityEvent(app.id, {
            date: now.slice(0, 10),
            time: now.slice(11, 16),
            activity: 'Email Transmission Verified in Gmail Sent Mail',
            details: `Found outgoing email to ${app.recipientEmail} in user's connected Gmail account.`,
            icon: 'check-circle',
          });

          summary.details.push(`Sent confirmation verified for ${app.job?.company || app.jobId}`);
        }
      } catch (err: any) {
        summary.details.push(`Sent verification note for ${app.recipientEmail}: ${err.message}`);
      }
    }

    // =========================================================================
    // 3. Check Employer Replies
    // =========================================================================
    const activeSentRecipients = Array.from(
      new Set(
        applications
          .filter((a) => a.recipientEmail && (a.status === 'sent' || a.status === 'delivery_confirmed'))
          .map((a) => a.recipientEmail as string)
      )
    );

    if (activeSentRecipients.length > 0) {
      try {
        const replies = await this.scanForEmployerReplies(activeSentRecipients);
        summary.repliesDetected = replies.length;

        for (const reply of replies) {
          const matchedApp = applications.find(
            (a) => a.recipientEmail && a.recipientEmail.toLowerCase() === reply.fromEmail.toLowerCase()
          );

          if (matchedApp) {
            // Check if already logged
            const existingReplies = matchedApp.employerResponses || [];
            const alreadyLogged = existingReplies.some(
              (r: any) => r.subject === reply.subject && r.fromEmail === reply.fromEmail
            );

            if (!alreadyLogged) {
              db.addEmployerResponse(matchedApp.id, {
                fromEmail: reply.fromEmail,
                subject: reply.subject,
                body: reply.snippet,
                receivedAt: reply.date,
                category: /interview/i.test(reply.subject + ' ' + reply.snippet) ? 'interview_invite' : 'general',
              });

              db.updateJobApplicationStatus(matchedApp.id, 'replied');

              db.addJobNotification({
                type: 'interview',
                title: `New Employer Reply: ${matchedApp.job?.company || 'Company'}`,
                message: `Subject: "${reply.subject}" from ${reply.fromEmail}`,
                jobId: matchedApp.jobId,
              });

              summary.details.push(`Logged new employer reply from ${reply.fromEmail}`);
            }
          }
        }
      } catch (err: any) {
        summary.details.push(`Employer reply scan note: ${err.message}`);
      }
    }

    return summary;
  }
}
