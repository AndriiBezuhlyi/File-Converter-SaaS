import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function probe() {
  const text = await readFile(
    join(process.env.WORKER_TEMP_DIR || join(tmpdir(), 'converter'), 'health.json'),
    'utf8',
  );
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    !('pid' in value) ||
    !('ready' in value) ||
    !('checkedAt' in value)
  )
    return false;
  if (
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    value.ready !== true ||
    typeof value.checkedAt !== 'number'
  )
    return false;
  const age = Date.now() - value.checkedAt;
  const interval = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 5_000);
  const timeout = Number(process.env.INFRA_TIMEOUT_MS || 5_000);
  if (!Number.isFinite(interval) || !Number.isFinite(timeout)) return false;
  if (age < 0 || age > Math.max(30_000, interval * 3 + timeout)) return false;
  process.kill(value.pid, 0);
  return true;
}
void probe()
  .then((ready) => {
    process.exitCode = ready ? 0 : 1;
  })
  .catch(() => {
    process.exitCode = 1;
  });
