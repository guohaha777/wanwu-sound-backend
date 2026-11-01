import type {FastifyReply} from 'fastify';

export const COOKIE_NAME='__Host-wanwu';
/** Drops the session cookie: logout, a password change or reset, or a session the server no longer accepts. */
export const clearSessionCookie=(reply:FastifyReply)=>reply.clearCookie(COOKIE_NAME,{path:'/',secure:true,httpOnly:true,sameSite:'lax'});
