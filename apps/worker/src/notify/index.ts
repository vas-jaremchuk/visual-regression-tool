import { decryptSecret, postSlackWebhook, sendResendEmail } from '@vrt/shared';
import { getConfig, type Env } from '../env';
import { createLogger } from '../logger';
import { createServiceClient } from '../supabase';
import { createProjectNotifier, type ProjectNotifier } from './notifier';
import { supabaseNotifyStore } from './supabase-notify-store';

/** The notifier the workflows use: Resend for email, Slack webhooks, log in Supabase. */
export function projectNotifier(env: Env): ProjectNotifier {
  const config = getConfig(env);
  const send = (input: string, init?: RequestInit) => fetch(input, init);
  return createProjectNotifier({
    store: supabaseNotifyStore(createServiceClient(config)),
    decrypt: (targetEnc) => decryptSecret(targetEnc, config.SETTINGS_ENCRYPTION_KEY),
    appUrl: config.APP_URL,
    transports: {
      sendEmail: (message) =>
        sendResendEmail(send, { apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM }, message),
      postSlack: (webhookUrl, message) => postSlackWebhook(send, webhookUrl, message),
    },
    logger: createLogger({ component: 'notifier' }),
  });
}
