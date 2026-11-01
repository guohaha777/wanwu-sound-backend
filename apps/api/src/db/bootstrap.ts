import pg from 'pg';
import type {Pool} from 'pg';
import {migrate} from './migrate.ts';
import {installMediaQueue} from '../jobs/mediaQueue.ts';

/** Only the project's new PostgreSQL cluster; never a Supabase/shared role. */
export async function bootstrap(pool:Pool,password:string){
 if(Buffer.byteLength(password)<32)throw new Error('The app database password must contain at least 32 bytes');
 const identity=await pool.query('SELECT current_database() AS name,current_user AS role');
 if(!/^wanwu_sound(?:_test_[a-f0-9]{8})?$/.test(identity.rows[0]?.name)
  ||identity.rows[0]?.role!=='wanwu_owner')throw new Error('Refusing non-Wanwu bootstrap');
 const exists=await pool.query("SELECT 1 FROM pg_roles WHERE rolname='wanwu_app'");
 if(!exists.rows.length){
  const statement=await pool.query<{statement:string}>("SELECT format('CREATE ROLE wanwu_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text) AS statement",[password]);
  await pool.query(statement.rows[0]!.statement);
 }
 const role=await pool.query("SELECT rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='wanwu_app'");
 if(Object.values(role.rows[0]??{}).some(Boolean))throw new Error('The application role has unexpected privileges');
 const memberships=await pool.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='wanwu_app')");
 if(memberships.rows.length)throw new Error('The application role must not inherit cluster roles');
 const connection=pool.options.connectionString;
 if(!connection)throw new Error('The dedicated owner connection URL is required');
 const appUrl=new URL(connection);
 appUrl.username='wanwu_app';
 appUrl.password=password;
 const probe=new pg.Client({connectionString:appUrl.toString(),connectionTimeoutMillis:5000});
 try{
  await probe.connect();
  await probe.query('SELECT 1');
 }
 catch{throw new Error('The application password does not match the existing role; bootstrap does not rotate credentials');}
 finally{await probe.end();}
 await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
 await migrate(pool);
 await pool.query('GRANT USAGE ON SCHEMA public TO wanwu_app');
 await pool.query('GRANT SELECT ON accounts TO wanwu_app');
 await pool.query('GRANT INSERT (id,username,nickname,password_hash,status) ON accounts TO wanwu_app');
 await pool.query('GRANT UPDATE (password_hash,auth_version,status,updated_at) ON accounts TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,UPDATE ON invitations,password_resets TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON sessions TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,DELETE ON revoked_sessions TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT ON admin_audit TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,UPDATE ON sources,uploads,works,render_artifacts,library_entries,publications,stored_objects TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT ON work_snapshots,confirmations,content_audit TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,UPDATE ON maintenance_runs TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,UPDATE ON runtime_status TO wanwu_app');
 await pool.query('GRANT SELECT,INSERT,DELETE ON work_source_refs TO wanwu_app');
 await installMediaQueue(pool);
}
