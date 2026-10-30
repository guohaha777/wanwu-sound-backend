// Copies the shared packages from the frontend checkout and refreshes their fingerprints in handoff/manifest.json.
// Usage: node scripts/sync-shared.mjs /absolute/path/to/frontend   (check first with --dry-run)
// Shared code is changed in one place and copied here, never edited separately (docs/development/guest-ai.md); the
// frontend patch entries (`files`, `patchSha256`) are left as they are.
import {createHash} from 'node:crypto';
import {cp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SHARED=['contracts','sound-rules','audio-engine','prompts','music-features'];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skip=name=>name==='node_modules'||name==='.DS_Store';
async function files(dir,base=dir){
 const out=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(skip(entry.name))continue;
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())out.push(...await files(full,base));else out.push(path.relative(base,full));
 }
 return out.sort();
}
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');

export async function main(args=process.argv.slice(2)){
 const dry=args.includes('--dry-run'),frontend=args.find(arg=>!arg.startsWith('--'));
 if(!frontend||!path.isAbsolute(frontend))throw new Error('Give the absolute path of the frontend checkout');
 const changed=[];
 for(const name of SHARED){
  const from=path.join(frontend,'packages',name),to=path.join(root,'packages',name);
  if(!(await stat(from).catch(()=>null))?.isDirectory())throw new Error(`Missing packages/${name} in the frontend checkout`);
  const [a,b]=[await files(from),await files(to).catch(()=>[])];
  for(const file of new Set([...a,...b])){
   const [x,y]=[a.includes(file)?await sha(path.join(from,file)):null,b.includes(file)?await sha(path.join(to,file)):null];
   if(x!==y)changed.push(`packages/${name}/${file}`);
  }
  if(!dry){await rm(to,{recursive:true,force:true});await cp(from,to,{recursive:true,filter:source=>!skip(path.basename(source))});}
 }
 if(!dry){
  const manifestFile=path.join(root,'handoff/manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  const shared=[];
  for(const name of SHARED)for(const file of await files(path.join(root,'packages',name)))shared.push({path:`packages/${name}/${file}`,sha256:await sha(path.join(root,'packages',name,file))});
  manifest.sharedFiles=shared;
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 }
 console.log(JSON.stringify({status:dry?'dry-run':'synced',changed},null,1));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
