import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exampleTracks} from '../../../data/catalogue/textbook-examples.ts';
import type {SoundSource} from '@wanwu-v2/contracts/sound';
import type {Pool} from 'pg';
import type {CloudContext} from './cloud/context.ts';
import {transaction} from './db/transaction.ts';
import {enqueueMedia} from './jobs/mediaQueue.ts';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
export const textbookTrack=(id:string)=>exampleTracks.find(track=>track.id===id)??null;
export type TrustedSource={id:string;checksum:string;bytes:number;durationMs:number;original:string;source:SoundSource};
export async function trustedCatalogue(verifyFiles=false):Promise<Map<string,TrustedSource>>{
 const manifest=JSON.parse(await readFile(resolve(root,'data/catalogue/library-manifest.json'),'utf8')) as {id:string;path:string;bytes:number;sha256:string;original:string;originalBytes:number;originalSha256:string}[];
 const catalogue=JSON.parse(await readFile(resolve(root,'data/catalogue/library-sounds.json'),'utf8')) as {sounds:{id:string;label:string;durationMs:number;by:string;previewPath:string;bytes:number}[]};
 const items=new Map<string,TrustedSource>();
 for(const sound of catalogue.sounds){
  const record=manifest.find(item=>item.id===sound.id);
  if(!record||record.path!==sound.previewPath||!/^data\/catalogue\/previews\/[a-z]+\.[a-f0-9]+\.mp3$/.test(record.path)
   ||record.bytes!==sound.bytes||!record.original.startsWith('assets-source/audio/')||record.original.includes('..')
   ||!/^\w{64}$/.test(record.originalSha256)||sound.durationMs>60_000)throw new Error('invalid-trusted-catalogue');
  const original=resolve(root,record.original);if(!original.startsWith(root+sep))throw new Error('invalid-catalogue-path');
  if(verifyFiles)for(const [file,bytes,hash] of [[record.original,record.originalBytes,record.originalSha256],[record.path,record.bytes,record.sha256]] as const){
   const path=resolve(root,file);if((await stat(path)).size!==bytes||createHash('sha256').update(await readFile(path)).digest('hex')!==hash)throw new Error('catalogue-hash-mismatch');
  }
  const id=`example:${sound.id}`;
  items.set(id,{id,checksum:record.originalSha256,bytes:record.originalBytes,durationMs:sound.durationMs,original,
   source:{id,kind:'example',label:sound.label,durationMs:sound.durationMs,mimeType:/\.mp3$/.test(record.original)?'audio/mpeg':/\.wav$/.test(record.original)?'audio/wav':'audio/ogg',
    provenance:{recordedBy:sound.by,recordedOn:null,place:null,group:'内置示例',provenanceUrl:'/legal/sound-sources.html'}}});
 }
 return items;
}
/** Management-only seed, using the dedicated owner. Originals and published previews are both hash-checked first. */
export async function seedCatalogue(owner:Pool,context:CloudContext){
 const identity=(await owner.query('SELECT current_user AS role,current_database() AS name')).rows[0];
 if(identity.role!=='wanwu_owner'||!/^wanwu_sound(?:_test_[a-f0-9]{8})?$/.test(identity.name))throw new Error('refusing-catalogue-seed');
 const catalogue=await trustedCatalogue(true);
 for(const item of catalogue.values()){
  const key=await transaction(owner,async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[item.id]);
   const old=(await tx.query('SELECT * FROM sources WHERE id=$1 FOR UPDATE',[item.id])).rows[0];
   if(old){if(!old.catalogue||old.checksum!==item.checksum)throw new Error('catalogue-version-conflict');return old.status==='uploading'?old.original_key as string:null;}
   const key=context.store.key('originals');
   await tx.query('INSERT INTO sources(id,catalogue,metadata,checksum,bytes,original_key) VALUES($1,true,$2,$3,$4,$5)',[item.id,JSON.stringify(item.source),item.checksum,item.bytes,key]);
   await tx.query('INSERT INTO stored_objects(object_key,kind,source_id) VALUES($1,\'original\',$2)',[key,item.id]);return key;
  });
  if(!key)continue;
  try{const head=await context.store.head(key);if(head.bytes!==item.bytes)throw new Error('catalogue-object-conflict');}
  catch(error){if((error as {status?:number;code?:string}).status!==404&&(error as {code?:string}).code!=='ENOENT')throw error;await context.store.put(key,item.original,item.source.mimeType);}
  await transaction(owner,async tx=>{
   const row=await tx.query('UPDATE sources SET status=\'queued\',updated_at=now() WHERE id=$1 AND status=\'uploading\' RETURNING id',[item.id]);
   if(row.rowCount)await enqueueMedia(context.boss,tx,{kind:'source',sourceId:item.id});
  });
 }
}
