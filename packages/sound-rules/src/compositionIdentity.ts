// AI composition identity only. Ordinary backgrounds and the sound field keep their existing seeds.
import type { BackgroundBrief } from '@wanwu-v2/contracts/background';

/** A compact content token, not an authentication or recording checksum. No source ids leave the device. */
export function compositionToken(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export type CompositionInput = Pick<
  BackgroundBrief,
  'workId' | 'seconds' | 'mood' | 'sounds' | 'identity' | 'attempt' | 'previous'
>;

/** Listening order, exact timing, features and source token determine the first reference; 换一首 adds its attempt. */
export const compositionSeed = (brief: CompositionInput) =>
  JSON.stringify({
    identity: brief.identity ?? null,
    seconds: brief.seconds,
    mood: brief.mood,
    sounds: brief.sounds,
    attempt: brief.attempt,
  });
