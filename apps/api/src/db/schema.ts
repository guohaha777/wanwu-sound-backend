import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AccountRole, AccountStatus } from '@wanwu-v2/contracts/account';
export * from './creationSchema.ts';

const date = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  nickname: varchar('nickname', { length: 64 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).$type<AccountRole>().notNull().default('teacher'),
  status: varchar('status', { length: 16 }).$type<AccountStatus>().notNull().default('active'),
  authVersion: integer('auth_version').notNull().default(1),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
});
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  digest: varchar('digest', { length: 64 }).notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => accounts.id),
  createdAt: date('created_at').notNull().defaultNow(),
  expiresAt: date('expires_at').notNull(),
  redeemedBy: uuid('redeemed_by').references(() => accounts.id),
  redeemedAt: date('redeemed_at'),
  revokedAt: date('revoked_at'),
});
export const sessions = pgTable('sessions', {
  digest: varchar('digest', { length: 64 }).primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id),
  authVersion: integer('auth_version'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdAt: date('created_at').notNull(),
  expiresAt: date('expires_at').notNull(),
  absoluteExpiresAt: date('absolute_expires_at').notNull(),
});
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey(),
  digest: varchar('digest', { length: 64 }).notNull().unique(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => accounts.id),
  createdAt: date('created_at').notNull().defaultNow(),
  expiresAt: date('expires_at').notNull(),
  usedAt: date('used_at'),
  revokedAt: date('revoked_at'),
});
export const revokedSessions = pgTable('revoked_sessions', {
  digest: varchar('digest', { length: 64 }).primaryKey(),
  expiresAt: date('expires_at').notNull(),
});
export const adminAudit = pgTable('admin_audit', {
  id: uuid('id').primaryKey(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  action: varchar('action', { length: 64 }).notNull(),
  targetId: uuid('target_id').notNull(),
  createdAt: date('created_at').notNull().defaultNow(),
});
