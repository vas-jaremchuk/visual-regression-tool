import { expect } from '@playwright/test';

/**
 * Reads magic-link emails from the local Supabase mail catcher (Mailpit, formerly Inbucket).
 */
const base = () => process.env.MAILPIT_URL!;

export async function clearMailbox(email: string) {
  await fetch(`${base()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, {
    method: 'DELETE',
  });
}

export async function getMagicLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${base()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const id = messages[0]?.ID;
        if (!id) return undefined;
        const message = (await (await fetch(`${base()}/api/v1/message/${id}`)).json()) as {
          HTML: string;
          Text: string;
        };
        link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(
          message.Text || message.HTML,
        )?.[0];
        return link;
      },
      { message: `magic link email for ${email}`, timeout: 15_000 },
    )
    .toBeTruthy();
  return link!.replace(/&amp;/g, '&');
}
