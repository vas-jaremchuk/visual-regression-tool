import { describe, expect, it, vi } from 'vitest';
import {
  FakeEmailSender,
  MailpitEmailSender,
  RedirectingEmailSender,
  ResendEmailSender,
  parseAddress,
} from './sender';
import { invitationEmail, memberAddedEmail } from './templates';

describe('invitationEmail', () => {
  it('names the inviter, project, role and link', () => {
    const message = invitationEmail({
      to: 'ann@example.com',
      inviter: 'Bob',
      project: { name: 'Example site', role: 'editor' },
      link: 'https://vrt.example.com/invite/tok',
    });
    expect(message.to).toBe('ann@example.com');
    expect(message.subject).toBe('Bob invited you to Example site on Visual Regression Tool');
    expect(message.text).toContain('the project "Example site" as editor');
    expect(message.text).toContain('https://vrt.example.com/invite/tok');
    expect(message.html).toContain('href="https://vrt.example.com/invite/tok"');
  });

  it('escapes HTML in user-controlled values', () => {
    const message = invitationEmail({
      to: 'ann@example.com',
      inviter: '<script>',
      project: { name: 'A & B', role: 'viewer' },
      link: 'https://vrt.example.com/invite/tok',
    });
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('A &amp; B');
    expect(message.html).not.toContain('<script>');
  });

  it('describes a platform-level invitation', () => {
    const message = invitationEmail({
      to: 'ann@example.com',
      inviter: 'Bob',
      project: null,
      link: 'https://vrt.example.com/invite/tok',
    });
    expect(message.subject).toBe('Bob invited you to Visual Regression Tool');
  });
});

describe('memberAddedEmail', () => {
  it('links to the project', () => {
    const message = memberAddedEmail({
      to: 'ann@example.com',
      inviter: 'Bob',
      project: { name: 'Example site', role: 'viewer' },
      link: 'https://vrt.example.com/p/example-site',
    });
    expect(message.text).toContain('added you to the project "Example site" as viewer');
    expect(message.text).toContain('https://vrt.example.com/p/example-site');
  });
});

const message = { to: 'ann@example.com', subject: 'Hi', text: 'text', html: '<p>html</p>' };

describe('email senders', () => {
  it('FakeEmailSender records messages', async () => {
    const sender = new FakeEmailSender();
    await sender.send(message);
    expect(sender.sent).toEqual([message]);
  });

  it('ResendEmailSender posts to the Resend API and throws on failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await new ResendEmailSender('re_key', 'VRT <vrt@example.com>', fetchImpl).send(message);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_key');
    expect(JSON.parse(String(init.body))).toEqual({ from: 'VRT <vrt@example.com>', ...message });

    const failing = vi.fn(async () => new Response('bad', { status: 422 }));
    await expect(new ResendEmailSender('re_key', 'x', failing).send(message)).rejects.toThrow(
      /422/,
    );
  });

  it('MailpitEmailSender posts to the Mailpit send API', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await new MailpitEmailSender('http://127.0.0.1:54324', 'VRT <vrt@example.com>', fetchImpl).send(
      message,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:54324/api/v1/send');
    expect(JSON.parse(String(init.body))).toMatchObject({
      From: { Email: 'vrt@example.com', Name: 'VRT' },
      To: [{ Email: 'ann@example.com' }],
      Subject: 'Hi',
    });
  });

  it('parseAddress handles bare and named addresses', () => {
    expect(parseAddress('vrt@example.com')).toEqual({ Email: 'vrt@example.com' });
    expect(parseAddress('"Visual Regression" <vrt@example.com>')).toEqual({
      Email: 'vrt@example.com',
      Name: 'Visual Regression',
    });
  });
});

describe('RedirectingEmailSender', () => {
  const message = { to: 'ann@client.com', subject: 'Invitation', text: 'Hi', html: '<p>Hi</p>' };

  it('delivers to the redirect address and names the intended recipient', async () => {
    const inner = new FakeEmailSender();
    await new RedirectingEmailSender(inner, 'me@example.com').send(message);
    expect(inner.sent).toHaveLength(1);
    expect(inner.sent[0]!.to).toBe('me@example.com');
    expect(inner.sent[0]!.subject).toBe('[for ann@client.com] Invitation');
    expect(inner.sent[0]!.text).toContain('Intended recipient: ann@client.com');
    expect(inner.sent[0]!.html).toContain('ann@client.com');
    expect(inner.sent[0]!.html).toContain('<p>Hi</p>');
  });

  it('leaves emails to the redirect address unchanged', async () => {
    const inner = new FakeEmailSender();
    await new RedirectingEmailSender(inner, 'Me@Example.com').send({
      ...message,
      to: 'me@example.com',
    });
    expect(inner.sent[0]).toEqual({ ...message, to: 'me@example.com' });
  });
});
