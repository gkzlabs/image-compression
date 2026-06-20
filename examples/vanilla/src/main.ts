/**
 * Vanilla TypeScript example for @gkz/image-compression.
 *
 * No framework — uses raw DOM APIs and a small class to manage state.
 * This is the "drop into any HTML page" reference implementation.
 *
 * Usage:
 *   import './main.css';
 *   import './main.ts';   // auto-mounts
 *
 * Or inline:
 *   <script type="module" src="/src/main.ts"></script>
 */
import { ImageCompression, CompressionError } from '@gkz/image-compression';
import type {
  CompressionResult,
  DeviceCapabilities,
} from '@gkz/image-compression';

// ============================================================================
// State container (minimal — no framework)
// ============================================================================
class CompressorDemo {
  private svc = new ImageCompression();
  private file: File | null = null;
  private result: CompressionResult | null = null;
  private caps: DeviceCapabilities | null = null;
  private isCompressing = false;

  // Mount point
  constructor(private root: HTMLElement) {
    this.render();
    this.init();
  }

  private async init() {
    this.caps = await this.svc.getCapabilities();
    this.render();
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------
  private async onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file = file;
    this.result = null;
    this.isCompressing = false;
    this.render();
    if (file) {
      this.isCompressing = true;
      this.render();
      try {
        this.result = await this.svc.compress(file, {
          maxWidthOrHeight: 2048,
          quality: 0.85,
          format: 'image/jpeg',
          onProgress: () => this.render(),
        });
      } catch (err) {
        if (err instanceof CompressionError) {
          alert(`Compression failed: ${err.code} - ${err.message}`);
        } else {
          alert(`Unexpected error: ${(err as Error).message}`);
        }
      } finally {
        this.isCompressing = false;
        this.render();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Render (manual DOM updates — equivalent to React/Vue reactivity)
  // --------------------------------------------------------------------------
  private formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  private render() {
    const saved = this.result
      ? Math.round((1 - this.result.compressedSize / this.result.originalSize) * 100)
      : null;

    this.root.innerHTML = `
      <div class="demo">
        <h1>🖼️ @gkz/image-compression <span class="badge">Vanilla</span></h1>

        ${this.caps ? `
          <details>
            <summary>📱 Device Capabilities</summary>
            <table>
              <tr><td>Tier</td><td>${this.caps.tier}</td></tr>
              <tr><td>WebCodecs</td><td>${this.caps.hasWebCodecs ? '✅' : '❌'}</td></tr>
              <tr><td>OffscreenCanvas</td><td>${this.caps.hasOffscreenCanvas ? '✅' : '❌'}</td></tr>
              <tr><td>Web Worker</td><td>${this.caps.hasWorker ? '✅' : '❌'}</td></tr>
              <tr><td>createImageBitmap</td><td>${this.caps.hasCreateImageBitmap ? '✅' : '❌'}</td></tr>
            </table>
          </details>
        ` : '<p>Loading capabilities...</p>'}

        <label class="upload">
          <input type="file" accept="image/*" ${this.isCompressing ? 'disabled' : ''} />
          <span>${this.isCompressing ? 'Compressing...' : 'Choose image'}</span>
        </label>

        ${this.result ? `
          <div class="result">
            <h2>✅ Done</h2>
            <p><strong>Path:</strong> ${this.result.path}</p>
            <p><strong>Tier:</strong> ${this.result.tier}</p>
            <p><strong>Original:</strong> ${this.formatBytes(this.result.originalSize)}</p>
            <p><strong>Compressed:</strong> ${this.formatBytes(this.result.compressedSize)}</p>
            <p><strong>Saved:</strong> ${saved}%</p>
            ${this.result.width && this.result.height ? `
              <p><strong>Dimensions:</strong> ${this.result.width}×${this.result.height}</p>
            ` : ''}
            <a href="${URL.createObjectURL(this.result.blob)}" download="${this.result.name}">
              ⬇️ Download
            </a>
          </div>
        ` : ''}
      </div>

      <style>
        .demo { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .badge { background: #4ecdc4; color: white; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
        .upload { display: block; margin: 20px 0; padding: 12px; border: 2px dashed #ccc; border-radius: 8px; text-align: center; cursor: pointer; }
        .upload input { display: none; }
        .result { background: #f9f9f9; padding: 16px; border-radius: 8px; margin-top: 20px; }
        .result a { display: inline-block; margin-top: 12px; padding: 8px 16px; background: #05a647; color: white; text-decoration: none; border-radius: 6px; }
        details { margin-bottom: 20px; }
        details table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        details td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      </style>
    `;

    // Re-attach event listener (innerHTML wipes them)
    const input = this.root.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (input) input.addEventListener('change', this.onFileChange.bind(this));
  }
}

// Mount
const root = document.getElementById('app');
if (root) new CompressorDemo(root);