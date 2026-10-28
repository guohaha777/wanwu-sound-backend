import {build} from 'esbuild';
import {chromium} from 'playwright';
import type {Browser,BrowserContext} from 'playwright';
import {fileURLToPath} from 'node:url';
import type {RenderInput} from '@wanwu-v2/audio-engine/render';
import {MediaError} from '../media/tools.ts';
import type {NormalizedSource} from '../media/normalize.ts';
import {linuxSandboxEnabled} from './sandbox.ts';
import {sourceServer} from './source-server.ts';
import {ResultReceiver} from './result-transfer.ts';

export async function browserBundle(){
 const result=await build({entryPoints:[fileURLToPath(new URL('./entry.ts',import.meta.url))],bundle:true,
  platform:'browser',format:'iife',globalName:'WanwuRender',write:false,target:'es2022'});
 return result.outputFiles[0]!.text;
}

export async function openRenderer(){
 if(process.platform==='linux'&&process.getuid?.()===0)throw new MediaError('renderer-must-be-non-root');
 const executablePath=process.env.WANWU_CHROMIUM_EXECUTABLE??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,channel:'chromium',timeout:30_000,
  ...(executablePath?{executablePath}:{}),args:['--disable-background-networking','--disable-component-update','--js-flags=--max-old-space-size=128']});
 try{
  let status='Linux sandbox inspection is unavailable on this platform; the Linux container gate is still pending.';
  if(process.platform==='linux'){
   const page=await browser.newPage();await page.goto('chrome://sandbox');
   status=await page.locator('body').innerText();await page.close();
  }
  const linuxSandboxVerified=process.platform==='linux'&&linuxSandboxEnabled(status);
  if(process.platform==='linux'&&!linuxSandboxVerified)throw new MediaError('renderer-sandbox-unverified');
  return {browser,identity:{browserVersion:browser.version(),platform:process.platform,linuxSandboxVerified,sandboxStatus:status.slice(0,4096)}};
 }catch(error){await browser.close();throw error;}
}

export async function renderInBrowser(browser:Browser,bundle:string,input:RenderInput,sources:ReadonlyMap<string,NormalizedSource>,timeoutMs=180_000){
 const transport=await sourceServer(bundle,sources);
 let context:BrowserContext|undefined;
 const output=new ResultReceiver();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==transport.origin)return route.abort('blockedbyclient');
   if(url.pathname==='/'&&request.method()==='GET')return route.continue();
   if(url.pathname==='/result'&&request.method()==='POST'){
    const bytes=request.postDataBuffer();
    const status=bytes?output.accept(Number(url.searchParams.get('total')??NaN),Number(url.searchParams.get('offset')??NaN),bytes):'invalid';
    return route.fulfill({status:status==='accepted'?204:status==='conflict'?409:413,body:''});
   }
   if(url.pathname.startsWith('/sources/')&&request.method()==='GET'){
    let source:NormalizedSource|undefined;
    try{source=sources.get(decodeURIComponent(url.pathname.slice('/sources/'.length)));}
    catch{return route.fulfill({status:400,body:''});}
    if(source)return route.continue();
   }
   return route.fulfill({status:404,body:''});
  });
  const page=await context.newPage(),started=Date.now();
  await page.exposeFunction('wanwuProgress',(step:number)=>{if(Number.isInteger(step)&&step>0&&step<=30)console.log(JSON.stringify({event:'wanwu-render-step',step,elapsedMs:Date.now()-started}));});
  await page.goto(transport.origin,{waitUntil:'load',timeout:30_000});
  const run=page.evaluate(async data=>{
   const renderer=(window as unknown as {WanwuRender:{render:(value:RenderInput)=>Promise<Record<string,unknown>>}}).WanwuRender;
   return renderer.render(data);
  },input);
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new MediaError('render-timeout')),timeoutMs);});
  const metrics=await Promise.race([run,expired]);
  const bytes=output.result;if(!bytes)throw new MediaError('missing-render-output');
  return {wav:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),metrics};
 }finally{clearTimeout(timer);try{await context?.close();}finally{await transport.close();}}
}
