#!/usr/bin/env node
/**
 * Post-build: copy heic2any to dist/, optionally minified.
 *
 * Why: v0.9.0+ supports the `__IC_HEIC2ANY_URL` escape hatch for loading
 * heic2any from a known URL. The core lib's tryDecodeHEICLazy() tries the
 * URL hatch first when the flag is set (set by Angular's main.ts to '/heic2any.js').
 *
 * For production Angular builds, the deep import + bare specifier may not
 * work depending on Angular CLI's esbuild version. The URL hatch works in
 * ALL environments, so this script ensures heic2any is available at the
 * expected URL.
 *
 * Usage: node scripts/copy-heic2any.js
 *
 * Output:
 *   dist/angular-image-compression/browser/heic2any.js (minified)
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'angular-image-compression', 'browser');
const target = path.join(outDir, 'heic2any.js');

// Source: heic2any is in node_modules (added as optionalDependency)
const pkgRoot = path.resolve(root, 'node_modules', 'heic2any');
const source = path.join(pkgRoot, 'dist', 'heic2any.js');

if (!fs.existsSync(outDir)) {
  console.error(`[copy-heic2any.js] Dist not found at ${outDir}`);
  console.error(`[copy-heic2any.js] Run: ng build first`);
  process.exit(1);
}

if (!fs.existsSync(source)) {
  console.warn(`[copy-heic2any.js] heic2any not found at ${source}`);
  console.warn(`[copy-heic2any.js] HEIC files will fall back to native ImageDecoder only.`);
  console.warn(`[copy-heic2any.js] To enable: npm install heic2any`);
  // Non-fatal: heic2any is optional
  process.exit(0);
}

console.log(`[copy-heic2any.js] Bundling + minifying ${source} → ${target}`);

esbuild
  .build({
    entryPoints: [source],
    bundle: true,
    outfile: target,
    format: 'esm', // ESM format preserves heic2any's UMD browser-global path
    target: ['es2020'],
    minify: true,
    platform: 'browser',
    // heic2any is self-contained (no external deps at runtime)
    external: [],
  })
  .then(() => {
    const size = fs.statSync(target).size;
    const gzSize = require('zlib').gzipSync(fs.readFileSync(target)).length;
    console.log(`[copy-heic2any.js] ✓ Built ${size} bytes (${gzSize} B gzipped)`);
    console.log('');
    console.log('[copy-heic2any.js] The Angular app picks this up via:');
    console.log('  window.__IC_HEIC2ANY_URL = "/heic2any.js"');
    console.log('  // set in src/main.ts before bootstrapApplication()');
  })
  .catch((err) => {
    console.error(`[copy-heic2any.js] ✗ Build failed:`, err);
    // Fall back to plain copy
    console.warn('[copy-heic2any.js] Falling back to plain copy (no minification)');
    fs.copyFileSync(source, target);
    const size = fs.statSync(target).size;
    console.log(`[copy-heic2any.js] ✓ Copied ${size} bytes (unminified)`);
    process.exit(0);
  });
