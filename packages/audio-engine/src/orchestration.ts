// One renderer for instrument arrangements in composition, shelf and export; the raw renderer remains unchanged.
import type {BackgroundPlan,SoundingSpan} from '@wanwu-v2/sound-rules/background';
import {orchestrateBackground} from '@wanwu-v2/sound-rules/orchestration';
import {renderBackground} from './background.ts';
import type {Instrument} from './instruments.ts';

export function renderArrangedBackground(plan:BackgroundPlan,chosen:readonly Instrument[],sounding:readonly SoundingSpan[]){
 const arranged=orchestrateBackground(plan,chosen,sounding);
 const voices=Object.fromEntries(chosen.map(instrument=>[instrument.id,instrument.recipe]));
 return renderBackground(arranged.plan,arranged.parts,voices,arranged.gains);
}
