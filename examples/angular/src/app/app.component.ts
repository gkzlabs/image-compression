/**
 * Angular 17 standalone component demonstrating @GKz/image-compression.
 *
 * Same UI logic as react/vue/svelte/vanilla examples — only the framework
 * binding differs. Uses Angular signals for state management (Angular 17+).
 */
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ImageCompression, CompressionError } from '@GKz/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@GKz/image-compression';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private svc = new ImageCompression();

  // Angular signals for reactive state
  caps = signal<DeviceCapabilities | null>(null);
  isCompressing = signal(false);
  result = signal<CompressionResult | null>(null);

  // Derived
  saved = computed(() => {
    const r = this.result();
    return r ? Math.round((1 - r.compressedSize / r.originalSize) * 100) : null;
  });
  downloadUrl = computed(() => {
    const r = this.result();
    return r ? URL.createObjectURL(r.blob) : '';
  });

  async ngOnInit() {
    this.caps.set(await this.svc.getCapabilities());
  }

  ngOnDestroy() {
    this.svc.dispose();
  }

  async onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.result.set(null);
    this.isCompressing.set(true);
    try {
      const r = await this.svc.compress(file, {
        maxWidthOrHeight: 2048,
        quality: 0.85,
        format: 'image/jpeg',
      });
      this.result.set(r);
    } catch (err) {
      const msg = err instanceof CompressionError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
      alert(`Compression failed: ${msg}`);
    } finally {
      this.isCompressing.set(false);
    }
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
}