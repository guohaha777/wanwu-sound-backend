import { eventsInOrder } from '@wanwu-v2/contracts/arrangement';
import type { Arrangement, PlacedEvent, SourceClip } from '@wanwu-v2/contracts/arrangement';
import type { ChosenShape, SoundAnalysis, SoundUnitDraft } from '@wanwu-v2/contracts/sound';
import { MIX_RULES } from '@wanwu-v2/sound-rules/rules';
import { clipHeardSeconds } from '@wanwu-v2/sound-rules/shaping';

export function heardSeconds(
  unit: Pick<SoundUnitDraft, 'shape' | 'analysis'>,
  event: Pick<PlacedEvent, 'clip'>,
) {
  return clipHeardSeconds(unit.shape, unit.analysis ?? null, event.clip);
}
export function unitOf(arrangement: Arrangement | null, unitId: string) {
  return arrangement?.units.find((unit) => unit.id === unitId) ?? null;
}

export type PlannedEvent = {
  eventId: string;
  unitId: string;
  sourceId: string;
  startSeconds: number;
  clip: SourceClip;
  shape: ChosenShape;
  analysis: SoundAnalysis | null;
};
export function planPlayback(arrangement: Arrangement): PlannedEvent[] {
  return eventsInOrder(arrangement.events).flatMap((event) => {
    const unit = unitOf(arrangement, event.unitId);
    return unit
      ? [
          {
            eventId: event.id,
            unitId: unit.id,
            sourceId: unit.sourceId,
            startSeconds: event.at * arrangement.spanSeconds,
            clip: event.clip,
            shape: unit.shape,
            analysis: unit.analysis ?? null,
          },
        ]
      : [];
  });
}

/**
 * Where everything stops: the chosen length plus the little a last sound may run past it (mix rules `ending`, 45 s →
 * at most 50 s). What would sound later is cut — only what is heard; the child's clip and recording stay as they are.
 */
export const cutSeconds = (arrangement: Pick<Arrangement, 'spanSeconds'>) =>
  arrangement.spanSeconds + MIX_RULES.ending.overrunSeconds;
/** How long an occurrence is heard in the piece: its own length, cut where the piece stops. */
export function heardInPiece(
  arrangement: Arrangement,
  unit: Pick<SoundUnitDraft, 'shape' | 'analysis'>,
  event: Pick<PlacedEvent, 'clip' | 'at'>,
) {
  return Math.max(
    0,
    Math.min(
      heardSeconds(unit, event),
      cutSeconds(arrangement) - event.at * arrangement.spanSeconds,
    ),
  );
}

/** `seconds` / `end`: as heard in the piece (cut where it stops). */
export type TimedEvent = {
  event: PlacedEvent;
  unit: SoundUnitDraft;
  start: number;
  seconds: number;
  end: number;
};
export function timedEvents(arrangement: Arrangement): TimedEvent[] {
  return eventsInOrder(arrangement.events).flatMap((event) => {
    const unit = unitOf(arrangement, event.unitId);
    if (!unit) return [];
    const start = event.at * arrangement.spanSeconds;
    const seconds = heardInPiece(arrangement, unit, event);
    return [{ event, unit, start, seconds, end: start + seconds }];
  });
}
/** When the last sound ends (cut where the piece stops). */
export function soundsEnd(arrangement: Arrangement) {
  return Math.max(0, ...timedEvents(arrangement).map((item) => item.end));
}
/** The piece's length: the chosen length, or a little longer so a last sound may finish — never past `cutSeconds`. */
export function pieceSeconds(arrangement: Arrangement) {
  // Rounded up to a tenth of a second.
  return Math.min(
    cutSeconds(arrangement),
    Math.max(arrangement.spanSeconds, Math.ceil(soundsEnd(arrangement) * 10 - 1e-6) / 10),
  );
}
