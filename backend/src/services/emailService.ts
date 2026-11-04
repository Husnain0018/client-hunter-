import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { cleanEmailHtml } from '../security/sanitize.js';
import { EmailValidationService } from './emailValidationService.js';

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured on the backend. Please configure SMTP credentials or use the direct Gmail compose link.');
  }
}

export class RecipientValidationError extends Error {
  constructor(message: string, public readonly actionAdvice?: string) {
    super(message);
    this.name = 'RecipientValidationError';
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  messageId: string;
  response: string;
  accepted: string[];
  rejected: string[];
  envelope: {
    from: string;
    to: string[];
  };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // 1. Check SMTP configuration
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) {
    throw new EmailNotConfiguredError();
  }

  // 2. Validate recipient address (DNS MX check & dummy domain protection)
  const validation = await EmailValidationService.validateRecipient(input.to, true);
  if (!validation.valid) {
    throw new RecipientValidationError(
      validation.reason || `Recipient address "${input.to}" is invalid or unreachable.`,
      validation.recommendedAction || 'Please verify the recipient email address or apply via the official company careers portal.'
    );
  }

  // 3. Configure transport with robust timeouts
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
    connectionTimeout: 12_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      // Local development network handling
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });

  // 4. Construct RFC-compliant multipart message
  const fromAddress = env.SMTP_FROM.includes('<')
    ? env.SMTP_FROM
    : `"Client Hunter" <${env.SMTP_USER}>`;

  const replyToAddress = input.replyTo && input.replyTo.includes('@')
    ? input.replyTo
    : env.SMTP_USER;

  const result = await transport.sendMail({
    from: fromAddress,
    to: input.to.trim(),
    replyTo: replyToAddress,
    subject: input.subject.trim(),
    text: input.text.trim(),
    html: cleanEmailHtml(input.html),
    attachments: input.attachments,
    headers: {
      'X-Mailer': 'Client Hunter AI Job Finder',
      'X-Application-Type': 'Employment-Application',
    },
  });

  return {
    messageId: result.messageId,
    response: result.response || '250 2.0.0 OK Handshake Accepted',
    accepted: (result.accepted as string[]) || [input.to],
    rejected: (result.rejected as string[]) || [],
    envelope: {
      from: result.envelope?.from || env.SMTP_USER,
      to: (result.envelope?.to as string[]) || [input.to],
    },
  };
}
