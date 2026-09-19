#!/usr/bin/env node
/**
 * Refresh `.github/socket-score.json` (the shields.io endpoint badge behind the
 * README's Socket badge) from Socket's API.
 *
 * Why this exists: Socket's own badge image
 * (`https://socket.dev/api/badge/npm/package/<pkg>`) answers non-interactive
 * requests with a Cloudflare managed challenge, so GitHub's camo image proxy can
 * never fetch it. A shields endpoint badge reading a JSON file in the repo always
 * renders — this script keeps that file current.
 *
 * API: `POST https://api.socket.dev/v0/purl` with a purl, which returns the
 * package's scores and alerts (successor of the deprecated "get score by npm
 * package" endpoint). Docs: https://docs.socket.dev (see "Get Packages by PURL").
 * Auth: `Authorization: Bearer $SOCKET_API_TOKEN`.
 *
 * Usage:
 *   SOCKET_API_TOKEN=... node .github/scripts/socket-score.mjs [--version 1.3.3]
 *   node .github/scripts/socket-score.mjs --mock .github/scripts/socket-score.fixture.json
 *
 * Exit codes: 0 = ok (or nothing to do), 1 = the token is rejected/insufficient
 * (worth failing the scheduled run so the auth problem is visible).
 *
 * Failure policy: a network blip, an HTTP 5xx, or an unexpected response shape
 * leaves the existing badge value untouched and exits 0 — a stale score is better
 * than a broken badge or a red weekly run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BADGE_JSON = resolve(ROOT, '.github', 'socket-score.json');
const API = 'https://api.socket.dev/v0/purl';

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};

const packageName = flag('package', '@gkzlabs/image-compression');
const mockPath = flag('mock');
const token = process.env.SOCKET_API_TOKEN;

function currentVersion() {
  const explicit = flag('version');
  if (explicit && explicit !== true) return explicit;
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return undefined;
  }
}

const version = currentVersion();
const purl = version ? `pkg:npm/${packageName}@${version}` : `pkg:npm/${packageName}`;

/** Walk any JSON shape and collect candidate objects that carry a `score` block. */
function findScoreBlocks(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) findScoreBlocks(item, out);
    return out;
  }
  if (node.score && typeof node.score === 'object') out.push(node);
  for (const value of Object.values(node)) findScoreBlocks(value, out);
  return out;
}

/** Extract { percent, alerts, raw } from a Socket payload, or null if unusable. */
function extract(payload) {
  const rows = findScoreBlocks(payload);
  if (rows.length === 0) return null;

  // Prefer the row that names our package (the batch endpoint can echo several).
  const row =
    rows.find((r) => typeof r.id === 'string' && r.id.includes(packageName)) ??
    rows.find((r) => typeof r.name === 'string' && r.name.includes(packageName)) ??
    rows[0];

  const score = row.score ?? {};
  // depscore (0–1) is the average of all factors; the per-category values are
  // also 0–1. Accept either a 0–1 or an already-percent value.
  const raw = [score.depscore, score.overall, score.supplyChainRisk, score.quality].find(
    (v) => typeof v === 'number',
  );
  if (typeof raw !== 'number') return null;

  const percent = Math.round(raw <= 1 ? raw * 100 : raw);

  const alerts = Array.isArray(row.alerts) ? row.alerts.length : undefined;
  const issues = ['critical', 'high', 'medium', 'low'].reduce((sum, level) => {
    const v = score[`${level}IssueCount`] ?? score[`${level}IssueCount`];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);

  return { percent, alerts, issues, version: row.version ?? version, raw };
}

function writeBadge({ percent, alerts, version: measuredOn }, previous) {
  const alertsText = typeof alerts === 'number' ? `${alerts} alert${alerts === 1 ? '' : 's'}` : '0 alerts';
  const badge = {
    schemaVersion: 1,
    label: 'socket.dev',
    message: `${percent}/100 · ${alertsText}${measuredOn ? ` (v${measuredOn})` : ''}`,
    color: percent >= 90 ? 'brightgreen' : percent >= 70 ? 'green' : percent >= 50 ? 'yellow' : 'red',
    labelColor: previous?.labelColor ?? '1f2937',
    cacheSeconds: 3600,
  };
  writeFileSync(BADGE_JSON, `${JSON.stringify(badge, null, 2)}\n`);
  return badge;
}

function previousBadge() {
  try {
    return JSON.parse(readFileSync(BADGE_JSON, 'utf8'));
  } catch {
    return undefined;
  }
}

function keep(reason) {
  const prev = previousBadge();
  console.warn(`[socket-score] ${reason}`);
  console.warn(`[socket-score] badge left unchanged: ${prev ? prev.message : '(no existing badge)'}`);
  process.exit(0);
}

async function main() {
  console.log(`[socket-score] package ${packageName} version ${version ?? '(latest)'}`);
  console.log(`[socket-score] purl ${purl}`);

  let payload;
  if (mockPath && mockPath !== true) {
    console.log(`[socket-score] MOCK mode — reading ${mockPath}`);
    payload = JSON.parse(readFileSync(resolve(ROOT, mockPath), 'utf8'));
  } else {
    if (!token) {
      keep('SOCKET_API_TOKEN is not set — skipping (add it as a repository secret to enable this job).');
    }
    const res = await fetch(`${API}?alerts=true&compact=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ components: [{ purl }] }),
    });
    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      console.error(`[socket-score] HTTP ${res.status} — the token was rejected or lacks access: ${text.slice(0, 200)}`);
      process.exit(1);
    }
    if (!res.ok) {
      keep(`HTTP ${res.status} from Socket (${text.slice(0, 160)})`);
    }
    try {
      payload = JSON.parse(text);
    } catch {
      keep(`response was not JSON (${text.slice(0, 120)})`);
    }
  }

  const extracted = extract(payload);
  if (!extracted) {
    keep('could not find a score in the response — the API shape may have changed');
  }

  const before = previousBadge();
  const after = writeBadge(extracted, before);
  console.log(`[socket-score] extracted: ${JSON.stringify(extracted)}`);
  console.log(`[socket-score] badge: ${before?.message ?? '(none)'} → ${after.message}`);
  if (before?.message === after.message) console.log('[socket-score] unchanged');
}

main().catch((err) => {
  // A network failure should not break the weekly run, and must not corrupt the badge.
  keep(`unexpected error: ${err?.message ?? err}`);
});
