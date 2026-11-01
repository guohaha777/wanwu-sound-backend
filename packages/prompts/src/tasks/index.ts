// Every AI task, for the server (and the dev-only prompt lab): build the request from an anonymous brief, read the reply
// with the same acceptance the page uses. Pages never import this module (tests/structure.test.ts): keys, requests and
// prompt wording stay on the server.
import {BACKGROUND_AUDIO_PROMPT,BACKGROUND_COMPOSE_PROMPT} from './background.ts';
import {SYSTEM_PROMPT} from './files.ts';
import type {PromptFile} from './files.ts';
import {TEXTBOOK_TALK_PROMPT,WORK_TALK_PROMPT} from './talk.ts';
import {MOOD_WORDS_PROMPT,SOUND_HINT_PROMPT,TEXTBOOK_WORDS_PROMPT} from './words.ts';
import {EXPLAIN_SYSTEM_PROMPT,TEXTBOOK_FEATURES_PROMPT} from './features.ts';

export * from './background.ts';
export * from './talk.ts';
export * from './words.ts';
export * from './features.ts';
export {readReply} from './reply.ts';
export {SYSTEM_PROMPT,promptProblems} from './files.ts';
export type {BuiltPrompt,PromptFile,PromptSpec} from './files.ts';

export type TaskId='background-audio'|'background-compose'|'work-talk'|'textbook-talk'|'sound-hint'|'mood-words'
 |'textbook-words'|'textbook-features';
/**
 * Who answers when the model does not: every task has a fallback that needs no network. `runtime` tasks run while a
 * child uses the site; `development` ones once, before a textbook card ships (and a person checks the result by ear).
 */
export type TaskInfo={file:PromptFile;model:'千问'|'千问 Omni'|'千问 Omni → 千问'|'Fun-Music';when:'runtime'|'development';fallback:string};
export const TASKS:Record<TaskId,TaskInfo>={
 'background-audio':{file:BACKGROUND_AUDIO_PROMPT,model:'Fun-Music',when:'runtime',fallback:'下一步：AI 语音模型作曲'},
 'background-compose':{file:BACKGROUND_COMPOSE_PROMPT,model:'千问 Omni → 千问',when:'runtime',fallback:'语音模型不行换文本模型，再不行程序自编（ai-compose 规则）'},
 'work-talk':{file:WORK_TALK_PROMPT,model:'千问',when:'runtime',fallback:'语料 discoveries.v1（逐句替换）'},
 'textbook-talk':{file:TEXTBOOK_TALK_PROMPT,model:'千问',when:'runtime',fallback:'语料 textbook-talk.v1（逐句替换）'},
 'sound-hint':{file:SOUND_HINT_PROMPT,model:'千问',when:'runtime',fallback:'语料 sound-hints.v1（现在只用语料）'},
 'mood-words':{file:MOOD_WORDS_PROMPT,model:'千问',when:'runtime',fallback:'如实提示“还没开放”，请孩子选一个预设心情'},
 'textbook-words':{file:TEXTBOOK_WORDS_PROMPT,model:'千问',when:'development',fallback:'老师或音乐角色手写'},
 'textbook-features':{file:TEXTBOOK_FEATURES_PROMPT,model:'千问 Omni',when:'runtime',fallback:'只看数字的语言模型，再不行用程序选的节奏'},
};
export const TASK_IDS=Object.keys(TASKS) as TaskId[];

/**
 * Versions of the shared system prompt, the explanation card's, and every task prompt; an AI result carries the one it
 * was made with.
 */
export const PROMPT_VERSIONS={
 system:SYSTEM_PROMPT.version,
 explainSystem:EXPLAIN_SYSTEM_PROMPT.version,
 ...Object.fromEntries(TASK_IDS.map(id=>[id,TASKS[id].file.version])),
} as Readonly<Record<'system'|'explainSystem'|TaskId,string>>;
