/**
 * The film registry.
 *
 * Deliberately NOT in film.ts: every film module imports the Scene/Film types
 * and the BOTH/LONG cut constants from there, so a registry alongside them
 * closes an import cycle and the whole tool dies at load with "Cannot access
 * 'BOTH' before initialization". Types live in film.ts, films live here.
 */
import type { Film } from '../film.js';
import { partnerFilm } from './partner.js';
import { clientFilm } from './client.js';

export const FILMS: Record<string, Film> = {
  partner: partnerFilm,
  client: clientFilm,
};

export function getFilm(key: string | undefined): Film {
  const film = FILMS[key ?? 'partner'];
  if (!film) throw new Error(`unknown film "${key}" — try ${Object.keys(FILMS).join(', ')}`);
  return film;
}
