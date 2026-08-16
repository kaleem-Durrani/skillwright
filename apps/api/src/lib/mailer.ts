import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../env.js';
import { baseLogger } from './logger.js';

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

const log = baseLogger.child({ module: 'mailer' });

/**
 * In tests the transport is replaced by an in-memory outbox so integration tests can
 * read the 6-digit code the user would have received, without SMTP or polling Mailpit.
 */
const outbox: OutboundMail[] = [];

export const testOutbox = {
  all: (): readonly OutboundMail[] => outbox,
  clear: (): void => {
    outbox.length = 0;
  },
  lastFor(to: string): OutboundMail | undefined {
    const needle = to.toLowerCase();
    for (let i = outbox.length - 1; i >= 0; i -= 1) {
      if (outbox[i]!.to.toLowerCase() === needle) return outbox[i];
    }
    return undefined;
  },
  /** Pulls the one 6-digit group out of the most recent mail to this address. */
  lastCodeFor(to: string): string | undefined {
    return this.lastFor(to)?.text.match(/\b(\d{6})\b/)?.[1];
  },
};

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    // Mailpit and most dev relays present a self-signed certificate.
    tls: { rejectUnauthorized: env.DEPLOY_ENV === 'production' },
  });
  return transporter;
}

/**
 * Never rejects. A transient SMTP failure must not turn a successful registration
 * into a 500 — the user can always ask for another code.
 */
export async function sendMail(mail: OutboundMail): Promise<void> {
  if (isTest) {
    outbox.push(mail);
    return;
  }
  try {
    await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  } catch (error) {
    log.error({ err: error, subject: mail.subject }, 'mail delivery failed');
  }
}

export async function closeMailer(): Promise<void> {
  transporter?.close();
  transporter = null;
}
