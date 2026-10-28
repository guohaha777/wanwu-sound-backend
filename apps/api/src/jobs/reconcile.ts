import type {Pool} from 'pg';

/** A process killed on its final attempt cannot run the normal catch block. Queue expiry is authoritative. */
export async function reconcileMedia(pool:Pool){
 const renders=await pool.query(`UPDATE render_artifacts r SET status='failed',failure='worker-interrupted',lease_id=NULL,updated_at=now()
  FROM wanwu_jobs.job j WHERE r.job_id=j.id AND r.status IN ('queued','processing') AND j.name='media' AND j.state IN ('failed','cancelled')`);
 const sources=await pool.query(`UPDATE sources s SET status='failed',failure='worker-interrupted',lease_id=NULL,updated_at=now()
  WHERE s.status IN ('queued','processing') AND EXISTS(SELECT 1 FROM wanwu_jobs.job j WHERE j.name='media' AND j.data->>'kind'='source' AND j.data->>'sourceId'=s.id AND j.state IN ('failed','cancelled'))
  AND NOT EXISTS(SELECT 1 FROM wanwu_jobs.job live WHERE live.name='media' AND live.data->>'kind'='source' AND live.data->>'sourceId'=s.id AND live.state IN ('created','retry','active'))`);
 return {renders:renders.rowCount??0,sources:sources.rowCount??0};
}
