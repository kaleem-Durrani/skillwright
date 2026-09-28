import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../env.js';
import { sha256 } from './crypto.js';
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
 *
 * EVERY send is logged, and that is the observability this module was missing. The
 * recurring support question for this product is "I pressed resend and never got
 * anything", and before this line there was no way to answer it: a successful send
 * produced no output at all, so a log search could not distinguish "never sent" from
 * "sent and lost by the relay". One line per attempt, either way, with the requestId
 * the mixin binds from the ambient context — so the whole exchange is
 * `grep <requestId>` and the answer includes whether SMTP was reached at all.
 *
 * The recipient is a HASH, not an address. The address is personal data and the
 * logger's redact list is a field-name list (`REDACT_PATHS` in logger.ts), so a field
 * called `to` would have to be added there to be protected; a `sha256` prefix is
 * correlating — the same address hashes the same way, so two sends to one person join
 * up — without being readable. The domain is kept separately because "did mail to
 * this school go out" is the question an operator actually asks and a bare hash
 * cannot answer it.
 */
export async function sendMail(mail: OutboundMail): Promise<void> {
  const recipient = {
    recipientHash: sha256(mail.to.toLowerCase()).slice(0, 16),
    recipientDomain: mail.to.slice(mail.to.lastIndexOf('@')),
    subject: mail.subject,
  };

  if (isTest) {
    outbox.push(mail);
    log.info({ ...recipient, transport: 'test-outbox' }, 'mail captured by the test outbox');
    return;
  }
  try {
    const result = await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    log.info(
      {
        ...recipient,
        transport: 'smtp',
        messageId: result.messageId,
        accepted: result.accepted.length,
      },
      'mail handed to the relay',
    );
  } catch (error) {
    log.error({ err: error, ...recipient, transport: 'smtp' }, 'mail delivery failed');
  }
}

export async function closeMailer(): Promise<void> {
  transporter?.close();
  transporter = null;
}
