/**
 * Pre-build hook: copy the worker from @GKz/image-compression into Angular's
 * assets directory so the dev server (and production build) can serve it.
 *
 * Run automatically before `ng serve` and `ng build` via package.json scripts.
 *
 * Why this script:
 * - Angular CLI's Vite-based dev server doesn't pre-bundle worker files
 *   referenced via `new URL('./worker.js', import.meta.url)` in libraries
 * - The standard URL path returns 404 in dev mode
 * - Copying to src/assets/ makes Angular serve it at /assets/image-compression.worker.js
 * - The library uses __IC_WORKER_URL escape hatch (set in main.ts) to find it
 *
 * In production, the postbuild `build:worker` script ALSO bundles the worker
 * to dist/. Both copies are harmless (Angular will use the local one first).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const coreDir = path.resolve(root, '..', '..');
const src = path.join(coreDir, 'dist', 'worker.js');
// Angular 17+ auto-serves the `public/` folder at root (/image-compression.worker.js).
// No angular.json `assets` config needed.
const dest = path.join(root, 'public', 'image-compression.worker.js');

if (!fs.existsSync(src)) {
  console.error(`[prebuild] Source worker not found at ${src}`);
  console.error('[prebuild] Run `npm run build` in the @GKz/image-compression core first');
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[prebuild] ✓ Copied worker to ${path.relative(root, dest)}`);