#!/usr/bin/env node
/**
 * PrivacyScreen — paints a natural-looking contribution graph.
 * Creates backdated commits across the last N years with varied daily intensity.
 */

import { execSync } from "node:child_process";
import { appendFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const LOG = resolve(ROOT, "screen.log");

// --- knobs ---
const YEARS = 3;
/** Prefer Gmail for GitHub graph attribution; override with GIT_AUTHOR_EMAIL if needed. */
const AUTHOR_EMAIL =
  process.env.GIT_AUTHOR_EMAIL || "seanwwetherell@gmail.com";
const AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "SEAN WETHERELL";
const SEED = process.env.PRIVACY_SEED
  ? Number(process.env.PRIVACY_SEED)
  : Date.now() % 1e9;

/** Target density: fraction of days with at least one commit (weekdays). */
const WEEKDAY_ACTIVE = 0.82;
/** Weekend activity rate (usually a bit lower). */
const WEEKEND_ACTIVE = 0.55;
/** Max commits on a single day (GitHub caps visual intensity around 4+). */
const MAX_COMMITS = 8;

// Mulberry32 PRNG — reproducible if you set PRIVACY_SEED
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t >>> 7)) + Math.imul(t ^ (t >>> 61), t | 1);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(d) {
  // Midday UTC avoids timezone edge cases flipping the contribution day
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T14:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
}

function dayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Keep Christmas dark on the graph. */
function isChristmas(d) {
  return d.getUTCMonth() === 11 && d.getUTCDate() === 25;
}

function commitsForDay(d, isWeekend) {
  if (isChristmas(d)) return 0;

  const chance = isWeekend ? WEEKEND_ACTIVE : WEEKDAY_ACTIVE;
  if (rand() > chance) return 0;

  // Weighted intensity: more light/medium days than heavy — looks organic
  const roll = rand();
  if (roll < 0.42) return 1;
  if (roll < 0.68) return 2;
  if (roll < 0.84) return 3;
  if (roll < 0.93) return 4 + Math.floor(rand() * 2); // 4–5
  return 6 + Math.floor(rand() * (MAX_COMMITS - 5)); // 6–8
}

function git(cmd, env = {}) {
  execSync(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
}

function resetHistory() {
  if (existsSync(LOG)) unlinkSync(LOG);
  // Soft reset to orphan if repo already has history from a prior run
  try {
    git("git checkout --orphan privacy-temp");
    git("git rm -rf --cached . 2>/dev/null || true");
  } catch {
    /* fresh repo */
  }
}

function parseArgDate(flag) {
  const arg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return null;
  const raw = arg.slice(flag.length + 1);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw new Error(`Invalid ${flag} date: ${raw} (use YYYY-MM-DD)`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function main() {
  const reset = process.argv.includes("--reset");
  const fromArg = parseArgDate("--from");
  const toArg = parseArgDate("--to");

  if (!existsSync(resolve(ROOT, ".git"))) {
    git("git init -b main");
  }

  if (reset) {
    console.log("Resetting prior screen commits…");
    resetHistory();
  }

  const end = toArg || dayUTC(new Date());
  const start =
    fromArg ||
    (() => {
      const s = new Date(end);
      s.setUTCFullYear(s.getUTCFullYear() - YEARS);
      return s;
    })();

  console.log(
    `PrivacyScreen seed=${SEED} range=${start.toISOString().slice(0, 10)}..${end
      .toISOString()
      .slice(0, 10)} author=${AUTHOR_EMAIL}`
  );

  // Seed file so first commit has content
  if (!existsSync(LOG)) {
    writeFileSync(LOG, `# PrivacyScreen\n# seed=${SEED}\n`);
  }

  let totalCommits = 0;
  let activeDays = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    const dow = cursor.getUTCDay(); // 0 Sun … 6 Sat
    const isWeekend = dow === 0 || dow === 6;
    const n = commitsForDay(cursor, isWeekend);

    if (n > 0) activeDays += 1;

    for (let i = 0; i < n; i++) {
      const when = formatDate(cursor);
      // Slight per-commit time jitter already in formatDate via minutes/seconds
      const stamp = `${when} +0000`;
      appendFileSync(
        LOG,
        `${when} #${totalCommits + 1} d=${cursor.toISOString().slice(0, 10)}\n`
      );
      git("git add screen.log");
      git(`git commit -m "screen: ${cursor.toISOString().slice(0, 10)}/${i + 1}"`, {
        GIT_AUTHOR_DATE: stamp,
        GIT_COMMITTER_DATE: stamp,
        GIT_AUTHOR_NAME: AUTHOR_NAME,
        GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: AUTHOR_NAME,
        GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      });
      totalCommits += 1;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);

    if (totalCommits > 0 && totalCommits % 200 === 0) {
      process.stdout.write(`  … ${totalCommits} commits\n`);
    }
  }

  // Ensure we're on main
  try {
    git("git branch -M main");
  } catch {
    /* already main */
  }

  console.log(
    `\nDone. ${totalCommits} commits across ${activeDays} active days.`
  );
  console.log("Push to GitHub, then wait a minute for the contribution graph to refresh.");
  console.log(`Re-run with the same look: PRIVACY_SEED=${SEED} npm run generate -- --reset`);
  console.log("Date window: npm run generate -- --from=2023-08-07 --to=2024-12-31");
}

main();
