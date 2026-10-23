import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import icons from '../../public/fonts/material-symbols-icons.json';

// jsdom rewrites import.meta.url, so resolve from the project root (vitest runs there).
const SRC = resolve('src'); // vitest runs from the project root
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return files(path);
  return /\.jsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
});

/**
 * Quoted names inside a JSX expression, e.g. `{busy ? 'sync' : 'publish'}`.
 * What a condition is tested against — `role === 'insurer'` — is not an icon,
 * so comparisons are dropped before the names are read out.
 */
const quotedNames = (expression) =>
  [...expression.replace(/[=!]==?\s*'[^']*'/g, '').matchAll(/'([a-z][a-z0-9_]{2,})'/g)].map((match) => match[1]);

/**
 * Icon names this file renders: written as the span's text, passed to
 * `<Icon name="…">`, chosen in an expression in either place, or declared as
 * data on a nav item.
 *
 * Both of the indirect forms have let a missing icon through before — once to
 * a button and once to the sidebar — where it printed its own name in letters
 * instead of drawing a glyph.
 */
const explicitIcons = (source) => [
  ...[...source.matchAll(/material-symbols-outlined[^>]*>\s*([a-z][a-z0-9_]*)\s*</g)].map((match) => match[1]),
  ...[...source.matchAll(/<Icon\s+name="([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
  ...[...source.matchAll(/material-symbols-outlined[^>]*>\s*\{([^}]*)\}/g)].flatMap((match) => quotedNames(match[1])),
  ...[...source.matchAll(/<Icon\s+name=\{([^}]*)\}/g)].flatMap((match) => quotedNames(match[1])),
  ...[...source.matchAll(/\bicon:\s*'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]),
];

describe('self-hosted icon font', () => {
  it('contains every icon the app renders (run `node tools/build-icon-font.mjs` after adding one)', () => {
    const subset = new Set(icons);
    const missing = files(SRC).flatMap((file) => explicitIcons(readFileSync(file, 'utf8')).filter((icon) => !subset.has(icon)).map((icon) => `${icon} (${file.replace(SRC, '')})`));
    expect(missing).toEqual([]);
  });
});
