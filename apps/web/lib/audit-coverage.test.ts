import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Audit coverage (NFR-18, T24): every mutating route handler and server action writes an audit
 * log entry. The table maps each mutating entry point to the call chain that reaches the audit
 * write and the action(s) it records. Discovery fails the test when a new mutating route or
 * server action is added without a row, and each row is checked against the source: the entry
 * calls the first link, every link calls the next, and the last link writes the action (directly,
 * or through an RPC whose SQL body calls `write_audit_log`).
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

type Row =
  | {
      /** `file#function` links from the entry to the code that writes the audit entry. */
      chain: string[];
      actions: string[];
      /** The last link calls this RPC, whose SQL body writes the audit entry. */
      rpc?: { file: string; name: string };
    }
  | { exempt: string };

const RUNS_RPC = { file: 'lib/runs/service.ts', name: 'set_baseline' };

const MUTATIONS: Record<string, Row> = {
  // Route handlers (09 §1).
  'POST /api/comparisons/[id]/rediff': {
    chain: ['lib/comparisons/service.ts#rediffComparison', 'lib/comparisons/commands.ts#rediff'],
    actions: ['comparison.rediff'],
  },
  'POST /api/invitations': {
    chain: ['lib/members/service.ts#createInvitation'],
    actions: ['invitation.create', 'member.add'],
  },
  'DELETE /api/invitations/[id]': {
    chain: ['lib/members/service.ts#revokeInvitation'],
    actions: ['invitation.revoke'],
  },
  'POST /api/notifications/[channelId]/test': {
    chain: [
      'lib/notifications/service.ts#testChannel',
      'lib/notifications/commands.ts#testChannel',
    ],
    actions: ['notification_channel.test'],
  },
  'POST /api/projects': {
    chain: ['lib/projects/service.ts#createProject'],
    actions: ['project.create'],
  },
  'POST /api/projects/import-env': { exempt: 'parses .env text and writes nothing' },
  'POST /api/projects/[id]/check-bucket': {
    chain: ['lib/projects/service.ts#runBucketCheck'],
    actions: ['project.bucket.check'],
  },
  'POST /api/projects/[id]/comparisons': {
    chain: [
      'lib/comparisons/service.ts#startComparison',
      'lib/comparisons/commands.ts#startComparison',
    ],
    actions: ['comparison.start', 'comparison.replace'],
  },
  'POST /api/projects/[id]/import-legacy': {
    chain: ['lib/legacy/service.ts#importLegacyLabels', 'lib/legacy/commands.ts#importLabels'],
    actions: ['run.import_legacy'],
  },
  'POST /api/projects/[id]/runs': {
    chain: ['lib/runs/service.ts#startRun', 'lib/runs/commands.ts#startRun'],
    actions: ['run.start'],
  },
  'POST /api/projects/[id]/sitemap': {
    chain: ['lib/sitemap/service.ts#startSnapshot'],
    actions: ['sitemap.fetch'],
  },
  'POST /api/runs/[id]/baseline': {
    chain: ['lib/runs/service.ts#setBaseline', 'lib/runs/commands.ts#setBaseline'],
    actions: ['project.set_baseline'],
    rpc: RUNS_RPC,
  },
  'POST /api/runs/[id]/cancel': {
    chain: ['lib/runs/service.ts#cancelRun', 'lib/runs/commands.ts#cancelRun'],
    actions: ['run.cancel'],
  },
  'POST /api/runs/[id]/retry-failed': {
    chain: ['lib/runs/service.ts#retryFailed', 'lib/runs/commands.ts#retryFailed'],
    actions: ['run.retry_failed'],
  },

  // Server actions.
  'app/(app)/actions.ts#signOut': { exempt: 'ends the session; no application data changes' },
  'app/(app)/account/actions.ts#muteProject': {
    chain: ['lib/notifications/service.ts#setProjectMute', 'lib/notifications/commands.ts#setMute'],
    actions: ['notification.mute', 'notification.unmute'],
  },
  'app/(app)/admin/users/actions.ts#invitePlatformUser': {
    chain: ['lib/members/service.ts#createInvitation'],
    actions: ['invitation.create'],
  },
  'app/(app)/admin/users/actions.ts#setDisabled': {
    chain: ['lib/members/service.ts#setUserDisabled'],
    actions: ['user.disable', 'user.enable'],
  },
  'app/(app)/admin/users/actions.ts#setAdmin': {
    chain: ['lib/members/service.ts#setPlatformAdmin'],
    actions: ['user.promote_admin', 'user.demote_admin'],
  },
  'app/(app)/admin/users/actions.ts#resendPlatformInvitation': {
    chain: ['lib/members/service.ts#resendInvitation'],
    actions: ['invitation.resend'],
  },
  'app/(app)/admin/users/actions.ts#revokePlatformInvitation': {
    chain: ['lib/members/service.ts#revokeInvitation'],
    actions: ['invitation.revoke'],
  },
  'app/(app)/projects/new/actions.ts#createProjectAction': {
    chain: ['lib/projects/service.ts#createProject'],
    actions: ['project.create'],
  },
  'app/(app)/projects/new/actions.ts#previewEnvImport': {
    exempt: 'parses .env text and writes nothing',
  },
  'app/(app)/p/[slug]/settings/actions.ts#saveProjectSettings': {
    chain: ['lib/projects/service.ts#updateProjectSettings'],
    actions: ['project.settings.update'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#saveBasicAuthPassword': {
    chain: ['lib/projects/service.ts#setBasicAuthPassword'],
    actions: ['project.settings.update'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#addViewport': {
    chain: ['lib/projects/service.ts#createViewport'],
    actions: ['viewport.create'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#editViewport': {
    chain: ['lib/projects/service.ts#updateViewport'],
    actions: ['viewport.update'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#removeViewport': {
    chain: ['lib/projects/service.ts#deleteViewport'],
    actions: ['viewport.delete'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#reorderViewport': {
    chain: ['lib/projects/service.ts#moveViewport'],
    actions: ['viewport.reorder'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#archiveProject': {
    chain: ['lib/projects/service.ts#setProjectArchived'],
    actions: ['project.archive', 'project.unarchive'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#checkProjectBucket': {
    chain: ['lib/projects/service.ts#runBucketCheck'],
    actions: ['project.bucket.check'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#addNotificationChannel': {
    chain: [
      'lib/notifications/service.ts#createChannel',
      'lib/notifications/commands.ts#createChannel',
    ],
    actions: ['notification_channel.create'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#editNotificationChannel': {
    chain: [
      'lib/notifications/service.ts#updateChannel',
      'lib/notifications/commands.ts#updateChannel',
    ],
    actions: ['notification_channel.update'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#removeNotificationChannel': {
    chain: [
      'lib/notifications/service.ts#deleteChannel',
      'lib/notifications/commands.ts#deleteChannel',
    ],
    actions: ['notification_channel.delete'],
  },
  'app/(app)/p/[slug]/settings/actions.ts#sendTestNotification': {
    chain: [
      'lib/notifications/service.ts#testChannel',
      'lib/notifications/commands.ts#testChannel',
    ],
    actions: ['notification_channel.test'],
  },
  'app/(app)/p/[slug]/ignore-rules/actions.ts#createIgnoreRuleAction': {
    chain: ['lib/ignore-rules/service.ts#createIgnoreRule', 'lib/ignore-rules/commands.ts#create'],
    actions: ['ignore_rule.create'],
  },
  'app/(app)/p/[slug]/ignore-rules/actions.ts#updateIgnoreRuleAction': {
    chain: ['lib/ignore-rules/service.ts#updateIgnoreRule', 'lib/ignore-rules/commands.ts#update'],
    actions: ['ignore_rule.update'],
  },
  'app/(app)/p/[slug]/ignore-rules/actions.ts#setIgnoreRuleEnabledAction': {
    chain: [
      'lib/ignore-rules/service.ts#setIgnoreRuleEnabled',
      'lib/ignore-rules/commands.ts#setEnabled',
    ],
    actions: ['ignore_rule.update'],
  },
  'app/(app)/p/[slug]/ignore-rules/actions.ts#deleteIgnoreRuleAction': {
    chain: ['lib/ignore-rules/service.ts#deleteIgnoreRule', 'lib/ignore-rules/commands.ts#remove'],
    actions: ['ignore_rule.delete'],
  },
  'app/(app)/p/[slug]/sitemap/actions.ts#addManualUrlAction': {
    chain: ['lib/sitemap/service.ts#addManualUrl'],
    actions: ['sitemap.manual_url.add'],
  },
  'app/(app)/p/[slug]/sitemap/actions.ts#removeManualUrlAction': {
    chain: ['lib/sitemap/service.ts#removeManualUrl'],
    actions: ['sitemap.manual_url.remove'],
  },
  'app/(app)/p/[slug]/settings/members/actions.ts#inviteMember': {
    chain: ['lib/members/service.ts#createInvitation'],
    actions: ['invitation.create', 'member.add'],
  },
  'app/(app)/p/[slug]/settings/members/actions.ts#updateMemberRole': {
    chain: ['lib/members/service.ts#changeMemberRole'],
    actions: ['member.update_role'],
  },
  'app/(app)/p/[slug]/settings/members/actions.ts#deleteMember': {
    chain: ['lib/members/service.ts#removeMember'],
    actions: ['member.remove'],
  },
  'app/(app)/p/[slug]/settings/members/actions.ts#resendMemberInvitation': {
    chain: ['lib/members/service.ts#resendInvitation'],
    actions: ['invitation.resend'],
  },
  'app/(app)/p/[slug]/settings/members/actions.ts#revokeMemberInvitation': {
    chain: ['lib/members/service.ts#revokeInvitation'],
    actions: ['invitation.revoke'],
  },
  'app/invite/[token]/actions.ts#sendInviteSignInLink': {
    exempt: 'sends a sign-in email; no application data changes',
  },
  'app/invite/[token]/actions.ts#acceptInvitationAction': {
    chain: ['lib/members/service.ts#acceptInvitation'],
    actions: ['member.add', 'invitation.accept'],
  },
  'app/invite/[token]/actions.ts#signOutFromInvite': {
    exempt: 'ends the session; no application data changes',
  },
  'app/login/actions.ts#sendMagicLink': {
    exempt: 'sends a sign-in email; no application data changes',
  },
  'app/login/actions.ts#signInWithGoogle': {
    exempt: 'starts OAuth sign-in; no application data changes',
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const read = (file: string) => readFileSync(join(WEB, file), 'utf8');

/** Mutating entry points: route handlers with a mutating method, and server action exports. */
function discoverMutations(): Map<string, { file: string; fn: string }> {
  const found = new Map<string, { file: string; fn: string }>();
  for (const path of walk(join(WEB, 'app'))) {
    const file = relative(WEB, path).split('\\').join('/');
    if (!/\.tsx?$/.test(file)) continue;
    const source = read(file);
    if (/\/route\.ts$/.test(file)) {
      const route = `/${file.replace(/^app\//, '').replace(/\/route\.ts$/, '')}`;
      for (const [, method] of source.matchAll(
        /^export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/gm,
      )) {
        found.set(`${method} ${route}`, { file, fn: method! });
      }
    } else if (/^\s*['"]use server['"]/.test(source)) {
      for (const [, name] of source.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
        found.set(`${file}#${name}`, { file, fn: name! });
      }
    }
  }
  return found;
}

/** Source of a top-level function or object method `name` in `file` (indentation-delimited). */
function body(file: string, name: string): string {
  const source = read(file);
  // Prefer the exported function over an object method of the same name.
  const start =
    new RegExp(`^()export\\s+(?:async\\s+)?function\\s+${name}\\s*[(<]`, 'm').exec(source) ??
    new RegExp(
      `^([ \\t]*)(?:async\\s+function\\s+|function\\s+|async\\s+)${name}\\s*[(<]`,
      'm',
    ).exec(source);
  if (!start) throw new Error(`${file} has no function ${name}`);
  // The closing brace alone on its line; `}): Promise<…> {` of a multi-line signature is not it.
  const close = new RegExp(`\\n${start[1]}\\}[;,]?[ \\t]*(?:\\n|$)`, 'g');
  close.lastIndex = start.index;
  const end = close.exec(source);
  return source.slice(start.index, end ? end.index : undefined);
}

function calls(source: string, name: string): boolean {
  return new RegExp(`(?:^|[^\\w])${name}\\s*\\(`).test(source.replace(/^.*?\(/s, ''));
}

/** SQL body of the latest definition of function `name` across the migrations. */
function sqlFunction(name: string): string {
  const files = readdirSync(MIGRATIONS).sort();
  let found = '';
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const match = new RegExp(
      `create (?:or replace )?function public\\.${name}\\s*\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`,
      'i',
    ).exec(sql);
    if (match) found = match[1]!;
  }
  return found;
}

const discovered = discoverMutations();

describe('audit coverage', () => {
  it('lists every mutating route handler and server action', () => {
    expect([...discovered.keys()].sort()).toEqual(Object.keys(MUTATIONS).sort());
  });

  const audited = Object.entries(MUTATIONS).filter(
    (entry): entry is [string, Exclude<Row, { exempt: string }>] => !('exempt' in entry[1]),
  );

  it.each(audited)('%s writes an audit entry', (key, row) => {
    const entry = discovered.get(key);
    expect(entry, `${key} is not a mutating entry point`).toBeDefined();

    // The entry calls the first link, imported from its module.
    const [firstFile, firstFn] = row.chain[0]!.split('#') as [string, string];
    const entrySource = read(entry!.file);
    const importPath = `@/${firstFile.replace(/\.ts$/, '')}`;
    expect(entrySource, `${entry!.file} imports ${firstFn} from ${importPath}`).toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${firstFn}\\b[^}]*\\}\\s*from\\s*'${importPath}'`),
    );
    expect(calls(body(entry!.file, entry!.fn), firstFn), `${key} calls ${firstFn}`).toBe(true);

    // Every link calls the next one.
    for (let i = 0; i + 1 < row.chain.length; i++) {
      const [file, fn] = row.chain[i]!.split('#') as [string, string];
      const next = row.chain[i + 1]!.split('#')[1]!;
      expect(calls(body(file, fn), next), `${row.chain[i]} calls ${next}`).toBe(true);
    }

    // The last link writes each action.
    const [lastFile, lastFn] = row.chain.at(-1)!.split('#') as [string, string];
    const last = body(lastFile, lastFn);
    if (row.rpc) {
      expect(read(row.rpc.file)).toContain(`rpc('${row.rpc.name}'`);
      const sql = sqlFunction(row.rpc.name);
      for (const action of row.actions) {
        expect(sql, `SQL ${row.rpc.name} audits ${action}`).toMatch(
          new RegExp(`write_audit_log\\(\\s*'${action.replace(/\./g, '\\.')}'`),
        );
      }
    } else {
      expect(last, `${row.chain.at(-1)} writes the audit log`).toMatch(
        /\baudit\(|\.audit\(|from\('audit_log'\)\.insert/,
      );
      for (const action of row.actions) {
        expect(last, `${row.chain.at(-1)} records ${action}`).toContain(`'${action}'`);
      }
    }
  });
});
