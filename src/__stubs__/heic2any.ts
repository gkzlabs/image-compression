// Stub for heic2any — used in vitest to avoid loading the real WASM module.
// In production, this file is never executed; the real heic2any is loaded
// dynamically only when a HEIC file is encountered (see service.ts).
export default async function heic2any(): Promise<Blob> {
  throw new Error('heic2any stub: should not be called in tests');
}
