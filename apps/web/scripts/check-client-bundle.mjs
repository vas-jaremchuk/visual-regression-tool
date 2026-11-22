// Fails when the browser bundle (.next/static) contains the Supabase service role key, by name
// or by value, or the name of any other server secret (NFR-13). Run after `next build`; CI runs
// it on every pull request.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../.next/static', import.meta.url).pathname;
const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'CF_API_TOKEN',
  'R2_SECRET_ACCESS_KEY',
  'WORKER_SHARED_SECRET',
  'SETTINGS_ENCRYPTION_KEY',
  'RESEND_API_KEY',
];
const needles = [...SECRET_NAMES, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
  (needle) => needle && needle.length >= 12,
);

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

let count = 0;
const leaks = [];
for (const file of files(root)) {
  count++;
  const content = readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (content.includes(needle)) {
      leaks.push(
        `${file}: ${SECRET_NAMES.includes(needle) ? `variable name ${needle}` : 'key value'}`,
      );
    }
  }
}

if (count === 0) {
  console.error(`No files under ${root}; run \`next build\` first.`);
  process.exit(1);
}
if (leaks.length > 0) {
  console.error(`Server secret found in the client bundle:\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}
console.log(`Checked ${count} client bundle files: no server secrets.`);
