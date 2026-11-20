export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends app emails (invitations). Injected so tests can use `FakeEmailSender`. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

type Fetch = typeof fetch;

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
    }
  }
}

/** Local Supabase mail catcher (Mailpit send API); development and e2e only. */
export class MailpitEmailSender implements EmailSender {
  constructor(
    private readonly baseUrl: string,
    private readonly from: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(new URL('/api/v1/send', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: parseAddress(this.from),
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
    });
    if (!response.ok) {
      throw new Error(`Mailpit rejected the email (${response.status}): ${await response.text()}`);
    }
  }
}

/** Records emails instead of sending them. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** Splits `Name <email>` into Mailpit's address object. */
export function parseAddress(address: string): { Email: string; Name?: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(address);
  if (!match) return { Email: address.trim() };
  return match[1] ? { Email: match[2]!.trim(), Name: match[1] } : { Email: match[2]!.trim() };
}
