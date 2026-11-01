import test from 'node:test';
import assert from 'node:assert/strict';
import {probe} from '../scripts/probe-deployment.mjs';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const fixture=(health,auth)=>async url=>url.endsWith('/auth/me')?auth():health();
test('a healthy entry and unauthenticated real session endpoint pass only the read-only gate',async()=>{
 const result=await probe(undefined,undefined,fixture(()=>json(200,{status:'ok'}),()=>json(401,{status:'error',reason:'needs-account'})));
 assert.equal(result.status,'pass');
 assert.match(result.scope,/not a login/);
});
test('HTTP 200 HTML from SPA fallback is not accepted as a working API',async()=>{
 const result=await probe(undefined,undefined,fixture(()=>new Response('<html>old frontend</html>',{headers:{'Content-Type':'text/html'}}),()=>json(401,{reason:'needs-account'})));
 assert.equal(result.status,'blocked-routing-or-backend');
});
test('disabled authentication is reported as blocked, not as successful integration',async()=>{
 const result=await probe(undefined,undefined,fixture(()=>json(200,{status:'ok'}),()=>json(503,{status:'error',reason:'not-open'})));
 assert.equal(result.status,'blocked-auth-disabled');
});
test('network failure and unexpected public auth response do not pass',async()=>{
 assert.equal((await probe(undefined,undefined,async()=>{throw new Error('fixture');})).status,'blocked-routing-or-backend');
 assert.equal((await probe(undefined,undefined,fixture(()=>json(200,{status:'ok'}),()=>json(200,{account:{id:'must-not-log-account'}})))).status,'blocked-session-entry');
});
test('probe refuses credentials, query strings and non-HTTPS destinations',async()=>{
 const credentialUrl=new URL('https://example.com');
 credentialUrl.username='fixture-user';
 credentialUrl.password='fixture-password';
 for(const url of ['http://localhost',credentialUrl.href,'https://example.com?secret=x','https://example.com/path'])await assert.rejects(probe(url));
});
