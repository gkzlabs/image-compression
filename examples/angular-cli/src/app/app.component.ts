import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ImageCompression,
  CompressionError,
  type CompressionResult,
} from '@gkzlabs/image-compression';

/**
 * Angular CLI (esbuild builder) example — deliberately the HOSTILE bundler.
 *
 * Every other example in this repo uses Vite, which rewrites
 * `new URL('./worker.js', import.meta.url)` inside node_modules without
 * complaint. Angular CLI's `@angular-devkit/build-angular:application` builder
 * is the setup that historically produced a 404 on the worker URL, so this
 * example exists to keep that bug class visible: CI builds it AND drives it in
 * a real browser (see test/angular-cli-e2e.mjs at the repo root).
 *
 * No `__IC_WORKER_URL` escape hatch is set on purpose — if the bundler cannot
 * resolve the worker, the e2e must fail loudly instead of silently landing on
 * `canvas-main`.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly title = 'Angular CLI + @gkzlabs/image-compression';
  readonly busy = signal(false);
  readonly result = signal<CompressionResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedPercent = computed(() => {
    const r = this.result();
    return r ? Math.round((1 - r.compressedSize / r.originalSize) * 100) : 0;
  });

  private readonly svc = new ImageCompression();

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const result = await this.svc.compress(file, {
        maxWidthOrHeight: 1024,
        quality: 0.85,
        format: 'image/jpeg',
      });
      this.result.set(result);
      // Read by the Puppeteer e2e (test/angular-cli-e2e.mjs at the repo root).
      (window as unknown as { __lastResult?: unknown }).__lastResult = {
        path: result.path,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        width: result.width,
        height: result.height,
        mimeType: result.mimeType,
        name: result.file.name,
      };
    } catch (err) {
      const message =
        err instanceof CompressionError ? `${err.code}: ${err.message}` : String(err);
      this.error.set(message);
      (window as unknown as { __lastError?: string }).__lastError = message;
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }
}
