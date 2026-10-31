import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linuxSandboxEnabled} from '../../src/browser/sandbox.ts';
import {rendererSeccompProfile} from '../../../../deploy/media-prototype/seccomp-policy.ts';

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
 const access=profile.syscalls.pop(),addition=profile.syscalls.pop();assert.deepEqual(profile,base);
 assert.deepEqual(addition.names,['chroot']);assert.equal(addition.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(addition.includes,{});assert.deepEqual(addition.excludes,{});assert.deepEqual(addition.args,[]);
 assert.deepEqual(access.names,['faccessat2']);assert.equal(access.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(access.includes,{});assert.deepEqual(access.excludes,{});assert.deepEqual(access.args,[]);
 const corrupted=Buffer.from(upstream);corrupted[0]=0;assert.throws(()=>rendererSeccompProfile(corrupted),/Unreviewed/);
});
