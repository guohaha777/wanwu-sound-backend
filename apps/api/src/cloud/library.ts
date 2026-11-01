import { randomUUID } from 'node:crypto';
import { confirmed, cloudId, isoDate, CONFIRMATION_VERSION } from '@wanwu-v2/contracts/cloud';
import type { LibraryEntry, LibraryScope } from '@wanwu-v2/contracts/cloud';
import { exactObject } from '@wanwu-v2/contracts/account';
import { parseSoundUnitDraft } from '@wanwu-v2/contracts/sound';
import type { SoundUnitDraft } from '@wanwu-v2/contracts/sound';
import type { Actor, CloudContext, SourceRow } from './context.ts';
import { lockActor, audit, digest } from './context.ts';
import { Sources, authorizedSource } from './sources.ts';
import { transaction } from '../db/transaction.ts';
import { ApiError } from '../errors.ts';

export class Library {
  readonly context: CloudContext;
  readonly sources: Sources;
  constructor(context: CloudContext, sources: Sources) {
    this.context = context;
    this.sources = sources;
  }
  private unit(value: unknown, source: SourceRow): SoundUnitDraft | null {
    const unit = parseSoundUnitDraft(value);
    if (
      !unit ||
      Object.keys(unit).some(
        (key) =>
          ![
            'version',
            'id',
            'sourceId',
            'name',
            'maker',
            'markerIndex',
            'shape',
            'input',
            'createdAt',
            'analysis',
          ].includes(key),
      ) ||
      unit.sourceId !== source.id ||
      !cloudId(unit.id, 'unit') ||
      !isoDate(unit.createdAt) ||
      unit.markerIndex > 11
    )
      return null;
    return { ...unit, analysis: source.analysis! };
  }
  async create(actor: Actor, body: unknown) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'invalid-request');
    const value = body as Record<string, unknown>,
      kind = value.kind;
    if (
      (kind !== 'source' && kind !== 'sound-unit') ||
      !exactObject(
        body,
        kind === 'source'
          ? ['sourceId', 'kind', 'scope', 'confirmation']
          : ['sourceId', 'kind', 'scope', 'unit', 'confirmation'],
      ) ||
      typeof value.sourceId !== 'string' ||
      !['private', 'teachers'].includes(value.scope as string)
    )
      throw new ApiError(400, 'invalid-request');
    if (!confirmed(value.confirmation)) throw new ApiError(400, 'confirmation-required');
    return transaction(this.context.pool, async (tx) => {
      await lockActor(tx, actor);
      const source = await authorizedSource(tx, actor, value.sourceId as string);
      if (source.status !== 'ready') throw new ApiError(409, 'source-not-ready');
      const unit = kind === 'sound-unit' ? this.unit(value.unit, source) : null;
      if (kind === 'sound-unit' && !unit) throw new ApiError(400, 'invalid-request');
      const id = randomUUID(),
        confirmation = randomUUID();
      await tx.query(
        "INSERT INTO confirmations(id,actor_id,kind,target_id,fingerprint,parameters,statement_version) VALUES($1,$2,'library',$3,$4,$5,$6)",
        [
          confirmation,
          actor.id,
          id,
          source.checksum,
          JSON.stringify({
            kind,
            scope: value.scope,
            unit,
            playbackChecksum: source.playback_checksum,
            selection: source.selection,
            parametersHash: digest(unit),
          }),
          CONFIRMATION_VERSION,
        ],
      );
      await tx.query(
        'INSERT INTO library_entries(id,owner_id,source_id,kind,scope,unit,source_checksum,confirmation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          actor.id,
          source.id,
          kind,
          value.scope,
          unit ? JSON.stringify(unit) : null,
          source.checksum,
          confirmation,
        ],
      );
      await audit(tx, actor.id, 'library.created', id);
      return { entryId: id };
    });
  }
  async list(
    actor: Actor,
    kind: 'source' | 'sound-unit',
    scope: 'mine' | 'teachers',
    cursor: string | null,
  ) {
    const offset = cursor === null ? 0 : /^\d+$/.test(cursor) ? Number(cursor) : NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
      throw new ApiError(400, 'invalid-request');
    return transaction(this.context.pool, async (tx) => {
      await lockActor(tx, actor);
      const rows = (
        await tx.query(
          `SELECT l.*,c.confirmed_at,c.statement_version FROM library_entries l JOIN sources s ON s.id=l.source_id
    JOIN accounts a ON a.id=l.owner_id JOIN confirmations c ON c.id=l.confirmation_id WHERE l.kind=$1
    AND l.removed_at IS NULL AND l.disabled_at IS NULL AND s.status='ready' AND a.status='active'
    AND (($2='mine' AND l.owner_id=$3) OR ($2='teachers' AND l.scope='teachers')) ORDER BY l.created_at DESC,l.id DESC LIMIT 51 OFFSET $4`,
          [kind, scope, actor.id, offset],
        )
      ).rows;
      const items: LibraryEntry[] = [];
      for (const row of rows.slice(0, 50)) {
        const source = await authorizedSource(tx, actor, row.source_id);
        items.push({
          entryId: row.id,
          sourceId: row.source_id,
          kind: row.kind,
          scope: row.scope,
          unit: row.unit,
          mine: row.owner_id === actor.id,
          source: await this.sources.view(source),
          confirmation: {
            confirmedAt: row.confirmed_at.toISOString(),
            sourceChecksum: row.source_checksum,
            statementVersion: row.statement_version,
          },
        });
      }
      return { items, nextCursor: rows.length > 50 ? String(offset + 50) : null };
    });
  }
  async edit(actor: Actor, id: string, body: unknown) {
    const input = body as { scope: LibraryScope; unit?: unknown; confirmation: unknown } | null;
    if (!input || !['private', 'teachers'].includes(input.scope) || !confirmed(input.confirmation))
      throw new ApiError(400, 'confirmation-required');
    return transaction(this.context.pool, async (tx) => {
      await lockActor(tx, actor);
      const entry = (
        await tx.query(
          'SELECT * FROM library_entries WHERE id=$1 AND owner_id=$2 AND removed_at IS NULL AND disabled_at IS NULL',
          [id, actor.id],
        )
      ).rows[0];
      if (!entry) throw new ApiError(404, 'not-found');
      if (
        !exactObject(
          input,
          entry.kind === 'source' ? ['scope', 'confirmation'] : ['scope', 'unit', 'confirmation'],
        )
      )
        throw new ApiError(400, 'invalid-request');
      const source = await authorizedSource(tx, actor, entry.source_id);
      if (source.status !== 'ready') throw new ApiError(409, 'source-not-ready');
      if (
        !(
          await tx.query(
            'SELECT id FROM library_entries WHERE id=$1 AND owner_id=$2 AND removed_at IS NULL AND disabled_at IS NULL FOR UPDATE',
            [id, actor.id],
          )
        ).rowCount
      )
        throw new ApiError(404, 'not-found');
      const unit = entry.kind === 'sound-unit' ? this.unit(input.unit, source) : null;
      if (entry.kind === 'sound-unit' && !unit) throw new ApiError(400, 'invalid-request');
      const confirmation = randomUUID();
      await tx.query(
        "INSERT INTO confirmations(id,actor_id,kind,target_id,fingerprint,parameters,statement_version) VALUES($1,$2,'library',$3,$4,$5,$6)",
        [
          confirmation,
          actor.id,
          id,
          source.checksum,
          JSON.stringify({
            kind: entry.kind,
            scope: input.scope,
            unit,
            playbackChecksum: source.playback_checksum,
            selection: source.selection,
            parametersHash: digest(unit),
          }),
          CONFIRMATION_VERSION,
        ],
      );
      await tx.query(
        'UPDATE library_entries SET scope=$2,unit=$3,confirmation_id=$4,updated_at=now() WHERE id=$1',
        [id, input.scope, unit ? JSON.stringify(unit) : null, confirmation],
      );
      await audit(tx, actor.id, 'library.updated', id);
      return { entryId: id };
    });
  }
  async remove(actor: Actor, id: string) {
    return transaction(this.context.pool, async (tx) => {
      await lockActor(tx, actor);
      const entry = (
        await tx.query('SELECT * FROM library_entries WHERE id=$1 AND owner_id=$2', [id, actor.id])
      ).rows[0];
      if (!entry) throw new ApiError(404, 'not-found');
      await tx.query('SELECT id FROM sources WHERE id=$1 FOR UPDATE', [entry.source_id]);
      await tx.query(
        'UPDATE library_entries SET removed_at=coalesce(removed_at,now()),updated_at=now() WHERE id=$1',
        [id],
      );
      await audit(tx, actor.id, 'library.removed', id);
    });
  }
}
