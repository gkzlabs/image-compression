// Generate deterministic benchmark fixtures using @napi-rs/canvas.
// Creates 2 JPEG fixtures: medium (~500KB) and large (~3MB).
// Run: node bench/fixtures/generate.mjs
// Skips if files already exist (deterministic across runs).

import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = __dirname;

// Deterministic PRNG (mulberry32) — same input → same pixels
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function generateFixture({ name, width, height, quality, fileSizeHint }) {
  const out = resolve(FIXTURES_DIR, name);
  if (existsSync(out) && statSync(out).size > 0) {
    console.log(`✓ ${name} already exists (${(statSync(out).size / 1024).toFixed(0)} KB) — skip`);
    return out;
  }

  console.log(`→ generating ${name} (${width}x${height} @ quality ${quality})...`);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(42);

  // Background: smooth radial gradient (compresses well)
  const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.5);
  grad.addColorStop(0, `hsl(${rand() * 360}, 70%, 50%)`);
  grad.addColorStop(0.5, `hsl(${rand() * 360}, 50%, 30%)`);
  grad.addColorStop(1, `hsl(${rand() * 360}, 60%, 10%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Add some high-frequency noise to defeat trivial compression
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 30;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(imageData, 0, 0);

  // Add some sharp edges (text + rectangles) to make the image realistic
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(width * 0.1, height * 0.4, width * 0.8, 4);
  ctx.fillRect(width * 0.1, height * 0.6, width * 0.8, 4);
  ctx.font = `${Math.floor(height * 0.08)}px sans-serif`;
  ctx.fillStyle = 'white';
  ctx.fillText('BENCHMARK FIXTURE', width * 0.1, height * 0.35);
  ctx.fillText(`${width}×${height}`, width * 0.1, height * 0.75);

  // Encode to JPEG
  const buffer = canvas.toBuffer('image/jpeg', { quality });
  writeFileSync(out, buffer);

  const sizeKB = (buffer.length / 1024).toFixed(0);
  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`✓ wrote ${name}: ${sizeKB} KB (${sizeMB} MB) — target ~${fileSizeHint}`);

  if (fileSizeHint && buffer.length < parseFloat(fileSizeHint) * 0.5 * 1024 * 1024) {
    console.warn(`  ⚠ smaller than target. Try higher quality or larger dimensions.`);
  }

  return out;
}

async function main() {
  console.log('=== generating benchmark fixtures ===\n');

  // Medium: 1500x1000 — realistic web image, ~500KB-1MB
  await generateFixture({
    name: 'medium-1500x1000.jpg',
    width: 1500,
    height: 1000,
    quality: 0.92,
    fileSizeHint: '1MB',
  });

  // Large: 4000x3000 — typical iPhone photo, ~3-5MB
  await generateFixture({
    name: 'large-4000x3000.jpg',
    width: 4000,
    height: 3000,
    quality: 0.95,
    fileSizeHint: '4MB',
  });

  console.log('\n=== done ===');
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(1);
});
