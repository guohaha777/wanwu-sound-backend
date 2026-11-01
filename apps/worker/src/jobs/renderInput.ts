// Preserve the exact music kept by the client when preparing a verified server-source render.
import type {WorkContent} from '@wanwu-v2/contracts/cloud';
import type {RenderInput} from '@wanwu-v2/audio-engine/render';
import {textbookTrack} from '../../../api/src/catalogue.ts';
export function workRenderInput(content:WorkContent,rules:RenderInput['rules'],sources:Pick<RenderInput,'sourceLimits'|'sourceFacts'>={}):RenderInput{
 return {arrangement:content.arrangement,settings:content.settings,rules,...sources,
  composed:content.rendering?.composed,textbookBackground:content.rendering?.textbook,
  textbook:content.rendering?.textbook?.track??(content.settings.inspiration.kind==='textbook'?textbookTrack(content.settings.inspiration.entryId):null)};
}
