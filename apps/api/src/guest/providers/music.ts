// Music model (AI audio background). Chosen service: 阿里云百炼 fun-music-v1, still invite-only; its HTTP interface
// and whether it can make instrumental music of a set length are not published yet (docs/development/guest-ai.md §7).
// Until they are confirmed this step reports not-open, and the page moves on to AI notes. The adapter will download the
// service's temporary audio, store it under the existing OSS playback/ prefix and return a short-lived playback URL.
import type {BackgroundBrief,BackgroundResult} from '@wanwu-v2/contracts/background';
import type {Provider} from '../config.ts';
import {GuestFailure} from '../net.ts';

export async function generateAudio(provider:Provider|null,brief:BackgroundBrief):Promise<BackgroundResult>{
 void brief;
 if(!provider)throw new GuestFailure('not-open');
 throw new GuestFailure('not-open');
}
