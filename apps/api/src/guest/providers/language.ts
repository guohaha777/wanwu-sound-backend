// Language model over the OpenAI-compatible chat/completions interface (千问百炼, DeepSeek and others speak it).
// Prompts are built by @wanwu-v2/prompts; this only sends them and returns the reply text. On 百炼 the thinking mode is
// switched off: the tasks are short rewordings and choices, and thinking would cost seconds the page does not wait for.
import type { BuiltPrompt } from '@wanwu-v2/prompts/tasks';
import type { Provider } from '../config.ts';
import { GuestFailure } from '../net.ts';
import type { Post } from '../net.ts';

export async function chat(
  post: Post,
  provider: Provider,
  built: BuiltPrompt,
  timeoutMs: number,
): Promise<string> {
  const url = `${provider.baseUrl}/chat/completions`;
  const dashscope = /(^|\.)aliyuncs\.com$/.test(new URL(url).hostname);
  const body = {
    model: provider.model,
    temperature: built.temperature,
    messages: [
      ...(built.system ? [{ role: 'system', content: built.system }] : []),
      { role: 'user', content: built.prompt },
    ],
    // Every language prompt asks for JSON (the shared system prompt says so), which JSON mode requires.
    response_format: { type: 'json_object' },
    ...(dashscope ? { enable_thinking: false } : {}),
  };
  const reply = await post(url, { authorization: `Bearer ${provider.apiKey}` }, body, timeoutMs);
  if (reply.status === 429) throw new GuestFailure('quota');
  if (reply.status < 200 || reply.status >= 300) throw new GuestFailure('failed');
  const content = (reply.json as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new GuestFailure('failed');
  return content;
}
