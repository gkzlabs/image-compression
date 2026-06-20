/**
 * Angular 17 standalone bootstrap for @GKz/image-compression example.
 * Minimal — no NgModule, no router, no providers beyond what's required.
 *
 * No escape hatch needed: the library's `resolveWorker()` uses the standard
 * `new URL('./worker.js', import.meta.url)` pattern, which Angular CLI's
 * esbuild rewrites at build time. For dev mode, the worker is loaded from
 * node_modules via the same import.meta.url mechanism.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));