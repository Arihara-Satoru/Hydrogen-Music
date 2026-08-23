function parseUrl(value) {
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function shouldOpenExternally(targetUrl, currentUrl = "") {
  const target = parseUrl(targetUrl);
  if (!target) return false;
  if (target.protocol === "mailto:" || target.protocol === "tel:") return true;
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;

  const current = parseUrl(currentUrl);
  return !current || target.origin !== current.origin;
}

function isAllowedInternalNavigation(targetUrl, currentUrl) {
  const target = parseUrl(targetUrl);
  const current = parseUrl(currentUrl);
  if (!target || !current) return false;
  if (current.protocol === "file:") {
    return target.protocol === "file:" && target.pathname === current.pathname;
  }
  return target.origin === current.origin;
}

module.exports = { isAllowedInternalNavigation, shouldOpenExternally };
