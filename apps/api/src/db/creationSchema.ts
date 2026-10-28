import {boolean,doublePrecision,integer,jsonb,pgTable,primaryKey,text,timestamp,uuid,varchar} from 'drizzle-orm/pg-core';
import type {SoundAnalysis,SoundSource,SoundUnitDraft} from '@wanwu-v2/contracts/sound';
import type {Arrangement} from '@wanwu-v2/contracts/arrangement';
import type {ComposeSettings} from '@wanwu-v2/contracts/work';
import type {WorkContent} from '@wanwu-v2/contracts/cloud';

// SQL migrations remain the checksum-locked authority for FKs, CHECKs, indexes and grants.
// Business transactions use pg explicitly for lock order/conditional updates; these are their typed Drizzle projections.
const date=(name:string)=>timestamp(name,{withTimezone:true,mode:'date'});
export const sources=pgTable('sources',{
 id:text('id').primaryKey(),ownerId:uuid('owner_id'),catalogue:boolean('catalogue').notNull().default(false),
 metadata:jsonb('metadata').$type<SoundSource>().notNull(),checksum:varchar('checksum',{length:64}).notNull(),bytes:integer('bytes').notNull(),
 status:text('status').notNull().default('uploading'),originalKey:text('original_key'),originalVersion:text('original_version'),
 playbackKey:text('playback_key'),playbackChecksum:varchar('playback_checksum',{length:64}),analysis:jsonb('analysis').$type<SoundAnalysis>(),
 durationMs:doublePrecision('duration_ms'),failure:text('failure'),leaseId:uuid('lease_id'),parentId:text('parent_id'),
 selection:jsonb('selection').$type<{startMs:number;endMs:number}>(),createdAt:date('created_at').notNull().defaultNow(),updatedAt:date('updated_at').notNull().defaultNow(),
});
export const uploads=pgTable('uploads',{
 id:uuid('id').primaryKey(),sourceId:text('source_id').notNull().unique(),temporaryKey:text('temporary_key').notNull().unique(),finalKey:text('final_key').notNull().unique(),
 expiresAt:date('expires_at').notNull(),createdAt:date('created_at').notNull().defaultNow(),completedAt:date('completed_at'),temporaryDeletedAt:date('temporary_deleted_at'),
});
export const works=pgTable('works',{
 id:text('id').primaryKey(),ownerId:uuid('owner_id').notNull(),title:varchar('title',{length:64}).notNull(),revision:integer('revision').notNull().default(1),
 state:text('state').notNull().default('draft'),arrangement:jsonb('arrangement').$type<Arrangement>().notNull(),settings:jsonb('settings').$type<ComposeSettings>().notNull(),
 savedRevision:integer('saved_revision'),createdAt:date('created_at').notNull().defaultNow(),updatedAt:date('updated_at').notNull().defaultNow(),deletedAt:date('deleted_at'),
});
export const workSourceRefs=pgTable('work_source_refs',{
 workId:text('work_id').notNull(),sourceId:text('source_id').notNull(),createdAt:date('created_at').notNull().defaultNow(),
},table=>[primaryKey({columns:[table.workId,table.sourceId]})]);
export const workSnapshots=pgTable('work_snapshots',{
 workId:text('work_id').notNull(),revision:integer('revision').notNull(),content:jsonb('content').$type<WorkContent>().notNull(),
 sourceRefs:jsonb('source_refs').$type<unknown[]>().notNull(),rules:jsonb('rules').$type<Record<string,string>>().notNull(),rendererVersion:text('renderer_version').notNull(),
 timbreVersion:text('timbre_version').notNull(),inputDigest:varchar('input_digest',{length:64}).notNull(),createdAt:date('created_at').notNull().defaultNow(),
},table=>[primaryKey({columns:[table.workId,table.revision]})]);
export const renderArtifacts=pgTable('render_artifacts',{
 id:uuid('id').primaryKey(),workId:text('work_id').notNull(),revision:integer('revision').notNull(),inputDigest:varchar('input_digest',{length:64}).notNull(),
 status:text('status').notNull(),jobId:uuid('job_id'),leaseId:uuid('lease_id'),objectKey:text('object_key'),checksum:varchar('checksum',{length:64}),bytes:integer('bytes'),
 durationMs:doublePrecision('duration_ms'),failure:text('failure'),rendererRuntime:jsonb('renderer_runtime').$type<Record<string,string|null>>(),createdAt:date('created_at').notNull().defaultNow(),updatedAt:date('updated_at').notNull().defaultNow(),
});
export const confirmations=pgTable('confirmations',{
 id:uuid('id').primaryKey(),actorId:uuid('actor_id').notNull(),kind:text('kind').notNull(),targetId:text('target_id').notNull(),fingerprint:varchar('fingerprint',{length:64}).notNull(),
 parameters:jsonb('parameters').$type<Record<string,unknown>>().notNull(),statementVersion:text('statement_version').notNull(),confirmedAt:date('confirmed_at').notNull().defaultNow(),
});
export const libraryEntries=pgTable('library_entries',{
 id:uuid('id').primaryKey(),ownerId:uuid('owner_id').notNull(),sourceId:text('source_id').notNull(),kind:text('kind').notNull(),scope:text('scope').notNull(),
 unit:jsonb('unit').$type<SoundUnitDraft>(),sourceChecksum:varchar('source_checksum',{length:64}).notNull(),confirmationId:uuid('confirmation_id').notNull(),
 createdAt:date('created_at').notNull().defaultNow(),updatedAt:date('updated_at').notNull().defaultNow(),removedAt:date('removed_at'),disabledAt:date('disabled_at'),
});
export const publications=pgTable('publications',{
 workId:text('work_id').primaryKey(),revision:integer('revision').notNull(),token:varchar('token',{length:43}).notNull().unique(),status:text('status').notNull(),generation:uuid('generation').notNull(),
 confirmationId:uuid('confirmation_id').notNull(),createdAt:date('created_at').notNull().defaultNow(),publishedAt:date('published_at'),revokedAt:date('revoked_at'),
});
export const contentAudit=pgTable('content_audit',{
 id:uuid('id').primaryKey(),actorId:uuid('actor_id').notNull(),action:text('action').notNull(),targetId:text('target_id').notNull(),createdAt:date('created_at').notNull().defaultNow(),
});
export const storedObjects=pgTable('stored_objects',{
 objectKey:text('object_key').primaryKey(),kind:text('kind').notNull(),sourceId:text('source_id'),renderId:uuid('render_id'),
 createdAt:date('created_at').notNull().defaultNow(),collectAfter:date('collect_after'),deletedAt:date('deleted_at'),gcCheckedAt:date('gc_checked_at'),
});
export const maintenanceRuns=pgTable('maintenance_runs',{
 id:uuid('id').primaryKey(),kind:text('kind').notNull(),status:text('status').notNull(),counts:jsonb('counts').$type<Record<string,number>>().notNull(),
 startedAt:date('started_at').notNull().defaultNow(),finishedAt:date('finished_at'),
});
export const runtimeStatus=pgTable('runtime_status',{
 component:text('component').primaryKey(),seenAt:date('seen_at').notNull().defaultNow(),
});
