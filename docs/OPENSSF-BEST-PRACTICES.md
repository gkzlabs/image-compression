# OpenSSF Best Practices badge — filling guide

Scorecard's **CII-Best-Practices** check asks
`bestpractices.dev` whether a project with this repository's URL exists and has
earned a badge. Nothing in this repo can answer that check — the badge has to be
registered by a maintainer, and the questionnaire has to be answered. This page
is the pre-filled answer sheet so registration takes one sitting.

## Registering (once)

1. Sign in at <https://www.bestpractices.dev/> with GitHub (`gkzlabs`).
2. **Get Your Badge** → fill `https://github.com/gkzlabs/image-compression`
   as the project URL. Use the *passing* level, not *silver*: silver/gold add
   requirements a single-maintainer library cannot honestly meet yet (see
   "Honest gaps" below).
3. Answer the questionnaire using the table below. Answers marked ✅ are backed
   by a file in this repo; paste the path into the "justification" box, because
   the badge UI asks for evidence and reviewers do check it.
4. When the form is saved, it gives the project an id and a badge URL. Put that
   badge in `README.md` next to the Scorecard badge — `bestpractices.dev` reads
   the badge image back to confirm the link.
5. Scorecard re-checks on its weekly run (and on every push to `main`).

## Answers, by section

### Basics

| Criterion | Answer | Evidence |
| --- | --- | --- |
| Project has a descriptive name / one-line description | ✅ | `package.json` `description`, README first paragraph |
| Project has a website / docs URL | ✅ | `homepage` in `package.json`; `docs/` |
| Project is open source, OSI licence | ✅ | `LICENSE` (MIT) |
| Project accepts bug reports | ✅ | `.github/ISSUE_TEMPLATE/bug_report.md` |
| Project has a code of conduct | ✅ | `CODE_OF_CONDUCT.md` |
| Project has a documented contribution process | ✅ | `CONTRIBUTING.md` |
| Project has a security policy | ✅ | `SECURITY.md` |
| Project documents installation | ✅ | README + `docs/EXAMPLES.md` |
| Project documents how to run it / use it | ✅ | README quick start, `docs/api/` (typedoc) |
| Project has a working build | ✅ | `npm run build`; CI job `Build (esbuild + tsc)` |
| Project has automated tests | ✅ | 333 tests; `npm test`; CI job `Test (vitest)` |

### Change control

| Criterion | Answer | Evidence |
| --- | --- | --- |
| Public VCS repository | ✅ | GitHub (canonical) |
| Public, searchable change log | ✅ | `CHANGELOG.md`, git history |
| Version numbering scheme | ✅ | SemVer, stated in `CHANGELOG.md` header |
| Unique version per release | ✅ | npm `@gkzlabs/image-compression`, git tags |
| Releases are documented | ✅ | GitHub Releases + `CHANGELOG.md` |
| Source integrity — releases traceable to VCS | ✅ | `.github/workflows/release.yml` publishes with **npm provenance** (SLSA v1) via OIDC; `npm audit signatures` verifies in CI |
| Branch protection / no force-push to main | ✅ | enabled 2026-11-12: required status checks, 1 review, no force-push, no deletion |

### Reporting

| Criterion | Answer | Evidence |
| --- | --- | --- |
| Documented vulnerability-reporting process | ✅ | `SECURITY.md` |
| Bug reports are public | ✅ | GitHub Issues |
| Vulnerability reports can be private | ✅ | `SECURITY.md` points at GitHub private advisories |

### Quality

| Criterion | Answer | Evidence |
| --- | --- | --- |
| Working build system | ✅ | `scripts/build.mjs` (ESM + CJS + worker) |
| Automated test suite | ✅ | `src/**/*.spec.ts`, `npm test` |
| Tests are run on every change | ✅ | `.github/workflows/ci.yml` |
| Tests cover most of the code | ⚠️ partial | `npm run test:coverage` exists; the suite is behaviour-focused, not a coverage-percentage gate — answer "no" or "unknown" rather than overclaiming |
| Warning flags / static analysis | ✅ | `tsc --noEmit` (lint job), CodeQL `security-and-quality` |
| Compiler warnings acted on | ✅ | `strict` tsconfig, `typecheck:test` gate for specs |
| Realistic coding style documented | ✅ | `CONTRIBUTING.md` + AGENTS.md conventions |
| Dependency vulnerability monitoring | ✅ | Dependabot + `npm audit --omit=dev` in CI + Scorecard |
| Fuzzing / property-based testing | ✅ | `src/image-header.fuzz.spec.ts` (fast-check) |
| Memory-safety / undefined behaviour | n/a | pure TypeScript, no native code |
| Secure design principles documented | ⚠️ partial | `docs/BROWSER_COMPAT.md` + `maxPixels` guard docs; no standalone threat model yet |

### Analysis / Assurance

| Criterion | Answer | Evidence |
| --- | --- | --- |
| Static analysis before release | ✅ | CodeQL job + `size` budget gate |
| External static analysis | ✅ | OpenSSF Scorecard (published), Socket.dev score badge |
| Known vulnerabilities fixed in a timely way | ✅ | 2026-11 audit: 29 → 0 (root) and every example 0 except one unfixable low pair |
| Assurance case | ❌ | not written — that is a *silver* requirement, skip at passing level |

## Honest gaps

These are the questions to answer **no** on, rather than stretch:

1. **Two or more maintainers actively responding within 2 weeks** — this is a
   single-maintainer project. Answer no; that is a silver-level criterion.
2. **Formal CVE/version numbering for vulnerabilities** — `SECURITY.md` handles
   reports, but there is no CNA/CVE process.
3. **Coverage measurement as a gate** — `test:coverage` runs on demand, it is not
   enforced in CI, so do not claim coverage thresholds.
4. **Assurance case (trusted build, reproducible builds)** — out of scope for the
   passing level.

Answering those honestly keeps the badge defensible; an inflated "passing" level
is worse than a missing badge, and the questionnaire asks for URLs as evidence
for almost every ✅.
