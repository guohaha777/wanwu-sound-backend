import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';
import {dedicatedDatabaseUrl} from '../config.ts';

export function openDatabase(url:string,role:'app'|'owner'='app'){
 const pool=new pg.Pool({connectionString:dedicatedDatabaseUrl(url,role),max:4,connectionTimeoutMillis:5000,
  idleTimeoutMillis:30_000,statement_timeout:10_000,application_name:`wanwu-${role}`});
 return {pool,db:drizzle(pool,{schema}),close:()=>pool.end()};
}
export type Database=ReturnType<typeof openDatabase>['db'];
