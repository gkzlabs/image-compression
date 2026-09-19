#!/usr/bin/env node
/**
 * Regenerate the HEIC test fixtures (macOS only — uses `sips` for the HEIC codec).
 *
 *   node test/fixtures/make-fixtures.mjs
 *
 * We generate the source image ourselves so the expected pixels are known:
 * four solid quadrants plus a high-contrast checker block (used by the sharpen
 * tests). The `.heic` is produced by macOS ImageIO via `sips`, and the
 * `.reference.png` is that same `.heic` decoded back by ImageIO — i.e. the
 * ground truth our pipeline must reproduce.
 */
import { createCanvas } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const W = 320;
const H = 240;

mkdirSync(dir, { recursive: true });

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Quadrants: red | green / blue | yellow
const hw = W / 2;
const hh = H / 2;
ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, hw, hh);
ctx.fillStyle = '#00ff00'; ctx.fillRect(hw, 0, hw, hh);
ctx.fillStyle = '#0000ff'; ctx.fillRect(0, hh, hw, hh);
ctx.fillStyle = '#ffff00'; ctx.fillRect(hw, hh, hw, hh);

// High-contrast checker block (8px cells) in the middle — sharpen/edge tests.
const cell = 8;
for (let y = hh / 2; y < hh / 2 + 64; y += cell) {
  for (let x = hw / 2; x < hw / 2 + 64; x += cell) {
    const on = ((x / cell) + (y / cell)) % 2 === 0;
    ctx.fillStyle = on ? '#ffffff' : '#000000';
    ctx.fillRect(x, y, cell, cell);
  }
}

const pngPath = join(dir, 'sample.source.png');
const heicPath = join(dir, 'sample.heic');
const refPath = join(dir, 'sample.reference.png');

writeFileSync(pngPath, canvas.toBuffer('image/png'));

if (process.platform !== 'darwin') {
  console.error('sips is macOS-only; commit the existing fixtures instead of regenerating.');
  process.exit(1);
}

execFileSync('sips', ['-s', 'format', 'heic', '-s', 'formatOptions', '80', pngPath, '--out', heicPath], { stdio: 'pipe' });
// Ground truth: decode the .heic back through ImageIO.
execFileSync('sips', ['-s', 'format', 'png', heicPath, '--out', refPath], { stdio: 'pipe' });

const sizes = [pngPath, heicPath, refPath].map((p) => `${p.split('/').pop()} ${existsSync(p) ? '' : 'MISSING'}`);
console.log('fixtures written:\n  ' + sizes.join('\n  '));
