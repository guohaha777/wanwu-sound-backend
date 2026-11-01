import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {NormalizedSource} from '../media/normalize.ts';

/** Private loopback transport, never a public API or an arbitrary-file server. */
export async function sourceServer(bundle:string,sources:ReadonlyMap<string,NormalizedSource>){
 const nonce=randomBytes(24).toString('base64url');
 const document='<!doctype html><script nonce="'+nonce+'">'+bundle.replace(/<\/script/gi,'<\\/script')+'</script>';
 const server=createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  if(request.method!=='GET'){
   response.writeHead(405).end();
   return;
  }
  let url:URL;
  try{url=new URL(request.url??'/','http://127.0.0.1');}catch{
   response.writeHead(400).end();
   return;
  }
  if(url.search){
   response.writeHead(404).end();
   return;
  }
  if(url.pathname==='/'){
   response.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
   response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(document);
   return;
  }
  let source:NormalizedSource|undefined;
  try{if(url.pathname.startsWith('/sources/'))source=sources.get(decodeURIComponent(url.pathname.slice(9)));}
  catch{
   response.writeHead(400).end();
   return;
  }
  if(!source){
   response.writeHead(404).end();
   return;
  }
  // Stream with backpressure. Do not turn every 8+ MiB source into several
  // base64/JSON copies in the browser-control protocol.
  const stream=createReadStream(source.path,{highWaterMark:64*1024});
  stream.once('open',()=>{
   response.writeHead(200,{'Content-Type':'audio/wav','Content-Length':source.bytes});
   stream.pipe(response);
  });
  stream.once('error',()=>{
   if(!response.headersSent)response.writeHead(500).end();
   else response.destroy();
  });
  response.once('close',()=>stream.destroy());
 });
 server.requestTimeout=180_000;
 server.headersTimeout=10_000;
 server.keepAliveTimeout=1000;
 await new Promise<void>((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   server.off('error',reject);
   resolve();
  });
 });
 const address=server.address() as AddressInfo;
 return {origin:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>{
  server.close(error=>error?reject(error):resolve());
  server.closeAllConnections();
 })};
}
