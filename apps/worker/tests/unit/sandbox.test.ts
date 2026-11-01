import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linuxSandboxEnabled} from '../../src/browser/sandbox.ts';
import {rendererSeccompProfile,KEPT_ENOSYS} from '../../../../deploy/media-prototype/seccomp-policy.ts';

const layers='PID namespaces\tYes\nNetwork namespaces\tYes\nSeccomp-BPF sandbox\tYes\nSeccomp-BPF sandbox supports TSYNC\tYes';
test('sandbox inspection accepts the observed Chromium 156 labels and the earlier namespace label',()=>{
 assert.equal(linuxSandboxEnabled(`Layer 1 Sandbox\tNamespace\n${layers}`),true);
 assert.equal(linuxSandboxEnabled(`Namespace sandbox\tYes\n${layers}`),true);
 for(const status of [`Layer 1 Sandbox\tNone\n${layers}`,`SUID sandbox\tYes\n${layers}`,
  `Layer 1 Sandbox\tNamespace\n${layers.replace('Network namespaces\tYes','Network namespaces\tNo')}`,
  `Layer 1 Sandbox\tNamespace\n${layers.replace('Seccomp-BPF sandbox\tYes','Seccomp-BPF sandbox\tNo')}`,
  `Layer 1 Sandbox\tNamespace\n${layers.replace('supports TSYNC\tYes','supports TSYNC\tNo')}`,
  `Layer 1 Sandbox\tNamespace\n${layers.replace('PID namespaces\tYes','PID namespaces\nYes')}`]){
  assert.equal(linuxSandboxEnabled(status),false,status);
 }
});

test('renderer seccomp adds only the sandbox chroot and faccessat2 syscalls, with no outer capability grant',()=>{
 const upstream=readFileSync(new URL('../../../../deploy/media-prototype/seccomp-profile.json',import.meta.url));
 const base=JSON.parse(upstream.toString()),profile=JSON.parse(rendererSeccompProfile(upstream));
 const enosys=profile.syscalls.pop(),access=profile.syscalls.pop(),addition=profile.syscalls.pop();
 assert.deepEqual(profile,base);
 // clone3 and the rest of 428-438 still answer ENOSYS (libc falls back to clone); none of them is allowed.
 assert.deepEqual(enosys.names,KEPT_ENOSYS);
 assert.ok(enosys.names.includes('clone3'));
 assert.equal(enosys.action,'SCMP_ACT_ERRNO');
 assert.equal(enosys.errnoRet,38);
 assert.deepEqual(enosys.includes,{});
 assert.deepEqual(enosys.excludes,{});
 assert.deepEqual(enosys.args,[]);
 const named=new Set(base.syscalls.flatMap((rule:{names:string[]})=>rule.names));
 assert.ok(KEPT_ENOSYS.every(name=>!named.has(name)));
 assert.deepEqual(addition.names,['chroot']);
 assert.equal(addition.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(addition.includes,{});
 assert.deepEqual(addition.excludes,{});
 assert.deepEqual(addition.args,[]);
 assert.deepEqual(access.names,['faccessat2']);
 assert.equal(access.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(access.includes,{});
 assert.deepEqual(access.excludes,{});
 assert.deepEqual(access.args,[]);
 const corrupted=Buffer.from(upstream);
 corrupted[0]=0;
 assert.throws(()=>rendererSeccompProfile(corrupted),/Unreviewed/);
});
