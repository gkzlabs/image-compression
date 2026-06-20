/**
 * React example for @GKz/image-compression.
 *
 * Uses React 18 + TypeScript with hooks (useState, useEffect).
 * Same UI logic as the vanilla example, but with React state management.
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ImageCompression, CompressionError } from '@GKz/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@GKz/image-compression';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function CompressorDemo() {
  const svcRef = useRef<ImageCompression | null>(null);
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [result, setResult] = useState<CompressionResult | null>(null);

  // One-time setup
  useEffect(() => {
    svcRef.current = new ImageCompression();
    svcRef.current.getCapabilities().then(setCaps);
    return () => svcRef.current?.dispose();
  }, []);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !svcRef.current) return;
    setResult(null);
    setIsCompressing(true);
    try {
      const r = await svcRef.current.compress(file, {
        maxWidthOrHeight: 2048,
        quality: 0.85,
        format: 'image/jpeg',
        onProgress: () => { /* re-render triggered by state changes */ },
      });
      setResult(r);
    } catch (err) {
      const msg = err instanceof CompressionError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
      alert(`Compression failed: ${msg}`);
    } finally {
      setIsCompressing(false);
    }
  }

  const saved = result
    ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
    : null;

  return (
    <div className="demo">
      <h1>🖼️ @GKz/image-compression <span className="badge">React</span></h1>

      {caps ? (
        <details>
          <summary>📱 Device Capabilities</summary>
          <table>
            <tbody>
              <tr><td>Tier</td><td>{caps.tier}</td></tr>
              <tr><td>WebCodecs</td><td>{caps.hasWebCodecs ? '✅' : '❌'}</td></tr>
              <tr><td>OffscreenCanvas</td><td>{caps.hasOffscreenCanvas ? '✅' : '❌'}</td></tr>
              <tr><td>Web Worker</td><td>{caps.hasWorker ? '✅' : '❌'}</td></tr>
              <tr><td>createImageBitmap</td><td>{caps.hasCreateImageBitmap ? '✅' : '❌'}</td></tr>
            </tbody>
          </table>
        </details>
      ) : (
        <p>Loading capabilities...</p>
      )}

      <label className="upload">
        <input type="file" accept="image/*" disabled={isCompressing} onChange={onFileChange} />
        <span>{isCompressing ? 'Compressing...' : 'Choose image'}</span>
      </label>

      {result && (
        <div className="result">
          <h2>✅ Done</h2>
          <p><strong>Path:</strong> {result.path}</p>
          <p><strong>Tier:</strong> {result.tier}</p>
          <p><strong>Original:</strong> {formatBytes(result.originalSize)}</p>
          <p><strong>Compressed:</strong> {formatBytes(result.compressedSize)}</p>
          <p><strong>Saved:</strong> {saved}%</p>
          {result.width && result.height && (
            <p><strong>Dimensions:</strong> {result.width}×{result.height}</p>
          )}
          <a href={URL.createObjectURL(result.blob)} download={result.name}>
            ⬇️ Download
          </a>
        </div>
      )}

      <style>{`
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; }
        .demo { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .badge { background: #61dafb; color: white; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
        .upload { display: block; margin: 20px 0; padding: 12px; border: 2px dashed #ccc; border-radius: 8px; text-align: center; cursor: pointer; }
        .upload input { display: none; }
        .result { background: #f9f9f9; padding: 16px; border-radius: 8px; margin-top: 20px; }
        .result a { display: inline-block; margin-top: 12px; padding: 8px 16px; background: #05a647; color: white; text-decoration: none; border-radius: 6px; }
        details { margin-bottom: 20px; }
        details table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        details td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      `}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')!).render(<CompressorDemo />);