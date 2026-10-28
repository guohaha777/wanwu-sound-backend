import {openDatabase} from './client.ts';
import {bootstrap} from './bootstrap.ts';

const database=openDatabase(process.env.WANWU_MIGRATION_DATABASE_URL??'','owner');
try{await bootstrap(database.pool,process.env.WANWU_APP_DB_PASSWORD??'');console.log('Dedicated Wanwu database initialized.');}
catch{console.error('Wanwu database initialization failed; no credentials are logged.');process.exitCode=1;}
finally{await database.close();}
