/** Narrate, film, cut, document — one whole film from a clean checkout. */
import { generateVoice } from './voice.js';
import { captureCut } from './capture.js';
import { buildCut } from './build.js';
import { writeScriptDoc } from './docs.js';
import { ffprobeDuration } from './ffmpeg.js';
import { type CutKey } from './film.js';
import { getFilm } from './films/index.js';

const film = getFilm(process.argv[2]);
const cuts: CutKey[] = ['landscape', 'vertical'];

console.log(`Narrating ${film.key}…`);
await generateVoice(film);

for (const cut of cuts) {
  console.log(`\nFilming ${film.key} ${cut}…`);
  await captureCut(film, cut);
  console.log(`\nAssembling ${film.key} ${cut}…`);
  const file = await buildCut(film, cut);
  console.log(`  → ${file} (${(await ffprobeDuration(file)).toFixed(1)}s)`);
}

console.log(`\n${await writeScriptDoc(film)}`);
