import assert from 'node:assert/strict';

/** memory.max is the enforced budget. memory.peak can briefly exceed it during
 * kernel reclaim; that is not permission to increase the container limit.
 * https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files
 */
export function assessMemory(
  memoryLimit: number,
  memoryPeak: number,
  events: Record<string, number>,
) {
  assert.ok(Number.isSafeInteger(memoryLimit) && memoryLimit > 0, 'Missing enforced memory limit');
  assert.ok(Number.isSafeInteger(memoryPeak) && memoryPeak > 0, 'Missing measured memory peak');
  for (const name of ['max', 'oom', 'oom_kill'])
    assert.ok(
      Number.isSafeInteger(events[name]) && events[name]! >= 0,
      `Missing memory counter: ${name}`,
    );
  assert.equal(events.oom, 0, 'Memory allocation failure: resource gate blocked');
  assert.equal(events.oom_kill, 0, 'OOM kill: resource gate blocked');
  return {
    memoryPressure: memoryPeak >= memoryLimit * 0.9 || events.max! > 0,
    peakAboveLimit: memoryPeak > memoryLimit,
  };
}
