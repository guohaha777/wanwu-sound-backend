import Fastify,{LogController} from 'fastify';
import type {FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import rateLimit from '@fastify/rate-limit';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {exactObject,parseLogin,parseRegistration,validPassword} from '@wanwu-v2/contracts/account';
import {Accounts,accountView} from './accounts.ts';
import type {ApiConfig} from './config.ts';
import {SESSION_IDLE_MS} from './config.ts';
import type {openDatabase} from './db/client.ts';
import {ApiError} from './errors.ts';
import {Passwords,randomToken,sameToken,tokenDigest} from './security.ts';
import {PgSessionStore} from './session-store.ts';
import {cloudRoutes} from './cloud/routes.ts';
import type {CloudContext} from './cloud/context.ts';
import {guestRoutes} from './guest/routes.ts';
import type {GuestContext} from './guest/routes.ts';

export const COOKIE_NAME='__Host-wanwu';
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const token=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);

export async function buildApp(config:ApiConfig,database:ReturnType<typeof openDatabase>,logging=false,cloud?:CloudContext,guest?:GuestContext){
 const app=Fastify({logger:logging?{redact:['req.headers.cookie','req.headers.authorization','req.headers["x-wanwu-model-config"]','res.headers["set-cookie"]']}:false,
  logController:new LogController({disableRequestLogging:true}),requestIdHeader:false,genReqId:()=>randomUUID(),bodyLimit:256*1024,
  trustProxy:config.trustedProxyAddresses.length?config.trustedProxyAddresses:false,requestTimeout:20_000});
 const passwords=new Passwords();await passwords.ready();
 const accounts=new Accounts(database.db,passwords),store=new PgSessionStore(database.pool);
 await app.register(cookie);
 await app.register(session,{secret:config.sessionSecret,store,cookieName:COOKIE_NAME,saveUninitialized:false,rolling:true,
  idGenerator:()=>randomToken(),cookie:{path:'/',httpOnly:true,secure:true,sameSite:'lax',maxAge:SESSION_IDLE_MS}});
 await app.register(rateLimit,{global:false,hook:'preHandler',cache:10_000,errorResponseBuilder:()=>({reason:'rate-limited'})});
 app.setErrorHandler((error,request,reply)=>{
  const known=error as {statusCode?:number;validation?:unknown};
  const status=error instanceof ApiError?error.status:known.statusCode===429?429:known.statusCode===413?413:known.validation||known.statusCode===400?400:500;
  const reason=error instanceof ApiError?error.reason:status===429?'rate-limited':status===413?'too-large':status===400?'invalid-request':'internal-error';
  if(reason==='needs-account'||reason==='session-unavailable'){
   // The plugin itself also sets session=null on destroy; its public types
   // omit that state. Prevent a failed rolling save from repeating onSend.
   Reflect.set(request,'session',null);reply.clearCookie(COOKIE_NAME,{path:'/',secure:true,httpOnly:true,sameSite:'lax'});
  }
  if(status===429&&!reply.hasHeader('Retry-After'))reply.header('Retry-After',String(error instanceof ApiError?error.retryAfter??1:1));
  if(status>=500)request.log.error({requestId:request.id,reason,storageCode:(error as {storageCode?:string}).storageCode},'Wanwu request failed');
  return reply.code(status).send({status:'error',reason,requestId:request.id});
 });
 app.setNotFoundHandler((request,reply)=>reply.code(404).send({status:'error',reason:'not-found',requestId:request.id}));
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Content-Type-Options','nosniff');
  if(request.url.split('?')[0]==='/api/v1/health')return;
  if(config.cloudAuthMode!=='session')throw new ApiError(503,'not-open');
  if(request.protocol!=='https')throw new ApiError(400,'https-required');
 });
 app.addHook('preHandler',async request=>{
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   if(request.headers.origin!==config.origin||!sameToken(request.headers['x-csrf-token'],request.session.csrfToken))throw new ApiError(403,'csrf-failed');
  }
 });
 const authenticated=async(request:FastifyRequest)=>{
  const {accountId,authVersion}=request.session;
  if(!accountId||!Number.isInteger(authVersion))throw new ApiError(401,'needs-account');
  return accounts.authenticated(accountId,authVersion!);
 };
 const administrator=async(request:FastifyRequest)=>{
  const account=await authenticated(request);if(account.role!=='admin')throw new ApiError(403,'forbidden');return account;
 };
 const establish=async(request:FastifyRequest,account:Awaited<ReturnType<Accounts['login']>>)=>{
  await request.session.regenerate();
  request.session.accountId=account.id;request.session.authVersion=account.authVersion;
  // Let the plugin's onSend persist the changed session before setting its
  // cookie. An early save emits both a clearing and replacement cookie.
  request.session.csrfToken=randomToken();
  return {account:accountView(account),csrfToken:request.session.csrfToken};
 };
 const sensitive={config:{rateLimit:{max:30,timeWindow:10*60_000}}};
 app.get('/api/v1/health',async()=>{await database.db.execute(sql`SELECT 1`);return {status:'ok'};});
 app.get('/api/v1/auth/csrf',{config:{rateLimit:{max:60,timeWindow:60_000}}},async request=>{
  request.session.csrfToken??=randomToken();return {csrfToken:request.session.csrfToken};
 });
 app.post('/api/v1/auth/register',sensitive,async(request,reply)=>{
  const body=parseRegistration(request.body);if(!body)throw new ApiError(400,'invalid-request');
  return reply.code(201).send(await establish(request,await accounts.register(body)));
 });
 app.post('/api/v1/auth/login',sensitive,async request=>{
  const body=parseLogin(request.body);if(!body)throw new ApiError(400,'invalid-request');
  return establish(request,await accounts.login(body.username,body.password));
 });
 app.get('/api/v1/auth/me',async request=>({account:accountView(await authenticated(request))}));
 app.post('/api/v1/auth/logout',async(request,reply)=>{
  await authenticated(request);await request.session.destroy();
  reply.clearCookie(COOKIE_NAME,{path:'/',secure:true,httpOnly:true,sameSite:'lax'});return reply.code(204).send();
 });
 app.post('/api/v1/auth/change-password',sensitive,async(request,reply)=>{
  const target=await authenticated(request),body=request.body;
  if(!exactObject(body,['oldPassword','password'])||typeof body.oldPassword!=='string'||body.oldPassword.length>512||!validPassword(body.password))throw new ApiError(400,'invalid-request');
  await accounts.changePassword(target,body.oldPassword,body.password);await request.session.destroy();
  reply.clearCookie(COOKIE_NAME,{path:'/',secure:true,httpOnly:true,sameSite:'lax'});return reply.code(204).send();
 });
 app.post('/api/v1/auth/reset-password',sensitive,async(request,reply)=>{
  const body=request.body;
  if(!exactObject(body,['token','password'])||!token(body.token)||!validPassword(body.password))throw new ApiError(400,'invalid-request');
  await accounts.resetPassword(body.token,body.password);await request.session.destroy();
  reply.clearCookie(COOKIE_NAME,{path:'/',secure:true,httpOnly:true,sameSite:'lax'});return reply.code(204).send();
 });
 app.post('/api/v1/admin/invitations',async(request,reply)=>{
  const actor=await administrator(request);
  if(request.body!==undefined&&!exactObject(request.body,[]))throw new ApiError(400,'invalid-request');
  return reply.code(201).send(await accounts.createInvitation(actor.id));
 });
 app.get('/api/v1/admin/invitations',async request=>({invitations:await accounts.listInvitations((await administrator(request)).id)}));
 app.delete<{Params:{id:string}}>('/api/v1/admin/invitations/:id',async(request,reply)=>{
  const actor=await administrator(request);if(!uuid(request.params.id))throw new ApiError(400,'invalid-request');
  await accounts.revokeInvitation(actor.id,request.params.id);return reply.code(204).send();
 });
 app.patch<{Params:{id:string}}>('/api/v1/admin/accounts/:id',async request=>{
  const actor=await administrator(request),body=request.body;
  if(!uuid(request.params.id)||!exactObject(body,['status'])||!['active','disabled'].includes(body.status as string))throw new ApiError(400,'invalid-request');
  return {account:await accounts.setStatus(actor.id,request.params.id,body.status as 'active'|'disabled')};
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/accounts/:id/password-reset',async(request,reply)=>{
  const actor=await administrator(request);if(!uuid(request.params.id)||(request.body!==undefined&&!exactObject(request.body,[])))throw new ApiError(400,'invalid-request');
  const reset=await accounts.issueReset(actor.id,request.params.id);
  return reply.code(201).send({resetUrl:`${config.origin}/reset-password#token=${reset.token}`,expiresAt:reset.expiresAt});
 });
 // The username limiter is independent of the remote address and does not
 // trust forwarded identity headers. Keys are hashed rather than logged names.
 const attempts=new Map<string,{count:number;expires:number}>();
 app.addHook('preHandler',async request=>{
  if(!['/api/v1/auth/login','/api/v1/auth/register','/api/v1/auth/reset-password'].includes(request.url.split('?')[0]!))return;
  const body=request.body as Record<string,unknown>|undefined;
  const key=tokenDigest(String(body?.username??body?.token??'invalid').toLowerCase());
  const now=Date.now();
  for(const [id,state] of attempts)if(state.expires<=now)attempts.delete(id);
  const state=attempts.get(key)??{count:0,expires:now+10*60_000};
  if(state.count>=10)throw new ApiError(429,'rate-limited',Math.max(1,Math.ceil((state.expires-now)/1000)));
  if(!attempts.has(key)&&attempts.size>=10_000)throw new ApiError(429,'rate-limited',60);
  state.count++;attempts.set(key,state);
 });
 if(cloud)cloudRoutes(app,cloud,authenticated);
 if(guest)guestRoutes(app,guest);
 await app.ready();return app;
}
