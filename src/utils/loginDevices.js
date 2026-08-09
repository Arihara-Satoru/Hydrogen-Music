export function findLoginDeviceItems(result) {
  const roots = [result?.data?.data, result?.data, result];
  const keys = ["li", "devices", "device_list", "dev_list", "list", "info", "items", "records"];

  for (const root of roots) {
    if (Array.isArray(root)) return root;
    if (!root || typeof root !== "object") continue;
    for (const key of keys) {
      if (Array.isArray(root[key])) return root[key];
      if (Array.isArray(root[key]?.list)) return root[key].list;
    }
  }
  return [];
}

export function buildKugouDeviceCookieString(device = {}) {
  return [
    ["KUGOU_API_MID", device?.mid],
    ["KUGOU_API_GUID", device?.guid],
    ["KUGOU_API_DEV", device?.dev],
  ]
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(";");
}

function formatDeviceTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeLocation(raw = {}) {
  const values = raw.loc
    ? String(raw.loc).trim().split(/\s+/)
    : [raw.country, raw.province, raw.city, raw.location];
  return values
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .join(" · ");
}

export function normalizeLoginDevice(raw = {}, index = 0, currentDevice = {}) {
  const mid = raw.mid ?? raw.device_mid ?? raw.guid ?? "";
  const appid = raw.appid ?? raw.app_id ?? "";
  const clientver = raw.ver ?? raw.clientver ?? raw.client_ver ?? "";
  const loginTime = raw.t ?? raw.new ?? raw.login_time ?? raw.loginTime ?? raw.last_login_time ?? "";
  const deviceName = raw.dev ?? raw.device_name ?? raw.dev_name ?? raw.model ?? raw.phone_model ?? raw.device ?? "";
  const currentMid = String(currentDevice?.mid || "");
  const currentDeviceName = String(currentDevice?.dev || "");
  const isCurrent = raw.is_current === true
    || Number(raw.is_current) === 1
    || raw.current === true
    || Number(raw.current) === 1
    || (!!currentMid && String(mid) === currentMid)
    || (!!currentDeviceName && String(deviceName).toUpperCase() === currentDeviceName.toUpperCase());
  const platformName = raw.app
    || raw.app_name
    || raw.client_name
    || (Number(appid) === 3116 ? "酷狗概念版" : Number(appid) === 1005 ? "酷狗音乐" : "酷狗客户端");
  const name = String(deviceName || `${platformName}设备 ${index + 1}`).trim();

  return {
    raw,
    key: `${mid || index}-${loginTime || "unknown"}-${appid || "app"}`,
    name,
    mid,
    appid,
    clientver,
    loginTime,
    loginTimeText: formatDeviceTime(loginTime),
    platformName,
    location: normalizeLocation(raw),
    isCurrent,
    canKick: !!mid && !!loginTime && !!appid && !!clientver && !isCurrent,
  };
}

export function normalizeLoginDevices(result, currentDevice = {}) {
  return findLoginDeviceItems(result).map((device, index) => normalizeLoginDevice(device, index, currentDevice));
}
