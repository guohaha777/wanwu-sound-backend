// Local preview only (npm run guest-ai:dev): the guest AI module on http://127.0.0.1:3199 with the models in .env.models,
// no database, no accounts. The web dev server forwards /api/v1 here when started with WANWU_DEV_API. Never deployed:
// it skips the https / Origin / CSRF hooks of the real app (a CSRF token is handed out so the page's client works) and
// calls models through this Mac's proxy with fetch (the production client checks every resolved address instead).
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {randomBytes} from 'node:crypto';
import {ApiError} from '../errors.ts';
import {readGuestConfig} from './config.ts';
import {GuestFailure} from './net.ts';
import type {Post} from './net.ts';
import {guestContext,guestRoutes} from './routes.ts';

const viaFetch:Post=async(url,headers,body,timeoutMs)=>{
 const abort=AbortSignal.timeout(timeoutMs);
 try{const response=await fetch(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body),signal:abort});
  return {status:response.status,json:await response.json().catch(()=>null)};}
 catch{throw new GuestFailure(abort.aborted?'timeout':'failed');}
};
const app=Fastify({logger:{level:'info'},bodyLimit:256*1024});
await app.register(rateLimit,{global:false});
app.setErrorHandler((error,request,reply)=>{
 const status=error instanceof ApiError?error.status:(error as {statusCode?:number}).statusCode??500;
 reply.code(status).send({status:'error',reason:error instanceof ApiError?error.reason:'internal-error',requestId:request.id});
});
const token=randomBytes(32).toString('base64url');
app.get('/api/v1/auth/csrf',async()=>({csrfToken:token}));
app.get('/api/v1/auth/me',async(_request,reply)=>reply.code(401).send({status:'error',reason:'needs-account',requestId:'dev'}));
const config=readGuestConfig();
guestRoutes(app,guestContext(config,viaFetch));
// WANWU_DEV_PORT: another port when 3199 is taken (a second preview beside the first).
await app.listen({host:'127.0.0.1',port:Number(process.env.WANWU_DEV_PORT??3199)});
console.log(`guest AI dev: language=${!!config.language} audio=${!!config.audio} music=${!!config.music}`);
