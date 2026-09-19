# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.3.x   | :white_check_mark: (current) |
| 1.2.x   | :white_check_mark: |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: (critical fixes only) |
| 0.10.x  | :x: (end of life) |
| < 0.10  | :x:                |

> v1.0.0 (2026-08-10) is the first stable release — the public API is frozen.
> Since then: v1.1.0 (quality features — multi-step downscale, `sharpen`,
> `qualityBoost`, binary-search target size), v1.2.0 (worker-side transforms,
> CJS build, server-fallback docs), v1.3.0 (target-size ladder in the Worker),
> v1.3.1 (worker reliability: transform-preserving target-size ladder,
> in-flight `dispose()` no longer hangs, no progress-callback leak).
> All additions are opt-in; defaults are unchanged.
> See [CHANGELOG.md](CHANGELOG.md) for the full release history and
> [GitHub Releases](https://github.com/gkzlabs/image-compression/releases)
> for tagged versions.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to:

📧 **gkz.labs@gmail.com**

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

### What to include

Please include the following information in your report:

- **Type of vulnerability** (e.g., XSS, prototype pollution, denial of service)
- **Affected versions** of `@gkzlabs/image-compression`
- **Affected files** (if known)
- **Steps to reproduce** — minimal code snippet
- **Impact** — what can an attacker do?
- **Suggested fix** (if any)

### What to expect

After you submit a report:

1. **Acknowledgment** — within 48 hours
2. **Initial assessment** — within 5 business days
3. **Fix timeline** — depends on severity:
   - Critical: 1-3 days
   - High: 1-2 weeks
   - Medium: 2-4 weeks
   - Low: next release
4. **Credit** — if desired, you'll be credited in the fix release notes

## Security Best Practices for Consumers

When using `@gkzlabs/image-compression` in your project:

- **Always validate user-uploaded files** before processing (e.g., check MIME type, magic bytes)
- **Set size limits** on uploads to prevent OOM (e.g., reject files > 50 MB)
- **Use CSP headers** to restrict Worker source origins (see the CSP sections below)
- **Sandbox image processing** — don't process untrusted files in privileged contexts
- **Keep the library updated** — subscribe to releases for security patches

## Known Security Considerations

This library:

- ✅ **Runs entirely in the browser** — no data is sent to remote servers (unless you implement server-fallback)
- ✅ **No network requests of its own** — every asset except the optional `heic2any` decoder is bundled
- ⚠️ **Uses Web Workers** — subject to browser CSP policies (`worker-src` / `script-src`)
- ⚠️ **Optional `heic2any` decoder** — not a declared dependency; if you install it yourself, verify integrity
- ⚠️ **Reads EXIF data** — EXIF may contain user location; re-encoding strips it, but the
  original file (e.g. returned by `passThroughUnderBytes`) keeps it

### HEIC decoding and CSP

HEIC support is layered, and **no `unsafe-eval` is required for any layer** — v1.3.2 removed
the `eval`-based loader that older versions used for layer 2 (it tripped strict CSPs and
supply-chain scanners as "dynamic code execution"):

1. **Native `ImageDecoder`** (Safari on macOS 11+ / iOS 16.4+, Chrome on macOS / Win 11 /
   Android 12+) — no extra loading at all, no CSP impact. Tried first.
2. **`window.__IC_HEIC2ANY_URL` hatch** — a runtime dynamic `import()` of the URL you provide
   (`src/heic.ts`). The specifier is a variable, so no bundler rewrites it: it works in
   Angular CLI's esbuild and in Vite alike. No JS eval. The optional heic2any WASM decoder
   itself still needs `script-src 'wasm-unsafe-eval'`, which is a WebAssembly requirement,
   not a JavaScript one.
3. **Bare `import('heic2any')`** — plain dynamic import for Node / Vite / Webpack 5 consumers.
   No eval; the module is fetched by the bundler.

If your CSP forbids WebAssembly (`'wasm-unsafe-eval'`):

- rely on the native `ImageDecoder` path (covers iOS/macOS Safari and recent Chromium), and/or
- pre-decode HEIC yourself (decode to JPEG/PNG before calling `compress()`), and/or
- simply do not set `__IC_HEIC2ANY_URL` — the library then skips layer 2 entirely.

### Worker loading

`resolveWorker()` (see `src/worker-resolution.ts`) loads `dist/worker.js` from your own origin —
resolved against `document.baseURI`, or via the bundler's
`new URL('./worker.js', import.meta.url)` rewrite. Every strategy stays same-origin unless you
explicitly point `window.__IC_WORKER_URL` at a third-party URL: do that only for origins you
trust, because that worker gets access to every file you pass to `compress()`.

A worker that fails to load (404, CSP block, crash) is detected at runtime: the RPC layer rejects
in-flight calls and the cascade falls back to the main-thread `canvas-main` path — it never hangs.

## Acknowledgments

We thank the following people for responsibly disclosing security issues:

*(List will be updated as issues are reported and fixed.)*
