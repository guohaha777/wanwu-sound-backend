import {randomBytes,createCipheriv,createDecipheriv,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,constants,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,appendFile,unlink,stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import type {Readable} from 'node:stream';

const magic=Buffer.from('WANWU-BACKUP-1\n');
/** Standard AES-256-GCM plus RSA-OAEP-SHA256 envelope. The server needs only an OFF-SERVER-generated public key. */
export async function encryptBackup(input:Readable,file:string,publicPem:string,signal?:AbortSignal){
 if(publicPem.includes('PRIVATE KEY'))throw new Error('backup-server-must-only-have-public-key');
 const publicKey=createPublicKey(publicPem);
 if(publicKey.asymmetricKeyType!=='rsa'||(publicKey.asymmetricKeyDetails?.modulusLength??0)<3072)throw new Error('backup-rsa-key-too-small');
 const key=randomBytes(32),iv=randomBytes(12),wrapped=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
 const header=Buffer.from(JSON.stringify({v:1,cipher:'AES-256-GCM',wrap:'RSA-OAEP-SHA256',database:'wanwu_sound',createdAt:new Date().toISOString(),iv:iv.toString('base64'),key:wrapped.toString('base64')})+'\n');
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.concat([magic,header]));
 let created=false;
 try{
  const handle=await open(file,'wx',0o600);created=true;await handle.writeFile(Buffer.concat([magic,header]));await handle.close();
  await pipeline(input,cipher,createWriteStream(file,{flags:'a',mode:0o600}),{signal});await appendFile(file,cipher.getAuthTag());
  return {bytes:(await stat(file)).size,checksum:await backupChecksum(file)};
 }catch(error){if(created)await unlink(file).catch(()=>{});throw error;}finally{key.fill(0);}
}
export async function decryptBackup(file:string,target:string,privatePem:string,signal?:AbortSignal){
 const size=(await stat(file)).size;if(size<128||size>1024*1024*1024)throw new Error('backup-size-invalid');
 const handle=await open(file,'r'),prefix=Buffer.alloc(Math.min(4096,size));let tag:Buffer,header:Buffer,offset:number;
 try{
  await handle.read(prefix,0,prefix.length,0);if(!prefix.subarray(0,magic.length).equals(magic))throw new Error('invalid-backup-format');
  offset=prefix.indexOf(10,magic.length)+1;if(offset<=magic.length||offset>=size-16)throw new Error('invalid-backup-header');
  header=prefix.subarray(magic.length,offset);tag=Buffer.alloc(16);await handle.read(tag,0,16,size-16);
 }finally{await handle.close();}
 const envelope=JSON.parse(header.toString()) as {v:number;cipher:string;wrap:string;database:string;iv:string;key:string};
 if(envelope.v!==1||envelope.cipher!=='AES-256-GCM'||envelope.wrap!=='RSA-OAEP-SHA256'||envelope.database!=='wanwu_sound')throw new Error('unsupported-backup-format');
 const privateKey=createPrivateKey(privatePem);if(privateKey.asymmetricKeyType!=='rsa')throw new Error('invalid-backup-key');
 const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64')),iv=Buffer.from(envelope.iv,'base64');
 if(key.length!==32||iv.length!==12)throw new Error('invalid-backup-envelope');
 const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);decipher.setAAD(Buffer.concat([magic,header]));
 let created=false;
 try{
  const output=await open(target,'wx',0o600);created=true;await output.close();
  await pipeline(createReadStream(file,{start:offset,end:size-17}),decipher,createWriteStream(target,{flags:'a',mode:0o600}),{signal});
 }catch(error){if(created)await unlink(target).catch(()=>{});throw error;}finally{key.fill(0);}
}
export async function backupChecksum(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk as Buffer);return hash.digest('hex');}
