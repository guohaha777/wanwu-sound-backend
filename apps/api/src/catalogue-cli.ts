import {openDatabase} from './db/client.ts';
import {OssStore,ossConfig} from './storage/ossStore.ts';
import {mediaBoss} from './jobs/mediaQueue.ts';
import {seedCatalogue} from './catalogue.ts';

const database=openDatabase(process.env.WANWU_MIGRATION_DATABASE_URL??'','owner'),boss=mediaBoss(database.pool);
try{
 await boss.start();
 await seedCatalogue(database.pool,{pool:database.pool,boss,store:new OssStore(ossConfig()),origin:process.env.WANWU_APP_ORIGIN??'https://voiceatalass.netlify.app'});
 console.log('Release catalogue originals verified and queued; no teacher library admission performed.');
}catch{console.error('Catalogue seed failed; no credentials or object URLs are logged.');process.exitCode=1;}
finally{await boss.stop().catch(()=>{});await database.close();}
