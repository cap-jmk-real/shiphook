#!/usr/bin/env node
/**
 * CI version guard: fail if the current package.json version is already published to npm.
 *
 * In GitHub Actions, ensures we don't merge or push with a version that's already
 * on npm (avoids publish failures and double-release). Locally this script is a no-op.
 *
 * Usage: node scripts/check-version-not-released.mjs
 * Env: GITHUB_ACTIONS (optional) — when "true", runs the check; otherwise exits 0.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const inCi = process.env.GITHUB_ACTIONS === "true";

if (!inCi) {
  console.log("Version guard: not running in GitHub Actions, skipping.");
  process.exit(0);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const packageName = pkg.name || "shiphook";
const current = String(pkg.version);

async function getPublishedVersion() {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ? String(data.version) : null;
  } catch {
    return null;
  }
}

const published = await getPublishedVersion();

if (!published) {
  console.log(
    `Version guard OK: no published version on npm yet. Current version is ${current}.`
  );
  process.exit(0);
}

if (current === published) {
  console.error(
    [
      `Version guard: current version ${current} is already published to npm.`,
      "Bump the version before merging to main, e.g.:",
      "  npm run version:patch",
      "  npm run version:minor",
      "  npm run version:major",
      "then commit, push, and merge.",
    ].join("\n")
  );
  process.exit(1);
}

console.log(
  `Version guard OK: current version ${current} differs from published ${published}.`
);
