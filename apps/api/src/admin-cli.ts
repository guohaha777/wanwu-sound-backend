import { openDatabase } from './db/client.ts';
import { firstAdmin } from './accounts.ts';
import { Passwords } from './security.ts';

// Passwords are read from protected stdin, never CLI arguments or console prompts.
if (process.stdin.isTTY)
  throw new Error(
    'Read the bootstrap password from protected stdin, not command arguments or chat',
  );
let input = '';
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (Buffer.byteLength(input) > 1024) throw new Error('Bootstrap input exceeds the limit');
}
const password = input.replace(/\r?\n$/, '');
input = '';
const database = openDatabase(process.env.WANWU_MIGRATION_DATABASE_URL ?? '', 'owner');
try {
  const passwords = new Passwords();
  await passwords.ready();
  const account = await firstAdmin(database.db, passwords, process.argv[2] ?? '', password);
  console.log(`Wanwu initial administrator created: ${account.username}`);
} catch {
  console.error('Administrator creation failed; no credentials are logged.');
  process.exitCode = 1;
} finally {
  await database.close();
}
