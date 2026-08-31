/** Narrate, film, cut, document — the whole film from a clean checkout. */
import { generateVoice } from './voice.js';
import { captureCut } from './capture.js';
import { buildCut } from './build.js';
import { writeScriptDoc } from './docs.js';
import { ffprobeDuration } from './ffmpeg.js';
import type { AspectSpec } from './brand.js';

const cuts: AspectSpec['key'][] = ['landscape', 'vertical'];

console.log('Narrating…');
await generateVoice();

for (const cut of cuts) {
  console.log(`\nFilming ${cut}…`);
  await captureCut(cut);
  console.log(`\nAssembling ${cut}…`);
  const file = await buildCut(cut);
  console.log(`  → ${file} (${(await ffprobeDuration(file)).toFixed(1)}s)`);
}

console.log(`\n${await writeScriptDoc()}`);
