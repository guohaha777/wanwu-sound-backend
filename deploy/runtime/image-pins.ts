export const imageKinds=['api','worker','ops','catalogue'] as const;
type Kind=typeof imageKinds[number];
type Image={tag:string;id:string;configDigest:string};
export type ReleaseManifest={project:'wanwu-sound';sourceDigest:string;images:Record<Kind,Image>};
const digest=(value:unknown):value is string=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
export function releaseManifest(value:unknown):ReleaseManifest{
 const manifest=value as ReleaseManifest|null;
 if(manifest?.project!=='wanwu-sound'||!/^[a-f0-9]{64}$/.test(manifest.sourceDigest)||!manifest.images
  ||Object.keys(manifest.images).sort().join()!==[...imageKinds].sort().join())throw new Error('Invalid Wanwu release manifest');
 for(const kind of imageKinds){const image=manifest.images[kind];
  if(!image||!digest(image.id)||!digest(image.configDigest)||!new RegExp(`^wanwu-${kind}:[a-f0-9]{12}-[a-f0-9]{12}$`).test(image.tag))throw new Error('Unpinned Wanwu release image');
 }
 return manifest;
}
export function acceptsImage(image:Image,id:string){return digest(id)&&(id===image.id||id===image.configDigest);}
export function releaseEnvironment(manifest:ReleaseManifest,ids:Record<Kind,string>){
 for(const kind of imageKinds)if(!acceptsImage(manifest.images[kind],ids[kind]))throw new Error('Loaded image does not match a recorded build digest');
 return imageKinds.map(kind=>`WANWU_${kind.toUpperCase()}_IMAGE=${ids[kind]}`).join('\n')+`\nWANWU_SOURCE_DIGEST=${manifest.sourceDigest}\n`;
}
export function environmentPins(text:string,manifest:ReleaseManifest):Record<Kind,string>{
 const fields=new Map<string,string>();
 for(const line of text.trim().split('\n')){const match=/^([A-Z_]+)=(.+)$/.exec(line);if(!match||fields.has(match[1]!))throw new Error('Invalid or duplicate release environment field');fields.set(match[1]!,match[2]!);}
 if(fields.size!==5||fields.get('WANWU_SOURCE_DIGEST')!==manifest.sourceDigest)throw new Error('Release source digest mismatch');
 const ids=Object.fromEntries(imageKinds.map(kind=>[kind,fields.get(`WANWU_${kind.toUpperCase()}_IMAGE`)??''])) as Record<Kind,string>;
 releaseEnvironment(manifest,ids);return ids;
}
