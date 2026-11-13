# OpenSSF Best Practices badge — answer sheet (passing level)

Scorecard's **CII-Best-Practices** check asks `bestpractices.dev` whether a
project with this repository's URL exists and holds a badge. That cannot be
answered from inside the repo — a maintainer has to register and fill the form.

This page is the pre-filled form: the 67 criteria of the **passing** level, the
exact criterion ids the questionnaire uses, and what to paste into each
justification / URL box. Everything below is verifiable in this repository.

## Registering (once)

1. Sign in at <https://www.bestpractices.dev/> with GitHub (`gkzlabs`).
2. **Get Your Badge Now!** → project URL
   `https://github.com/gkzlabs/image-compression`, name
   `@gkzlabs/image-compression`, description: *browser-based image compression
   library with zero runtime dependencies*.
3. Pick the **passing** level. Silver and gold add criteria a single-maintainer
   library cannot honestly claim (see the last section).
4. Fill the form with the tables below. Where a row says **URL**, the *"Met URL"*
   checkbox appears next to the criterion and wants a link; otherwise only the
   justification box is asked for.
5. Save section by section — the answers persist on the project record.
6. On reaching passing, copy the badge markdown into `README.md` next to the
   Scorecard badge. Scorecard picks it up on its next run.

Base URL for every link below: `https://github.com/gkzlabs/image-compression/blob/main/`

---

## Basics — basic project website content

| criterion | answer | paste |
| --- | --- | --- |
| `description_good` | **Met** | README opens with what the library does ("Compress images in the browser — zero runtime dependencies"); `package.json` carries the same one-liner for the npm page. **URL:** `README.md` |
| `interact` | **Met** | README has Installation, Usage, and a Links section pointing at the Issue Tracker; CONTRIBUTING.md covers contributing and SECURITY.md covers private reports. **URL:** `README.md` |
| `contribution` | **Met** | CONTRIBUTING.md documents the flow: branch → Conventional Commit → pull request, plus the CI gates that must pass. **URL:** `CONTRIBUTING.md` |
| `contribution_requirements` | **Met** | CONTRIBUTING.md states the requirements: `tsc` strict, `npm run typecheck:test` for specs, a test with every behaviour change, and `bash test/verify-examples.sh` after manifest changes. **URL:** `CONTRIBUTING.md` |

## Basics — FLOSS license

| criterion | answer | paste |
| --- | --- | --- |
| `floss_license` | **Met** | MIT. |
| `floss_license_osi` | **Met** | MIT is OSI-approved. |
| `license_location` | **Met** | `LICENSE` at the repository root, and `license: MIT` in `package.json`. **URL:** `LICENSE` |

## Basics — documentation

| criterion | answer | paste |
| --- | --- | --- |
| `documentation_basics` | **Met** | README (install, quick start, options, browser support) plus `docs/EXAMPLES.md`, `docs/BROWSER_COMPAT.md`, `docs/SERVER_FALLBACK.md`. **URL:** `README.md` |
| `documentation_interface` | **Met** | Every public export is documented: README "API Surface" (options table, types, transform helpers) and generated reference docs in `docs/api/` (TypeDoc). **URL:** `docs/api/` |

## Basics — other

| criterion | answer | paste |
| --- | --- | --- |
| `sites_https` | **Met** | GitHub, npm and the demo deployment are HTTPS-only. |
| `discussion` | **Met** | GitHub Issues (searchable, URL-addressable, public) and GitHub Discussions (open to anyone, no client install). |
| `english` | **Met** | Documentation and issue templates are English; English reports are accepted. |
| `maintained` | **Met** | Commits, releases and dependency updates within the last 90 days; CI runs on every pull request. |

## Change Control

| criterion | answer | paste |
| --- | --- | --- |
| `repo_public` | **Met** | Public GitHub repository; GitLab is an archived read-only mirror. **URL:** `https://github.com/gkzlabs/image-compression` |
| `repo_track` | **Met** | Full git history — author, timestamp and diff per change. |
| `repo_interim` | **Met** | Development lands as reviewable commits on `main`; releases are tagged from that history, not uploaded as squashed snapshots. |
| `repo_distributed` | **Met** | git. |
| `version_unique` | **Met** | Each release is a unique SemVer on npm (`@gkzlabs/image-compression@1.5.0`). |
| `version_semver` | **Met** | SemVer, stated in the `CHANGELOG.md` header. |
| `version_tags` | **Met** | Annotated git tag per release (`v1.5.0`, `v1.4.0`, …). **URL:** `https://github.com/gkzlabs/image-compression/tags` |
| `release_notes` | **Met** | Curated human-readable `CHANGELOG.md` sections per version, mirrored into GitHub Releases. **URL:** `CHANGELOG.md` |
| `release_notes_vulns` | **N/A** | No publicly known run-time vulnerability in this project's own code has ever had a CVE assignment. |

## Reporting

| criterion | answer | paste |
| --- | --- | --- |
| `report_process` | **Met** | GitHub Issues with bug / feature / question templates. **URL:** `https://github.com/gkzlabs/image-compression/issues/new/choose` |
| `report_tracker` | **Met** | GitHub Issues, one topic per issue. |
| `report_responses` | **Met** | No bug reports were filed in the last 12 months (0 issues); anything that arrives is triaged in the public tracker. |
| `enhancement_responses` | **Met** | Same window: no enhancement requests filed; the feature-request template routes them to the tracker. |
| `report_archive` | **Met** | Closed issues and discussions stay publicly readable and searchable. |
| `vulnerability_report_process` | **Met** | SECURITY.md documents the private channel and what a report should contain. **URL:** `SECURITY.md` |
| `vulnerability_report_private` | **Met** | Reports go through GitHub private security advisories (linked from SECURITY.md), staying private until a fix ships. |
| `vulnerability_report_response` | **Met** | No reports received in the last 6 months; SECURITY.md commits to an initial response within 14 days. |

## Quality — build

| criterion | answer | paste |
| --- | --- | --- |
| `build` | **Met** | `npm ci && npm run build` builds the ESM bundle, the CJS bundle and the standalone worker from source (`scripts/build.mjs`, esbuild + tsc). |
| `build_common_tools` | **Met** | npm, TypeScript, esbuild — the standard toolchain for a TS library. |
| `build_floss_tools` | **Met** | Every build dependency is FLOSS (esbuild MIT, TypeScript Apache-2.0, npm). |

## Quality — testing

| criterion | answer | paste |
| --- | --- | --- |
| `test` | **Met** | vitest suite (FLOSS): 36 files / 333 tests, plus real-browser suites driven by Puppeteer and Playwright. **URL:** `src/` |
| `test_invocation` | **Met** | `npm test` for units, `npm run test:browser`, `npm run test:matrix`, `npm run typecheck:test`. |
| `test_most` | **Met** | Coverage is measured on every run and enforced in CI: statements 80.1%, branches 74.7%, functions 87.6%, lines 82.6% against thresholds 78 / 72 / 85 / 80, so a regression fails the build. **URL:** `.github/workflows/ci.yml` |
| `test_continuous_integration` | **Met** | GitHub Actions runs lint, typecheck:test, unit tests, build, size budget, CodeQL, browser smoke, a three-engine matrix and builds six framework examples on every pull request. **URL:** `.github/workflows/ci.yml` |
| `test_policy` | **Met** | CONTRIBUTING.md: a behaviour change ships with a test; bug fixes start from a failing spec. |
| `tests_are_added` | **Met** | Recent evidence — the header-parser fuzzing spec (`src/image-header.fuzz.spec.ts`) and the vitest 5 migration both landed with tests, and the last months of fix PRs each added or updated a spec. |
| `tests_documented_added` | **Met** | CONTRIBUTING.md states the test expectation next to the commit and PR rules. |

## Quality — warnings

| criterion | answer | paste |
| --- | --- | --- |
| `warnings` | **Met** | `tsc --noEmit` with `strict`, `noImplicitReturns` and `noFallthroughCasesInSwitch` is a required CI job; `typecheck:test` covers the spec files too. |
| `warnings_fixed` | **Met** | The lint job fails on any diagnostic, so nothing ships with warnings. |
| `warnings_strict` | **Met** | Strictest practical settings for this codebase; the remaining quality queries are covered by CodeQL's suite. |

## Security — knowledge

| criterion | answer | paste |
| --- | --- | --- |
| `know_secure_design` | **Met** | The maintainer designed and implemented the security-relevant parts: the `maxPixels` decompression-bomb guard that reads only image headers before any decode, an allow-listed worker RPC protocol, bounded EXIF handling, and a CSP-safe build (no `eval`, no `new Function`). Design follows OWASP ASVS and the CWE Top 25 — the bomb guard exists because of CWE-409. |
| `know_common_errors` | **Met** | Error classes handled explicitly: decompression bombs (CWE-409), unbounded memory in canvas paths, URL/path injection in worker loading, prototype pollution in option merging, and unbounded waits on third-party decoders (the HEIC import is capped at 10 s). |

## Security — cryptography

The library implements no cryptography of its own; encoding is delegated to the
browser's codecs (`ImageDecoder`, `OffscreenCanvas.convertToBlob`). Every
`crypto_*` criterion is therefore **N/A**.

| criterion | answer | paste |
| --- | --- | --- |
| `crypto_published` | **N/A** | No cryptographic protocol or algorithm is implemented — browser codecs are used. |
| `crypto_call` | **N/A** | Not a cryptography library. |
| `crypto_floss` | **N/A** | No cryptography implementation to license. |
| `crypto_keylength` | **N/A** | No keys. |
| `crypto_working` | **N/A** | No security mechanism depends on a broken algorithm. |
| `crypto_weaknesses` | **N/A** | Same. |
| `crypto_pfs` | **N/A** | The library terminates no transport; delivery security is covered by `delivery_mitm`. |
| `crypto_password_storage` | **N/A** | No passwords are stored. |
| `crypto_random` | **N/A** | No cryptographic randomness is generated or consumed. |

## Security — delivery and vulnerabilities

| criterion | answer | paste |
| --- | --- | --- |
| `delivery_mitm` | **Met** | npm over HTTPS with registry signatures and attestations; publishes carry SLSA provenance (`npm publish --provenance`, verified by `npm audit signatures` in CI), and each GitHub Release carries the exact tarball plus its in-toto provenance bundle. |
| `delivery_unsigned` | **Met** | Nothing is delivered over plain HTTP; integrity comes from registry signatures plus the provenance bundle attached to every release. |
| `vulnerabilities_fixed_60_days` | **Met** | The published package has **zero runtime dependencies**, so its dependency graph carries no advisories. Dev-only tooling is audited in CI (`npm audit --omit=dev`, Dependabot, Scorecard): the root and five of six examples report 0; the one remaining low-severity advisory (`deepmerge`, inside the Svelte demo's build plugin) has no published upstream fix and does not ship. |
| `vulnerabilities_critical_fixed` | **Met** | No critical vulnerability has been reported against this project. |
| `no_leaked_credentials` | **Met** | No credentials or private keys in the repository; publishing uses OIDC trusted publishing, so no long-lived npm token exists in the repo or in CI secrets. |
| `static_analysis` | **Met** | CodeQL (`security-and-quality` suite) on every push and pull request, plus `tsc --noEmit`. **URL:** `.github/workflows/codeql.yml` |
| `static_analysis_common_vulnerabilities` | **Met** | The CodeQL suite carries the common-vulnerability queries: injection, path handling, prototype pollution, unsafe DOM sinks. |
| `static_analysis_fixed` | **Met** | The CodeQL backlog was worked to zero fixable findings; the four remaining alerts are OpenSSF Scorecard meta-checks, visible and explained in the security tab. |
| `static_analysis_often` | **Met** | Runs on every pull request and every push to `main`. |
| `dynamic_analysis` | **Met** | Real-Chromium smoke, a three-engine matrix (Chromium / Firefox / WebKit), a deep worker check with pixel assertions, a hostile-bundler end-to-end run, and property-based fuzzing of the header parser. **URL:** `.github/workflows/ci.yml` |
| `dynamic_analysis_unsafe` | **N/A** | Pure TypeScript; no memory-unsafe language involved. |
| `dynamic_analysis_enable_assertions` | **Met** | Assertions are on everywhere — 333 unit assertions plus the browser suites' explicit pass/fail records; CI fails on any assertion error. |
| `dynamic_analysis_fixed` | **Met** | No outstanding medium-or-higher finding from the dynamic suites. |

---

## Deliberately not claimed

Gold/silver criteria a single-maintainer library cannot honestly meet — answer
"no" and the passing badge is unaffected:

- **Two or more maintainers responding within 2 weeks** — one maintainer.
- **CNA / CVE numbering process** — SECURITY.md handles reports, not CVEs.
- **Assurance case / reproducible builds / signed developer certificates.**
- **Coverage "100% of branches"** — `test_most` is answered with the measured
  numbers above, not with a claim of completeness.
