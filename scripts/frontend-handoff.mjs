import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowed=file=>/^(?:apps\/web\/|packages\/(?:contracts|audio-engine)\/)/.test(file)||['package.json','package-lock.json','netlify.toml'].includes(file);
export function safeRelative(file){
 if(typeof file!=='string'||!file||file.includes('\\')||path.posix.normalize(file)!==file||file.startsWith('/')
  ||file.split('/').some(part=>part==='..'||part==='.git'||part==='node_modules'||part==='.secrets'||part==='.env'||part.startsWith('.env.')||/\.(?:pem|key|p12|pfx)$/.test(part))||!allowed(file))throw new Error('Unsafe frontend handoff path');
 return file;
}
const git=(target,args)=>execFileSync('git',['-C',target,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024}).trim();
async function checkedFile(target,file){
 let current=target;
 for(const part of file.split('/')){
  current=path.join(current,part);
  try{if((await lstat(current)).isSymbolicLink())throw new Error('Refusing symlink: '+file);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 return digest(await readFile(current));
}
export async function inspectFiles(target,files,side){
 const failures=[];
 for(const item of files){const file=safeRelative(item.path);if(await checkedFile(target,file)!==item[side])failures.push(file);}
 return failures;
}
export async function bundle(){
 const manifest=JSON.parse(await readFile(path.join(root,'handoff/manifest.json'),'utf8'));
 if(manifest.schema!=='wanwu-frontend-handoff-v1'||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Invalid handoff manifest');
 const patchFile=path.join(root,'handoff/frontend-integration.patch'),patch=await readFile(patchFile);
 if(digest(patch)!==manifest.patchSha256)throw new Error('Handoff patch fingerprint mismatch');
 const seen=new Set();
 for(const entry of manifest.files){
  safeRelative(entry.path);
  if(seen.has(entry.path)||![entry.before,entry.after].every(value=>value===null||/^[a-f0-9]{64}$/.test(value)))throw new Error('Invalid manifest entry');
  seen.add(entry.path);
 }
 const headers=[...patch.toString('utf8').matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
 if(headers.length!==seen.size||headers.some(([,a,b])=>a!==b||!seen.has(safeRelative(a))))throw new Error('Patch paths differ from manifest');
 if(!Array.isArray(manifest.sharedFiles)||!manifest.sharedFiles.length)throw new Error('Missing shared package fingerprints');
 for(const entry of manifest.sharedFiles){
  if(!/^packages\/(?:contracts|sound-rules|audio-engine|prompts|music-features)\//.test(entry.path)||entry.path.includes('..')||entry.path.includes('\\')
   ||await checkedFile(root,entry.path)!==entry.sha256)throw new Error('Shared package snapshot mismatch');
 }
 return {manifest,patchFile};
}
export async function main(args=process.argv.slice(2)){
 const [action,targetArg]=args;
 if(!['verify-bundle','check','apply','verify'].includes(action)||args.length!==(action==='verify-bundle'?1:2))throw new Error('Usage: node scripts/frontend-handoff.mjs verify-bundle | check|apply|verify /absolute/frontend/repository');
 const {manifest,patchFile}=await bundle();
 if(action==='verify-bundle'){console.log(JSON.stringify({status:'pass',files:manifest.files.length,sharedFiles:manifest.sharedFiles.length,patchSha256:manifest.patchSha256}));return;}
 if(!path.isAbsolute(targetArg))throw new Error('Provide an absolute frontend repository path');
 const target=await realpath(targetArg),backend=await realpath(root);
 if(target===backend||target.startsWith(backend+path.sep)&&!target.startsWith(path.join(backend,'artifacts')+path.sep))throw new Error('Target must be a separate frontend checkout');
 if(await realpath(git(target,['rev-parse','--show-toplevel']))!==target)throw new Error('Target must be the frontend Git repository root');
 const pkg=JSON.parse(await readFile(path.join(target,'package.json'),'utf8'));
 if(pkg.name!=='wanwu-shengpu-v2'||!pkg.workspaces?.includes('apps/web'))throw new Error('Target is not the expected frontend workspace');
 const shared=manifest.sharedFiles.map(item=>({path:item.path,after:item.sha256}));
 const after=await inspectFiles(target,manifest.files,'after'),sharedAfter=await inspectShared(target,shared);
 if(action==='verify'){
  if(after.length||sharedAfter.length)throw new Error('Applied frontend differs: '+[...new Set([...after,...sharedAfter])].join(', '));
  console.log(JSON.stringify({status:'verified',files:manifest.files.length,sharedFiles:shared.length}));return;
 }
 if(!after.length&&!sharedAfter.length){console.log(JSON.stringify({status:'already-applied',files:manifest.files.length}));return;}
 if(git(target,['status','--porcelain=v1','--untracked-files=normal']))throw new Error('Frontend checkout is dirty. Preserve existing work; do not reset or overwrite it.');
 const failures=await inspectFiles(target,manifest.files,'before');
 if(failures.length)throw new Error('Frontend baseline differs; stop and reconcile manually: '+failures.join(', '));
 try{git(target,['apply','--check',patchFile]);}catch{throw new Error('Patch check failed. Do not force or use --3way.');}
 if(action==='check'){console.log(JSON.stringify({status:'applicable',baseCommit:manifest.baseCommit,files:manifest.files.length}));return;}
 const branch=git(target,['branch','--show-current']);
 if(!branch||['main','master','v2'].includes(branch))throw new Error('Apply only on a named integration branch, not main/master/v2 or detached HEAD');
 git(target,['apply',patchFile]);
 const changed=await inspectFiles(target,manifest.files,'after'),sharedChanged=await inspectShared(target,shared);
 if(changed.length||sharedChanged.length)throw new Error('Post-apply verification failed; preserve files for inspection');
 console.log(JSON.stringify({status:'applied-not-committed',branch,files:manifest.files.length,sharedFiles:shared.length}));
}
async function inspectShared(target,files){
 const failures=[];
 for(const item of files){
  if(!/^packages\/(?:contracts|sound-rules|audio-engine)\//.test(item.path)||item.path.includes('..')||item.path.includes('\\'))throw new Error('Unsafe shared package path');
  if(await checkedFile(target,item.path)!==item.after)failures.push(item.path);
 }
 return failures;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
