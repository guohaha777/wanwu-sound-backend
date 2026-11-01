import { spawn } from 'node:child_process';
import { dedicatedDatabaseUrl } from '../config.ts';

export function pgCommand(
  command: 'pg_dump' | 'pg_restore',
  url: string,
  args: string[],
  restore = false,
) {
  const target = new URL(url);
  if (restore) {
    if (
      !/^\/wanwu_sound_restore_[a-f0-9]{8}$/.test(target.pathname) ||
      target.username !== 'wanwu_owner' ||
      !target.password ||
      !['postgres:', 'postgresql:'].includes(target.protocol)
    )
      throw new Error('restore-only-to-new-isolated-database');
  } else dedicatedDatabaseUrl(url, 'owner');
  const child = spawn(
    command,
    [
      ...args,
      '--host',
      target.hostname,
      '--port',
      target.port || '5432',
      '--username',
      decodeURIComponent(target.username),
      '--dbname',
      target.pathname.slice(1),
    ],
    {
      env: {
        PATH: process.env.PATH,
        LANG: 'C',
        PGPASSWORD: decodeURIComponent(target.password),
        PGSSLMODE: target.searchParams.get('sslmode') ?? 'prefer',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stderr.resume(); // Never expose dump errors, names, SQL, passwords or connection URLs in logs.
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('postgres-tool-unavailable')));
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('postgres-tool-failed')),
    );
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 180_000);
  void done.finally(() => clearTimeout(timeout)).catch(() => {});
  void done.catch(() => {});
  return { child, done };
}
