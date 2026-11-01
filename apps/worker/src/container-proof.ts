import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assessMemory} from './resource-evidence.ts';

/** Actual kernel evidence, not a Compose-file assertion or the host's unbounded RSS. */
export async function containerLimits(){
 assert.equal(process.platform,'linux','Linux is required for the container gate');
 assert.notEqual(process.getuid?.(),0,'Do not run the renderer as root');
 const status=await readFile('/proc/self/status','utf8');
 assert.match(status,/^NoNewPrivs:\s+1$/m);
 assert.match(status,/^CapEff:\s+0+$/m);
 assert.match(status,/^Seccomp:\s+2$/m);
 const cgroup=async(name:string)=>(await readFile(`/sys/fs/cgroup/${name}`,'utf8')).trim();
 const memoryLimit=Number(await cgroup('memory.max')),pids=Number(await cgroup('pids.max'));
 const [quota,period]=(await cgroup('cpu.max')).split(/\s+/).map(Number),cpu=quota!/period!;
 assert.equal(memoryLimit,1024**3);
 assert.equal(cpu,.5);
 assert.equal(pids,256);
 assert.equal(await cgroup('memory.swap.max'),'0');
 const ordinary=spawnSync('/usr/sbin/chroot',['/','/usr/bin/true'],{encoding:'utf8'});
 assert.equal(ordinary.error,undefined);
 assert.notEqual(ordinary.status,0);
 assert.match(ordinary.stderr,/Operation not permitted/,'The ordinary task process must not gain chroot authority');
 return {cpu,memoryLimit,pids,nonRoot:true,noNewPrivileges:true,capabilitiesDropped:true,seccompFiltered:true,ordinaryChrootDenied:true};
}

const limits=await containerLimits();
// One file at a time, without npm or an extra test-runner child process. They
// previously reported ~290 MiB aggregate RSS alongside the real media/browser job.
// No test is omitted; per-file hooks and all deadlines remain unchanged.
const integration=new URL('../tests/integration/',import.meta.url);
const files=(await readdir(integration)).filter(file=>file.endsWith('.test.ts')).sort();
assert.ok(files.length>0);
for(const file of files){
 const tests=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-isolation=none',fileURLToPath(new URL(file,integration))],{stdio:'inherit'});
 assert.equal(tests.status,0,'Real-media and browser parity tests must pass inside this constrained container');
}
// Keep the observer small while tests run; load the real worker only afterward.
const {runPrototype}=await import('./prototype.ts');
const report=await runPrototype('maximum');
assert.equal(report.linuxSandboxVerified,true);
assert.ok(report.elapsedMs<=180_000,'Maximum render exceeds the initial task budget');
const memoryPeak=Number((await readFile('/sys/fs/cgroup/memory.peak','utf8')).trim());
const events=async(file:string)=>Object.fromEntries((await readFile(file,'utf8')).trim().split('\n').map(line=>{
 const [key,value]=line.split(/\s+/);
 return [key,Number(value)];
}));
const memoryEvents=await events('/sys/fs/cgroup/memory.events'),pidEvents=await events('/sys/fs/cgroup/pids.events');
console.log('WANWU_MEDIA_CONTAINER_MEASUREMENTS '+JSON.stringify({limits,memoryPeak,memoryEvents,pidEvents,
 elapsedMs:report.elapsedMs,linuxSandboxVerified:report.linuxSandboxVerified}));
// Recheck the enforced limits, not an assumed upper bound on the kernel's
// transient peak accounting. Never reset peak/counters between the test jobs.
assert.deepEqual(await containerLimits(),limits);
const capacity=assessMemory(limits.memoryLimit,memoryPeak,memoryEvents);
assert.equal(memoryEvents.oom,0);
assert.equal(memoryEvents.oom_kill,0);
assert.equal(pidEvents.max,0);
const proof={status:'pass',createdAt:new Date().toISOString(),limits,memoryPeak,browserVersion:report.browserVersion,
 memoryEvents,pidEvents,capacity,sandboxStatus:report.sandboxStatus,render:report.render,encoded:report.encoded,inputHash:report.inputHash,
 sourceCount:report.sourceCount,sourceChecksums:report.sourceChecksums,ruleVersions:report.ruleVersions,
 linuxSandboxVerified:report.linuxSandboxVerified,elapsedMs:report.elapsedMs,checks:{...report.checks,linuxContainerResourceGate:true}};
console.log('WANWU_MEDIA_CONTAINER_PROOF '+JSON.stringify(proof));
