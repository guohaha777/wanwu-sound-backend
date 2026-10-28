import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import {ApiError} from './errors.ts';

export const randomToken=()=>randomBytes(32).toString('base64url');
export const tokenDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
export function sameToken(actual:unknown,expected:unknown){
 if(typeof actual!=='string'||typeof expected!=='string'||actual.length>128||expected.length>128)return false;
 const left=Buffer.from(actual),right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right);
}

/** A bounded native-hash queue, not unbounded 19 MiB allocations per request. */
export class Passwords{
 private active=0;private queue:(()=>void)[]=[];private dummy='';
 async ready(){this.dummy=await this.hash(randomToken());}
 private async limited<T>(run:()=>Promise<T>):Promise<T>{
  if(this.active>=2){
   if(this.queue.length>=4)throw new ApiError(429,'busy');
   await new Promise<void>(resolve=>this.queue.push(resolve));
  }else this.active++;
  try{return await run();}
  finally{const next=this.queue.shift();if(next)next();else this.active--;}
 }
 hash(password:string){return this.limited(()=>argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1}));}
 verify(hash:string|null,password:string){
  if(!this.dummy)throw new Error('Password verifier was not initialized');
  return this.limited(async()=>{const valid=await argon2.verify(hash??this.dummy,password);return hash!==null&&valid;});
 }
}
