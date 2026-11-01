// 「API 输入」: a visitor's own model settings, sent with each request in one header and used for that request only.
// Each kind (language / music) replaces the built-in one; a kind left out keeps the built-in. Never stored, logged or
// echoed. Addresses must be public https (net.ts checks every resolved address again when connecting).
import {isIP} from 'node:net';
import {exactObject} from '@wanwu-v2/contracts/account';
import {publicAddress} from './net.ts';
import {validProvider} from './config.ts';
import type {Provider} from './config.ts';

export const OVERRIDE_HEADER='x-wanwu-model-config';
export type Override={language?:Provider;music?:Provider};

const entry=(raw:unknown):Provider|null=>{
 if(!exactObject(raw,['apiKey','baseUrl','model']))return null;
 if(!validProvider(raw.baseUrl,raw.model,raw.apiKey))return null;
 const host=new URL(raw.baseUrl as string).hostname.replace(/^\[|\]$/g,'');
 if(host==='localhost'||host.endsWith('.localhost')||(isIP(host)&&!publicAddress(host)))return null;
 return {baseUrl:(raw.baseUrl as string).replace(/\/+$/,''),model:raw.model as string,apiKey:raw.apiKey as string,builtIn:false};
};

/** No header → null; a header that is not exactly right → 'invalid' (the request is refused, never half-used). */
export function parseOverride(header:unknown):Override|null|'invalid'{
 if(header===undefined)return null;
 if(typeof header!=='string'||header.length>4096||!/^[A-Za-z0-9+/=]+$/.test(header))return 'invalid';
 let value:unknown;
 try{value=JSON.parse(Buffer.from(header,'base64').toString('utf8'));}catch{return 'invalid';}
 if(!value||typeof value!=='object'||Array.isArray(value))return 'invalid';
 const raw=value as Record<string,unknown>,keys=Object.keys(raw);
 if(!keys.length||keys.some(key=>key!=='language'&&key!=='music'))return 'invalid';
 const out:Override={};
 for(const key of keys as ('language'|'music')[]){
  const provider=entry(raw[key]);
  if(!provider)return 'invalid';
  out[key]=provider;
 }
 return out;
}
