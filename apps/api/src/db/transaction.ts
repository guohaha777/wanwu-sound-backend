import type {Pool,PoolClient} from 'pg';

export async function transaction<T>(pool:Pool,action:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN');try{const value=await action(client);await client.query('COMMIT');return value;}
 catch(error){await client.query('ROLLBACK');throw error;}}
 finally{client.release();}
}
