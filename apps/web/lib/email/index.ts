import 'server-only';
import { serverEnv } from '../env';
import {
  MailpitEmailSender,
  RedirectingEmailSender,
  ResendEmailSender,
  type EmailSender,
} from './sender';

/** The configured email transport (EMAIL_TRANSPORT): Resend, or Mailpit for local dev/e2e. */
export function emailSender(): EmailSender {
  const env = serverEnv();
  const sender = transport();
  return env.EMAIL_REDIRECT_TO ? new RedirectingEmailSender(sender, env.EMAIL_REDIRECT_TO) : sender;
}

function transport(): EmailSender {
  const env = serverEnv();
  if (env.EMAIL_TRANSPORT === 'mailpit') {
    if (!env.MAILPIT_URL) throw new Error('MAILPIT_URL is required when EMAIL_TRANSPORT=mailpit');
    return new MailpitEmailSender(env.MAILPIT_URL, env.EMAIL_FROM);
  }
  return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
}
