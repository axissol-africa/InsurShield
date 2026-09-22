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

/** Icon names written directly inside a Material Symbols span or an <Icon name="…"> element. */
const explicitIcons = (source) => [
  ...[...source.matchAll(/material-symbols-outlined[^>]*>\s*([a-z][a-z0-9_]*)\s*</g)].map((m) => m[1]),
  ...[...source.matchAll(/<Icon\s+name="([a-z][a-z0-9_]*)"/g)].map((m) => m[1]),
];

describe('self-hosted icon font', () => {
  it('contains every icon the app renders (run `node tools/build-icon-font.mjs` after adding one)', () => {
    const subset = new Set(icons);
    const missing = files(SRC).flatMap((file) => explicitIcons(readFileSync(file, 'utf8')).filter((icon) => !subset.has(icon)).map((icon) => `${icon} (${file.replace(SRC, '')})`));
    expect(missing).toEqual([]);
  });
});
