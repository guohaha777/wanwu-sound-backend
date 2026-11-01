// 管理员: invitations, account status and password-reset links, mounted by one line in app.ts. Every route checks
// the signed-in account's role on the server; the page's admin view is only a convenience.
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {exactObject} from '@wanwu-v2/contracts/account';
import {uuid} from '@wanwu-v2/contracts/cloud';
import type {ApiConfig} from '../config.ts';
import {ApiError} from '../errors.ts';
import type {AuthContext} from '../auth/routes.ts';

export type AdminContext=AuthContext&{config:ApiConfig};

export function adminRoutes(app:FastifyInstance,{config,accounts,authenticated}:AdminContext){
 const administrator=async(request:FastifyRequest)=>{
  const account=await authenticated(request);
  if(account.role!=='admin')throw new ApiError(403,'forbidden');
  return account;
 };
 /** No body, or an empty object. */
 const noBody=(body:unknown)=>body===undefined||exactObject(body,[]);
 app.post('/api/v1/admin/invitations',async(request,reply)=>{
  const actor=await administrator(request);
  if(!noBody(request.body))throw new ApiError(400,'invalid-request');
  return reply.code(201).send(await accounts.createInvitation(actor.id));
 });
 app.get('/api/v1/admin/invitations',async request=>({invitations:await accounts.listInvitations((await administrator(request)).id)}));
 app.delete<{Params:{id:string}}>('/api/v1/admin/invitations/:id',async(request,reply)=>{
  const actor=await administrator(request);
  if(!uuid(request.params.id))throw new ApiError(400,'invalid-request');
  await accounts.revokeInvitation(actor.id,request.params.id);
  return reply.code(204).send();
 });
 app.patch<{Params:{id:string}}>('/api/v1/admin/accounts/:id',async request=>{
  const actor=await administrator(request),body=request.body;
  if(!uuid(request.params.id)
   ||!exactObject(body,['status'])
   ||!['active','disabled'].includes(body.status as string))throw new ApiError(400,'invalid-request');
  return {account:await accounts.setStatus(actor.id,request.params.id,body.status as 'active'|'disabled')};
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/accounts/:id/password-reset',async(request,reply)=>{
  const actor=await administrator(request);
  if(!uuid(request.params.id)
   ||!noBody(request.body))throw new ApiError(400,'invalid-request');
  const reset=await accounts.issueReset(actor.id,request.params.id);
  return reply.code(201).send({resetUrl:`${config.origin}/reset-password#token=${reset.token}`,expiresAt:reset.expiresAt});
 });
}
