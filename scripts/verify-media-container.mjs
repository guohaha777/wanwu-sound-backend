import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,openSync,writeSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {rendererSeccompProfile} from '../deploy/media-prototype/seccomp-policy.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.join(root,'artifacts');
await mkdir(directory,{recursive:true});
const name=`wanwu-media-test-${randomUUID()}`;
const reportFile=path.join(directory,`${name}.json`);
const fail=async(reason,code=1)=>{
 await writeFile(reportFile,JSON.stringify({status:'blocked',reason,checkedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 console.error(`${reason}\nReport: ${reportFile}`);process.exit(code);
};
let docker='docker',environment=process.env;
const call=(args)=>spawnSync(docker,args,{encoding:'utf8',maxBuffer:4*1024*1024,env:environment,timeout:15_000});
let version=call(['--version']);
if(version.error?.code==='ENOENT'&&process.platform==='darwin'&&existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')){
 docker='/Applications/Docker.app/Contents/Resources/bin/docker';
 environment={...process.env,PATH:`${path.dirname(docker)}:${process.env.PATH??''}`};version=call(['--version']);
}
if(version.error?.code==='ENOENT')await fail('Docker is not installed. No container/sandbox/resource validation was performed.',78);
if(version.status!==0)await fail('Docker CLI is unavailable.',78);
if(process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith('unix://'))await fail('Remote Docker endpoints are not allowed by this local-only verifier.');
const context=process.env.WANWU_TEST_DOCKER_CONTEXT??call(['context','show']).stdout.trim();
if(!context||context.includes('\n'))await fail('Unable to select a local Docker context.');
const endpoint=call(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']);
if(endpoint.status!==0||!endpoint.stdout.trim().startsWith('unix://'))await fail('This verifier requires a local Unix-socket Docker context; it never targets the ECS.');
const prefix=['--context',context];
if(call([...prefix,'info','--format','{{.OSType}}']).stdout.trim()!=='linux')await fail('A local Linux Docker engine is required.',78);
const profile=path.join(directory,`${name}.seccomp.json`);
let policy;
try{policy=rendererSeccompProfile(await readFile(path.join(root,'deploy/media-prototype/seccomp-profile.json')));}
catch(error){await fail(error.message);}
await writeFile(profile,policy,{flag:'wx',mode:0o600});
const seccompSha256=createHash('sha256').update(policy).digest('hex');
const logFile=path.join(directory,`${name}.log`),log=openSync(logFile,'wx',0o600);

function run(args,timeoutMs=30_000){return new Promise((resolve,reject)=>{
 const child=spawn(docker,[...prefix,...args],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
 let output='',writeError,timedOut=false,forceTimer;
 const deadline=setTimeout(()=>{
  timedOut=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),5000);forceTimer.unref();
 },timeoutMs);
 const clear=()=>{clearTimeout(deadline);clearTimeout(forceTimer);};
 const collect=chunk=>{
  if(writeError)return;
  try{writeSync(log,chunk);process.stdout.write(chunk);output+=chunk.toString();if(output.length>4*1024*1024)output=output.slice(-4*1024*1024);}
  catch(error){writeError=error;child.kill('SIGTERM');}
 };
 child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',error=>{clear();reject(error);});
 child.on('close',code=>{
  clear();
  if(timedOut)return reject(new Error(`Docker test operation timed out after ${timeoutMs} ms.`));
  writeError?reject(writeError):code===0?resolve(output):reject(new Error(`Docker test operation failed (${code}).`));
 });
});}

try{
 await run(['build','--platform','linux/amd64','--file','deploy/media-prototype/Dockerfile','--tag',name,'.'],20*60_000);
 const output=await run(['run','--init','--name',name,'--platform','linux/amd64',
  '--user','1000:1000','--cpus','0.5','--memory','1g','--memory-swap','1g','--pids-limit','256',
  '--cap-drop','ALL','--security-opt','no-new-privileges:true','--security-opt',`seccomp=${profile}`,
  '--read-only','--network','none','--shm-size','128m',
  '--log-opt','max-size=10m','--log-opt','max-file=3',
  '--tmpfs','/tmp:rw,nosuid,noexec,size=256m,mode=1777',
  '--tmpfs','/home/node:rw,nosuid,noexec,size=32m,uid=1000,gid=1000',
  '--mount',`type=volume,source=${name},target=/app/artifacts`,name],15*60_000);
 const match=output.match(/^WANWU_MEDIA_CONTAINER_PROOF (.+)$/m);
 if(!match)throw new Error('The container did not produce kernel-backed validation evidence.');
 const proof=JSON.parse(match[1]);if(proof.status!=='pass'||proof.linuxSandboxVerified!==true)throw new Error('The container gate did not pass.');
 const prototype=output.match(/^\s*"report":\s*"(\/app\/artifacts\/media-prototype-[A-Za-z0-9]+\/report\.json)"/m)?.[1];
 if(!prototype)throw new Error('Missing prototype artifact path.');
 const exported=path.join(directory,name);await mkdir(exported,{mode:0o700});
 for(const file of ['report.json','mixed.mp3','mixed.wav'])await run(['cp',`${name}:${path.posix.dirname(prototype)}/${file}`,path.join(exported,file)]);
 const imageId=call([...prefix,'inspect',name,'--format','{{.Image}}']).stdout.trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('Unable to bind evidence to the actual container image.');
 await writeFile(reportFile,JSON.stringify({...proof,context,image:name,imageId,seccompSha256,logFile,artifacts:exported},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(`Container evidence: ${reportFile}`);
}catch(error){
 const state=call([...prefix,'inspect',name,'--format','{{json .State}}']);
 let containerState=null;try{containerState=JSON.parse(state.stdout);}catch{}
 let measurements=null;
 try{const measured=(await readFile(logFile,'utf8')).match(/^WANWU_MEDIA_CONTAINER_MEASUREMENTS (.+)$/m);if(measured)measurements=JSON.parse(measured[1]);}catch{}
 await writeFile(reportFile,JSON.stringify({status:'blocked',reason:error.message,checkedAt:new Date().toISOString(),
  context,image:name,seccompSha256,logFile,containerState,measurements},null,2)+'\n',{flag:'wx',mode:0o600});
 console.error(`${error.message}\nReport: ${reportFile}\nLog: ${logFile}`);process.exitCode=1;
}
finally{
 // Only this invocation's exact test resources; no daemon restart, system prune or old project operations.
 call([...prefix,'rm','--force',name]);call([...prefix,'volume','rm',name]);
 closeSync(log);
}
