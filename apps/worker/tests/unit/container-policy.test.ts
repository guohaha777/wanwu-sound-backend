import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../../../../',import.meta.url);
test('prototype image runs non-root and excludes private source material and secrets',()=>{
 const docker=readFileSync(new URL('deploy/media-prototype/Dockerfile',root),'utf8');
 assert.match(docker,/USER node/);assert.doesNotMatch(docker,/COPY\s+\.\s/);
 const ignore=readFileSync(new URL('.dockerignore',root),'utf8');
 for(const value of ['.git','node_modules','assets-source','.env','*.pem','*.key'])assert.ok(ignore.split('\n').includes(value));
});
test('container verification checks real cgroups, sandbox and limits without privileged modes or shared infrastructure',()=>{
 const verifier=readFileSync(new URL('scripts/verify-media-container.mjs',root),'utf8');
 assert.match(verifier,/'--network','none'/);assert.match(verifier,/'--cap-drop','ALL'/);
 assert.match(verifier,/'--memory','1g'/);assert.match(verifier,/'--cpus','0.5'/);
 assert.doesNotMatch(verifier,/--privileged|--ipc.?[=,].?host|SYS_ADMIN|['"]system['"]\s*,\s*['"]prune['"]|8\.130\.95\.57/);
 const runner=readFileSync(new URL('apps/worker/src/browser/runner.ts',root),'utf8');
 assert.match(runner,/chromiumSandbox:true/);assert.doesNotMatch(runner,/--no-sandbox|ignoreDefaultArgs/);
 const proof=readFileSync(new URL('apps/worker/src/container-proof.ts',root),'utf8');
 assert.match(proof,/memory\.peak/);assert.match(proof,/\/proc\/self\/status/);assert.match(proof,/linuxSandboxVerified,true/);
});
test('seccomp profile is the reviewed upstream deny-by-default profile with namespace creation support',()=>{
 const bytes=readFileSync(new URL('deploy/media-prototype/seccomp-profile.json',root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849');
 const profile=JSON.parse(bytes.toString());assert.equal(profile.defaultAction,'SCMP_ACT_ERRNO');
 assert.ok(profile.syscalls.some((rule:{names:string[];action:string})=>rule.action==='SCMP_ACT_ALLOW'&&['clone','setns','unshare'].every(name=>rule.names.includes(name))));
});
test('the constrained observer discovers every integration file without nested npm/test runners',()=>{
 const proof=readFileSync(new URL('apps/worker/src/container-proof.ts',root),'utf8');
 assert.match(proof,/readdir\(integration\)/);assert.match(proof,/file\.endsWith\('\.test\.ts'\)/);
 assert.match(proof,/--test-isolation=none/);assert.doesNotMatch(proof,/spawnSync\(['"]npm['"]/);
 assert.match(proof,/await import\('\.\/prototype\.ts'\)/);assert.match(proof,/memoryEvents\.oom_kill,0/);
});
