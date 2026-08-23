const assert = require("node:assert/strict");
const {
  isAllowedInternalNavigation,
  shouldOpenExternally,
} = require("../src/electron/externalLinks");

assert.equal(shouldOpenExternally("https://example.com", "file:///app/index.html"), true);
assert.equal(shouldOpenExternally("mailto:test@example.com"), true);
assert.equal(shouldOpenExternally("javascript:alert(1)"), false);
assert.equal(isAllowedInternalNavigation("file:///app/index.html#home", "file:///app/index.html"), true);
assert.equal(isAllowedInternalNavigation("file:///tmp/other.html", "file:///app/index.html"), false);
assert.equal(isAllowedInternalNavigation("http://localhost:5173/search", "http://localhost:5173/"), true);
assert.equal(isAllowedInternalNavigation("https://example.com", "http://localhost:5173/"), false);

console.log("external link check passed");
