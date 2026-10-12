#!/usr/bin/env node
/**
 * Rebuild the self-hosted Material Symbols subset.
 *
 * Scans src/ for every icon name the app uses, asks Google Fonts for a font
 * containing only those glyphs (FILL 0..1, weight 400), and writes:
 *   public/fonts/material-symbols-subset.woff2   the font (~15–20 KB instead of the full ~1 MB)
 *   public/fonts/material-symbols-icons.json     the names it contains (checked by a unit test)
 *
 * Run `node tools/build-icon-font.mjs` after adding an icon.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const OUT = new URL('../public/fonts/', import.meta.url).pathname;
const CODEPOINTS = 'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return files(path);
  return /\.(jsx?|tsx?)$/.test(name) && !name.includes('.test.') ? [path] : [];
});

/** Every lowercase token that could be an icon name: quoted strings and JSX text. */
export const collectTokens = (source) => new Set([
  ...[...source.matchAll(/['"]([a-z][a-z0-9_]{2,})['"]/g)].map((m) => m[1]),
  ...[...source.matchAll(/>\s*([a-z][a-z0-9_]{2,})\s*</g)].map((m) => m[1]),
]);

const official = new Set((await (await fetch(CODEPOINTS)).text()).split('\n').map((line) => line.split(' ')[0]).filter(Boolean));
const tokens = new Set(files(SRC).flatMap((file) => [...collectTokens(readFileSync(file, 'utf8'))]));
const icons = [...tokens].filter((token) => official.has(token)).sort();

const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL,wght@0..1,400&icon_names=${icons.join(',')}&display=block`, { headers: { 'User-Agent': UA } })).text();
const url = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
if (!url) throw new Error(`Google Fonts returned no woff2 URL:\n${css}`);
const font = Buffer.from(await (await fetch(url)).arrayBuffer());

writeFileSync(join(OUT, 'material-symbols-subset.woff2'), font);
writeFileSync(join(OUT, 'material-symbols-icons.json'), `${JSON.stringify(icons, null, 2)}\n`);
console.log(`${icons.length} icons, ${(font.length / 1024).toFixed(1)} KB → public/fonts/material-symbols-subset.woff2`);
