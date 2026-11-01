import type { DiscoveryBrief } from '@wanwu-v2/contracts/discovery';
import systemFile from '../../prompts/music-discovery-system.v1.json' with { type: 'json' };
import taskFile from '../../prompts/music-discovery.v1.json' with { type: 'json' };
import audioFile from '../../prompts/music-observation.v1.json' with { type: 'json' };
import { acceptDiscoverySet } from '../discovery/accept.ts';
import { readReply } from './reply.ts';
import type { BuiltPrompt } from './files.ts';
export const DISCOVERY_SYSTEM_PROMPT = systemFile;
export const DISCOVERY_PROMPT = taskFile;
export function buildDiscovery(brief: DiscoveryBrief): BuiltPrompt {
  const { audio, points, ...facts } = brief;
  return {
    task: 'music-discovery',
    model: 'language',
    version: taskFile.version,
    temperature: 0.65,
    system: systemFile.lines.join('\n'),
    prompt: taskFile.lines.join('\n') + '\n' + JSON.stringify(facts),
  };
}
export function buildDiscoveryRepair(
  brief: DiscoveryBrief,
  reply: string,
  problems: readonly string[],
): BuiltPrompt {
  const built = buildDiscovery(brief);
  return {
    ...built,
    prompt:
      built.prompt +
      '\n仅修复未通过的条目，已合格条目不重写。问题：' +
      problems.join('；') +
      '\n原回复：' +
      reply,
  };
}
export function buildObservation(brief: DiscoveryBrief): BuiltPrompt {
  return {
    task: 'music-observation',
    model: 'audio',
    version: audioFile.version,
    temperature: 0.2,
    system: audioFile.system.join('\n'),
    prompt:
      audioFile.lines.join('\n') +
      '\n' +
      JSON.stringify({
        seconds: brief.seconds,
        background: brief.background,
        backgroundMusic: brief.backgroundMusic,
        sounds: brief.sounds,
      }),
  };
}
export function readDiscovery(text: string, brief: DiscoveryBrief) {
  const read = readReply(text);
  return {
    repairs: read.repairs,
    acceptance:
      'problem' in read
        ? { status: 'rejected' as const, set: null, notes: [read.problem] }
        : acceptDiscoverySet(read.value, brief),
  };
}
