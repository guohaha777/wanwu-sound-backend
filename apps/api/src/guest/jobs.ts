// Background jobs, kept in this API process for ten minutes. A restart loses them; the page then gets 404 for the job
// and moves on to the next step, as with any failure. Enough for one API instance; a database queue can replace it.
import {randomUUID} from 'node:crypto';
import type {BackgroundResult} from '@wanwu-v2/contracts/background';

const TTL_MS=10*60_000,MAX_JOBS=2000,MAX_WORKS=5000;
export type JobState={status:'pending'}|BackgroundResult;

export class BackgroundJobs{
 private readonly jobs=new Map<string,{state:JobState;expires:number}>();
 private readonly attempts=new Map<string,number>();
 private readonly clock:()=>number;
 constructor(clock:()=>number=Date.now){this.clock=clock;}
 private prune(){const now=this.clock();for(const [id,job] of this.jobs)if(job.expires<=now)this.jobs.delete(id);}
 /** null when the process already holds too many jobs (the route answers busy). */
 start(run:()=>Promise<BackgroundResult>):string|null{
  this.prune();if(this.jobs.size>=MAX_JOBS)return null;
  const id=randomUUID(),expires=this.clock()+TTL_MS;
  this.jobs.set(id,{state:{status:'pending'},expires});
  void run().catch(():BackgroundResult=>({status:'unavailable',reason:'failed'})).then(state=>{if(this.jobs.has(id))this.jobs.set(id,{state,expires});});
  return id;
 }
 get(id:string):JobState|null{this.prune();return this.jobs.get(id)?.state??null;}
 /** How many times AI notes were asked for this work: the prompt asks for a different motif from the second time. */
 attempt(workId:string){
  const count=this.attempts.get(workId)??0;
  if(!this.attempts.has(workId)&&this.attempts.size>=MAX_WORKS)this.attempts.clear();
  this.attempts.set(workId,count+1);return count;
 }
}
