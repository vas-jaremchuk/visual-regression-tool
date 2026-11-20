import type { ProjectRole } from '@vrt/shared';
import type { EmailMessage } from './sender';

export interface InvitationEmailInput {
  to: string;
  inviter: string;
  /** null for a platform-level invitation. */
  project: { name: string; role: ProjectRole } | null;
  link: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Invitation email (04 §4): inviter, project, role and the accept link. */
export function invitationEmail({
  to,
  inviter,
  project,
  link,
}: InvitationEmailInput): EmailMessage {
  const what = project
    ? `the project "${project.name}" as ${project.role}`
    : 'the Visual Regression Tool';
  const subject = project
    ? `${inviter} invited you to ${project.name} on Visual Regression Tool`
    : `${inviter} invited you to Visual Regression Tool`;
  const text = [
    `${inviter} invited you to ${what}.`,
    '',
    `Accept the invitation: ${link}`,
    '',
    'The link expires in 7 days. If you did not expect this email, you can ignore it.',
  ].join('\n');
  const html = [
    `<p>${escapeHtml(inviter)} invited you to ${escapeHtml(what)}.</p>`,
    `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
    '<p>The link expires in 7 days. If you did not expect this email, you can ignore it.</p>',
  ].join('\n');
  return { to, subject, text, html };
}

export interface MemberAddedEmailInput {
  to: string;
  inviter: string;
  project: { name: string; role: ProjectRole };
  link: string;
}

/** Sent when an existing user is added to a project directly (04 §4). */
export function memberAddedEmail({
  to,
  inviter,
  project,
  link,
}: MemberAddedEmailInput): EmailMessage {
  const subject = `${inviter} added you to ${project.name} on Visual Regression Tool`;
  const text = [
    `${inviter} added you to the project "${project.name}" as ${project.role}.`,
    '',
    `Open the project: ${link}`,
  ].join('\n');
  const html = [
    `<p>${escapeHtml(inviter)} added you to the project "${escapeHtml(project.name)}" as ${project.role}.</p>`,
    `<p><a href="${escapeHtml(link)}">Open the project</a></p>`,
  ].join('\n');
  return { to, subject, text, html };
}
