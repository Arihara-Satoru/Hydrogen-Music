const { createHash, randomBytes } = require("node:crypto");

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_GUID_PATTERN = /^[0-9a-f]{32}$/i;
const DEVICE_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/i;

function md5(value) {
  return createHash("md5").update(String(value)).digest("hex");
}

function normalizeGuid(value) {
  const guid = String(value || "").trim();
  if (UUID_V4_PATTERN.test(guid)) return md5(guid);
  return HEX_GUID_PATTERN.test(guid) ? guid.toLowerCase() : "";
}

function normalizeDeviceName(value) {
  const name = String(value || "").trim().toUpperCase();
  return DEVICE_NAME_PATTERN.test(name) ? name : "";
}

function createKugouDeviceIdentity(saved = {}, environment = process.env) {
  const savedGuid = normalizeGuid(saved.guid);
  const environmentGuid = normalizeGuid(environment?.KUGOU_API_GUID);
  const guid = environmentGuid || savedGuid || randomBytes(16).toString("hex");
  const savedDeviceName = guid === savedGuid ? normalizeDeviceName(saved.dev) : "";
  const dev = normalizeDeviceName(environment?.KUGOU_API_DEV)
    || savedDeviceName
    || `HYDRO${guid.slice(0, 5).toUpperCase()}`;
  const mid = BigInt(`0x${md5(guid)}`).toString();

  return { guid, dev, mid };
}

module.exports = { createKugouDeviceIdentity };
