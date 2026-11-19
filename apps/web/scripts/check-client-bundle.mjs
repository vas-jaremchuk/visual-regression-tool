// Fails when the browser bundle (.next/static) contains the Supabase service role key, by name
// or by value. Run after `next build`; CI runs it on every pull request.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../.next/static', import.meta.url).pathname;
const needles = ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
  (needle) => needle && needle.length >= 16,
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
        `${file}: ${needle === 'SUPABASE_SERVICE_ROLE_KEY' ? 'variable name' : 'key value'}`,
      );
    }
  }
}

if (count === 0) {
  console.error(`No files under ${root}; run \`next build\` first.`);
  process.exit(1);
}
if (leaks.length > 0) {
  console.error(`Service role key found in the client bundle:\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}
console.log(`Checked ${count} client bundle files: no service role key.`);
