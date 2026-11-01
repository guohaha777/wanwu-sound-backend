import { openDatabase } from '../db/client.ts';

const database = openDatabase(process.env.WANWU_DATABASE_URL ?? '');
try {
  const queue = (
    await database.pool.query(
      "SELECT state,count(*)::integer AS count FROM wanwu_jobs.job WHERE name='media' GROUP BY state",
    )
  ).rows;
  const worker = (
    await database.pool.query(
      "SELECT extract(epoch FROM now()-seen_at)::integer AS seconds FROM runtime_status WHERE component='media-worker'",
    )
  ).rows[0];
  const backups = (
    await database.pool.query(
      "SELECT status,extract(epoch FROM now()-finished_at)::integer AS seconds FROM maintenance_runs WHERE kind='backup' ORDER BY started_at DESC LIMIT 1",
    )
  ).rows[0];
  const cleanup = (
    await database.pool.query(
      "SELECT status,extract(epoch FROM now()-finished_at)::integer AS seconds FROM maintenance_runs WHERE kind='garbage-collection' ORDER BY started_at DESC LIMIT 1",
    )
  ).rows[0];
  const pending = queue
    .filter((row) => ['created', 'retry'].includes(row.state))
    .reduce((sum, row) => sum + row.count, 0);
  const failures = queue
    .filter((row) => row.state === 'failed')
    .reduce((sum, row) => sum + row.count, 0);
  const healthy = process.argv.includes('--worker-only')
    ? !!worker && worker.seconds < 90
    : !!worker &&
      worker.seconds < 90 &&
      !!backups &&
      backups.status === 'pass' &&
      backups.seconds < 26 * 3600 &&
      !!cleanup &&
      cleanup.status === 'pass' &&
      cleanup.seconds < 2 * 3600 &&
      pending < 50;
  console.log(
    JSON.stringify({
      status: healthy ? 'pass' : 'attention',
      queuePending: pending,
      queueFailures: failures,
      workerAgeSeconds: worker?.seconds ?? null,
      backup: backups ?? null,
      cleanup: cleanup ?? null,
    }),
  );
  if (!healthy) process.exitCode = 1;
} catch {
  console.error('Wanwu operational health check failed; details suppressed.');
  process.exitCode = 1;
} finally {
  await database.close();
}
