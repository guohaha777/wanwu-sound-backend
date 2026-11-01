// Outbound calls to model services. Every address a model URL resolves to must be public, checked at connect time
// (not only before), so a user-supplied URL cannot reach this host, the Docker networks or the cloud metadata service.
// No redirects are followed; replies are size-limited; nothing here logs headers or bodies.
import {request} from 'node:https';
import {lookup} from 'node:dns';
import type {LookupAddress} from 'node:dns';
import {isIP} from 'node:net';

export type GuestFailureReason='not-open'|'quota'|'timeout'|'failed';
/** A model step did not give a usable answer; routes turn it into an error reply or an unavailable background. */
export class GuestFailure extends Error{
 readonly reason:GuestFailureReason;
 constructor(reason:GuestFailureReason){
  super(reason);
  this.reason=reason;
 }
}

export function publicAddress(ip:string):boolean{
 if(isIP(ip)===4){
  const [a,b]=ip.split('.').map(Number) as [number,number];
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<128)||(a===169&&b===254)||(a===172&&b>=16&&b<32)
   ||(a===192&&(b===168||b===0))||(a===198&&(b===18||b===19)));
 }
 if(isIP(ip)===6){
  const lower=ip.toLowerCase();
  const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if(mapped)return publicAddress(mapped[1]!);
  return !(lower==='::'||lower==='::1'||/^f[cd]/.test(lower)||/^fe[89ab]/.test(lower)||lower.startsWith('ff'));
 }
 return false;
}

export type PostReply={status:number;json:unknown};
/** POST JSON and read a JSON reply. Injected into the guest context so tests use a fake service. */
export type Post=(url:string,headers:Record<string,string>,body:unknown,timeoutMs:number)=>Promise<PostReply>;

const guardedLookup=(hostname:string,options:{all?:boolean},callback:(...args:unknown[])=>void)=>{
 lookup(hostname,{all:true},(error,addresses:LookupAddress[])=>{
  if(error)return callback(error);
  if(!addresses.length
   ||!addresses.every(item=>publicAddress(item.address)))return callback(new Error('private-address'));
  if(options.all)return callback(null,addresses);
  callback(null,addresses[0]!.address,addresses[0]!.family);
 });
};

export const postJson:Post=(url,headers,body,timeoutMs)=>new Promise((resolve,reject)=>{
 const target=new URL(url);
 if(target.protocol!=='https:'
  ||(isIP(target.hostname.replace(/^\[|\]$/g,''))&&!publicAddress(target.hostname.replace(/^\[|\]$/g,''))))
  return reject(new GuestFailure('failed'));
 const payload=Buffer.from(JSON.stringify(body));
 const call=request(target,{method:'POST',lookup:guardedLookup as never,timeout:timeoutMs,
  headers:{...headers,'content-type':'application/json','content-length':String(payload.length),accept:'application/json'}},response=>{
  const chunks:Buffer[]=[];
  let size=0;
  response.on('data',(chunk:Buffer)=>{
   size+=chunk.length;
   if(size>1_000_000){
    call.destroy();
    reject(new GuestFailure('failed'));
   }else chunks.push(chunk);
  });
  response.on('end',()=>{
   let json:unknown=null;
   try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{/* status decides */}
   resolve({status:response.statusCode??0,json});
  });
  response.on('error',()=>reject(new GuestFailure('failed')));
 });
 const timer=setTimeout(()=>{
  call.destroy();
  reject(new GuestFailure('timeout'));
 },timeoutMs);
 call.on('close',()=>clearTimeout(timer));
 call.on('timeout',()=>{
  call.destroy();
  reject(new GuestFailure('timeout'));
 });
 call.on('error',()=>reject(new GuestFailure('failed')));
 call.end(payload);
});
