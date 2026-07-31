const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SPLASH_FAMILIES,
  normalizeFamily,
  normalizeProgress,
  stageIndexForProgress,
} = require("../splash.js");

assert.deepEqual(SPLASH_FAMILIES, [
  "exa",
  "corporate",
  "popucom",
  "endfield",
  "ark",
]);
assert.equal(normalizeFamily("exa"), "exa");
assert.equal(normalizeFamily("legacy-theme"), "ark");
assert.equal(normalizeProgress(-5), 0);
assert.equal(normalizeProgress(42.4), 42);
assert.equal(normalizeProgress(120), 100);
assert.deepEqual(
  [0, 37, 38, 55, 56, 81, 82, 99, 100].map(stageIndexForProgress),
  [0, 0, 1, 1, 2, 2, 3, 3, 4],
);

const css = fs.readFileSync(path.join(__dirname, "..", "splash.css"), "utf8");
for (const family of SPLASH_FAMILIES) {
  assert.match(css, new RegExp(`data-ark-theme="${family}"`));
}
assert.match(css, /prefers-reduced-motion:\s*reduce/);

console.log("Splash self-check passed.");
