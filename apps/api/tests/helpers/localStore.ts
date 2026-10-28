import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdtemp,stat,readFile,copyFile,unlink,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ObjectStore,ObjectHead} from '../../src/storage/objectStore.ts';

/** Test-only private object service. No production import/fallback; bytes actually transfer and stay immutable. */
export class LocalObjectStore implements ObjectStore{
 private readonly directory:string;private readonly secret=randomUUID();private origin='';
 private constructor(directory:string){this.directory=directory;}
 static async create(root=tmpdir()){return new LocalObjectStore(await mkdtemp(join(root,'wanwu-test-objects-')));}
 static existing(directory:string){if(!/^\/fixtures\/wanwu-test-objects-[A-Za-z0-9_-]{6}$/.test(directory))throw new Error('isolated-fixture-directory-required');return new LocalObjectStore(directory);}
 testDirectory(){return this.directory;}
 setOrigin(origin:string){if(!/^https:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('local HTTPS fixture only');this.origin=origin;}
 key(kind:'tmp'|'originals'|'playback'|'renders'){return `wanwu/dev/${kind}/${randomUUID()}`;}
 private path(key:string){if(!/^wanwu\/dev\/(tmp|originals|playback|renders)\/[a-f0-9-]{36}$/.test(key))throw new Error('invalid-test-object');
  return join(this.directory,createHash('sha256').update(key).digest('hex'));}
 private sign(method:string,key:string,expires:number,bytes:number,mime:string,checksum:string){
  return createHmac('sha256',this.secret).update(JSON.stringify([method,key,expires,bytes,mime,checksum])).digest('hex');
 }
 private url(method:string,key:string,seconds:number,bytes=0,mime='',checksum=''){
  const expires=Date.now()+seconds*1000,url=new URL(`/__objects/${Buffer.from(key).toString('base64url')}`,this.origin);
  for(const [name,value] of Object.entries({expires,bytes,mime,checksum,signature:this.sign(method,key,expires,bytes,mime,checksum)}))url.searchParams.set(name,String(value));return url.toString();
 }
 async upload(key:string,mime:string,checksum:string,bytes:number){
  this.path(key);if(!key.includes('/tmp/'))throw new Error('client-write-forbidden');
  return {method:'PUT' as const,uploadUrl:this.url('PUT',key,300,bytes,mime,checksum),expiresAt:new Date(Date.now()+300_000).toISOString(),
   requiredHeaders:{'Content-Type':mime,'x-oss-meta-sha256':checksum,'x-oss-forbid-overwrite':'true'}};
 }
 async head(key:string):Promise<ObjectHead>{
  const path=this.path(key),bytes=(await stat(path)).size,etag='"'+createHash('md5').update(await readFile(path)).digest('hex')+'"';return {bytes,etag};
 }
 async freeze(temporary:string,final:string,head:ObjectHead){
  const current=await this.head(temporary);if(current.etag!==head.etag||current.bytes!==head.bytes)throw new Error('temporary-object-changed');
  try{await copyFile(this.path(temporary),this.path(final),constants.COPYFILE_EXCL);}catch(error){
   if((error as {code?:string}).code!=='EEXIST')throw error;const existing=await this.head(final);if(existing.etag!==head.etag)throw new Error('original-conflict');
  }return {};
 }
 async download(key:string,file:string,maxBytes:number,_version?:string,signal?:AbortSignal){
  if((await stat(this.path(key))).size>maxBytes)throw new Error('object-too-large');
  await pipeline(createReadStream(this.path(key)),createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
 }
 async put(key:string,file:string,_mime:string){await copyFile(file,this.path(key),constants.COPYFILE_EXCL);}
 async playback(key:string,seconds:number){if(key.includes('/originals/')||key.includes('/tmp/'))throw new Error('original-playback-forbidden');
  return {url:this.url('GET',key,seconds),expiresAt:new Date(Date.now()+seconds*1000).toISOString()};}
 async remove(key:string){await unlink(this.path(key)).catch(error=>{if((error as {code?:string}).code!=='ENOENT')throw error;});}
 async close(){await rm(this.directory,{recursive:true,force:true});}
 async serve(request:IncomingMessage,response:ServerResponse):Promise<boolean>{
  if(!request.url?.startsWith('/__objects/'))return false;
  try{
   const url=new URL(request.url,this.origin),key=Buffer.from(url.pathname.slice('/__objects/'.length),'base64url').toString(),file=this.path(key);
   const bytes=Number(url.searchParams.get('bytes')),expires=Number(url.searchParams.get('expires')),mime=url.searchParams.get('mime')??'',checksum=url.searchParams.get('checksum')??'';
   const expected=this.sign(request.method??'',key,expires,bytes,mime,checksum),supplied=url.searchParams.get('signature')??'';
   if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))||expires<Date.now())throw new Error('unauthorized-object');
   if(request.method==='PUT'){
    if(!key.includes('/tmp/')||bytes<=0||bytes>20*1024*1024||Number(request.headers['content-length'])!==bytes
     ||request.headers['content-type']!==mime||request.headers['x-oss-meta-sha256']!==checksum)throw new Error('invalid-upload');
    try{await stat(file);request.resume();response.writeHead(409).end();return true;}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
    let count=0;const bounded=new Transform({transform(chunk:Buffer,_encoding,done){count+=chunk.length;done(count>bytes?new Error('too-large'):null,chunk);}});
    await pipeline(request,bounded,createWriteStream(file,{flags:'wx',mode:0o600}));if(count!==bytes)throw new Error('incomplete-upload');response.writeHead(200).end();
   }else if(request.method==='GET'){
    if(key.includes('/tmp/')||key.includes('/originals/'))throw new Error('original-forbidden');
    response.writeHead(200,{'Content-Type':key.includes('/renders/')?'audio/mpeg':'audio/wav','Content-Length':(await stat(file)).size,'Cache-Control':'private, no-store'});
    await pipeline(createReadStream(file),response);
   }else response.writeHead(405).end();
  }catch(error){if(!response.headersSent)response.writeHead((error as {code?:string}).code==='ENOENT'?404:403);response.end();}
  return true;
 }
}
