# Contributing to @GKz/image-compression

Thank you for your interest in contributing! This document explains how to set up the project, run tests, and submit changes.

## 🛠️ Development Setup

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm 9+
- Git

### Getting started

```bash
# 1. Clone the repo
git clone git@github.com:gkzlabs/image-compression.git
cd image-compression

# 2. Install dependencies
npm install

# 3. Run tests
npm test

# 4. Build
npm run build
```

## 📋 Project Structure

```
src/
├── index.ts           # Public API surface (only export from here!)
├── service.ts         # ImageCompression class
├── stream.ts          # AsyncIterable wrappers
├── types.ts           # All types + CompressionError
├── capabilities.ts    # detectCapabilities()
├── exif.ts            # readExifOrientation()
├── worker.ts          # Worker source
└── worker-helpers.ts  # EXIF rotation + resize
```

## 📝 Coding Standards

### TypeScript

- **Strict mode** is enabled. Avoid `any` in the public API. Internal use is OK with a comment explaining why.
- All exports must be explicitly typed. No implicit `any`.
- Use `readonly` for fields that shouldn't be mutated.
- Use `unknown` instead of `any` for error catches.

### File Organization

- **One thing per file.** Don't combine unrelated exports.
- **Barrel exports** go in `index.ts`. Other files export their specific symbols.
- **Tests live next to source**: `foo.ts` → `foo.spec.ts` or `foo.test.ts`

### Naming Conventions

| Type | Convention | Example |
|---|---|---|
| Classes | PascalCase | `ImageCompression` |
| Functions | camelCase | `compress$` |
| Constants | UPPER_SNAKE | `KNOWN_PATHS` |
| Files | kebab-case | `worker-helpers.ts` |
| Types | PascalCase | `CompressionResult` |
| Async iterables | suffix with `$` | `compress$`, `compressAll$` |

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `style`

Examples:
- `feat: add WebP pass-through for small files`
- `fix(worker): prevent DataCloneError on onProgress callback`
- `docs: update README with browser support matrix`

## 🧪 Tests

### Writing tests

- Use Vitest. Place test files as `*.spec.ts` or `*.test.ts` next to the source.
- Use the existing polyfills in `vitest.setup.ts` (OffscreenCanvas, createImageBitmap).
- For browser-specific tests (real Canvas2D, real Web APIs), mark with `it.skip` and a comment explaining why.

### Running tests

```bash
npm test                # Run all tests once
npm run test:watch      # Watch mode
npm run lint            # tsc --noEmit
```

### Coverage requirements

- New features must have tests.
- Bug fixes should add a regression test.
- Aim for 80%+ coverage on new code.

## 🔀 Submitting Changes

### Branch naming

```
feat/<short-description>     # new feature
fix/<short-description>      # bug fix
chore/<short-description>    # maintenance
docs/<short-description>     # documentation only
```

Examples: `feat/avif-support`, `fix/canvas-memory-leak`, `docs/usage-examples`

### Pull Request / Merge Request process

1. **Create a feature branch** from `main`.
2. **Make your changes** with appropriate tests.
3. **Run `npm test`** locally — all tests must pass.
4. **Run `npm run lint`** — tsc must be clean.
5. **Run `npm run build`** — must succeed.
6. **Push** to the same feature branch.
7. **Open a Merge Request** to `main`.
8. **Wait for CI** to pass.
9. **Request review** from a maintainer.
10. **Squash and merge** when approved.

### MR checklist

- [ ] Tests pass locally (`npm test`)
- [ ] tsc is clean (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] CHANGELOG.md updated (for user-facing changes)
- [ ] README.md updated (if API changed)
- [ ] Commit messages follow Conventional Commits
- [ ] Branch is up-to-date with `main`

## 🐛 Reporting Bugs

Use the [issue tracker](https://github.com/gkzlabs/image-compression/issues). Include:

- **Description** — what happened vs. what you expected
- **Reproduction** — minimal code snippet
- **Environment** — browser, OS, library version
- **Screenshots/logs** — if applicable

## 💡 Feature Requests

Open an issue with the `enhancement` label. Explain:

- **Use case** — what problem does it solve?
- **Proposed API** — code snippet showing the desired usage
- **Alternatives** — what other approaches did you consider?

## 📞 Questions?

Open a discussion in the [issue tracker](https://github.com/gkzlabs/image-compression/issues) with the `question` label.

## 📄 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
