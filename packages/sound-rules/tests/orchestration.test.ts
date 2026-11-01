import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundPlan, assignParts } from '../src/background.ts';
import { orchestrateBackground, ORCHESTRATION_RULES } from '../src/orchestration.ts';

const organ = { id: 'organ', lead: ['chord', 'bass'] as const, can: ['melody'] as const };
const wood = { id: 'wood', lead: ['melody'] as const, can: ['chord', 'bass'] as const };
const drum = { id: 'drum', lead: ['rhythm'] as const, can: [] };
const plan = () =>
  backgroundPlan({
    seconds: 20,
    mood: 'calm',
    seed: 'orchestration',
    textbook: null,
    sounding: [{ start: 0, end: 2 }],
  });

test('no selection keeps the original plan and part allocation exactly', () => {
  const piece = plan();
  const result = orchestrateBackground(piece, [], []);
  assert.equal(result.plan, piece);
  assert.deepEqual(result.parts, assignParts([]));
  assert.deepEqual(result.gains, {});
});

test('one pitched instrument performs all pitched parts, preserving every original note', () => {
  for (const player of [organ, wood]) {
    const piece = plan();
    const result = orchestrateBackground(piece, [player], []);
    for (const part of ['chord', 'bass', 'melody'] as const)
      assert.deepEqual(result.parts[part], [player.id]);
    assert.deepEqual(result.plan.notes, piece.notes);
    assert.deepEqual(result.gains, {});
  }
});

test('ensemble shares roles; a wood player with no melody joins the organ harmonies', () => {
  const piece = plan();
  piece.notes = piece.notes.filter((note) => note.part !== 'melody');
  const copy = structuredClone(piece);
  const result = orchestrateBackground(piece, [organ, wood], []);
  assert.deepEqual(result.parts.chord, ['organ', 'wood']);
  assert.deepEqual(result.parts.bass, ['organ']);
  assert.deepEqual(piece, copy, 'never mutate the composition');
});

test('a chosen drummer adds bounded, quiet beats that follow metre and step back under the child', () => {
  const piece = plan();
  piece.notes = piece.notes.filter((note) => note.part !== 'rhythm');
  const result = orchestrateBackground(piece, [organ, drum], [{ start: 0, end: 2 }]);
  const beats = result.plan.notes.filter((note) => note.part === 'rhythm');
  assert.ok(beats.length > 0);
  assert.deepEqual(result.parts.rhythm, ['drum']);
  const bar = (60 / piece.tempo) * piece.metre;
  assert.ok(
    beats.every((note) => Math.abs(note.at / bar - Math.round(note.at / bar)) < 1e-6),
    'calm music only accents bar starts',
  );
  assert.ok(beats[0]!.accent < beats[1]!.accent, 'under the child is quieter');
  assert.ok(beats.every((note) => note.length > 0 && note.at + note.length <= piece.seconds));
  assert.deepEqual(
    result.plan.notes.filter((note) => note.part !== 'rhythm'),
    piece.notes,
    'preserve harmony and melody',
  );
});

test('a solo drummer leads with quieter harmonic support, and existing drum notes are not doubled', () => {
  const piece = plan();
  piece.notes = piece.notes.filter((note) => note.part !== 'rhythm');
  const result = orchestrateBackground(piece, [drum], []);
  assert.deepEqual(result.gains, {
    chord: ORCHESTRATION_RULES.drumLeadBacking,
    bass: ORCHESTRATION_RULES.drumLeadBacking,
    melody: ORCHESTRATION_RULES.drumLeadBacking,
  });
  assert.deepEqual(result.parts.chord, ['original']);
  const again = orchestrateBackground(result.plan, [drum], []);
  assert.deepEqual(again.plan.notes, result.plan.notes);
  for (const metre of [2, 3, 4] as const) {
    const busy = { ...piece, metre, colour: 'lively' as const };
    const made = orchestrateBackground(busy, [drum], []);
    assert.ok(made.plan.notes.filter((note) => note.part === 'rhythm').length > 1);
  }
});
