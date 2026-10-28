import {dirname} from 'node:path';
import {openDatabase} from '../../../api/src/db/client.ts';
import {mediaBoss} from '../../../api/src/jobs/mediaQueue.ts';
import {LocalObjectStore} from '../../../api/tests/helpers/localStore.ts';
import {startMediaWorker} from '../../src/jobs/mediaWorker.ts';

try{
 const database=openDatabase(process.env.WANWU_TEST_DATABASE_URL??''),store=LocalObjectStore.existing(process.env.WANWU_TEST_OBJECT_DIRECTORY??'');
 store.download=async(_key,file)=>{process.send?.({type:'claimed',scratch:dirname(file)});await new Promise<never>(()=>{});};
 await startMediaWorker({pool:database.pool,boss:mediaBoss(database.pool),store,origin:'https://example.invalid'},process.env.WANWU_TEST_SCRATCH_ROOT!,{ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'});
}catch{process.send?.({type:'startup-failed'});process.exit(1);}
