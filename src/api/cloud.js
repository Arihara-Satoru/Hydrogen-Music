import request from "../utils/request";
import { normalizePlaylistSong } from "./playlist";

const DEFAULT_CLOUD_PAGE_SIZE = 100;
const MAX_AUTO_PAGES = 100;
// ponytail: ten minutes covers the backend's current 100 MB limit; add progress/cancellation if that grows.
const CLOUD_UPLOAD_TIMEOUT = 10 * 60 * 1000;

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeCloudTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number < 1e12 ? number * 1000 : number;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCloudResponseParts(result) {
  const root = result && typeof result === "object" ? result : {};
  const payload = root?.data && typeof root.data === "object" ? root.data : root;
  return { root, payload };
}

function assertCloudResponseSucceeded(value, fallbackMessage) {
  const errorCode = firstFiniteNumber(value?.error_code, value?.errcode);
  const status = firstFiniteNumber(value?.status);
  const code = firstFiniteNumber(value?.code);
  const failed = (errorCode !== null && errorCode !== 0)
    || (status !== null && status !== 1 && status !== 200)
    || (status === null && code !== null && ![0, 1, 200].includes(code));

  if (!failed) return;

  const responseMessage = value?.error_msg || value?.errmsg || value?.message || value?.msg;
  const error = new Error(typeof responseMessage === "string" && responseMessage.trim()
    ? responseMessage
    : fallbackMessage);
  error.code = errorCode ?? status ?? code;
  throw error;
}

function extractCloudList(root, payload) {
  const candidates = [
    payload,
    payload?.info,
    payload?.list,
    payload?.songs,
    payload?.items,
    payload?.data,
    payload?.data?.info,
    payload?.data?.list,
    root?.info,
    root?.list,
    root?.songs,
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizeCloudPagination(params = {}) {
  const pagesize = Number(params?.pagesize || params?.limit || DEFAULT_CLOUD_PAGE_SIZE);
  const safePageSize = Number.isFinite(pagesize) && pagesize > 0
    ? Math.floor(pagesize)
    : DEFAULT_CLOUD_PAGE_SIZE;
  const page = Number(
    params?.page || (params?.offset != null ? Math.floor(Number(params.offset) / safePageSize) + 1 : 1)
  );

  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pagesize: safePageSize,
  };
}

function normalizeCloudSong(item = {}) {
  const baseSong = normalizePlaylistSong(item?.simpleSong || item?.simple_song || item?.song || item?.music || item);
  const fileName = item?.fileName || item?.FileName || item?.file_name || item?.filename || item?.name || baseSong?.name || "未知文件";
  const songName = item?.songName || item?.song_name || item?.songname || item?.audio_name || item?.name || baseSong?.name || fileName || "未知歌曲";
  const fileSize = firstFiniteNumber(
    item?.fileSize,
    item?.FileSize,
    item?.file_size,
    item?.size,
    item?.filesize
  ) || 0;
  const addTime = normalizeCloudTimestamp(
    item?.addTime
      ?? item?.add_time
      ?? item?.addtime
      ?? item?.time
      ?? item?.createTime
      ?? item?.create_time
      ?? item?.upload_time
  );
  const cloudHash = String(
    item?.hash
      || item?.FileHash
      || item?.file_hash
      || baseSong?.hash
      || ""
  ).trim();
  const cloudAudioId = item?.audio_id || item?.audioId || "";
  const cloudAlbumAudioId = item?.album_audio_id || item?.albumAudioId || baseSong?.album_audio_id || "";
  const cloudFileId = item?.kv_id || item?.kvId || item?.file_id || item?.fileid || "";
  const normalizedId = cloudFileId || item?.id || baseSong?.id || cloudAlbumAudioId || cloudAudioId || cloudHash || fileName;

  return {
    ...item,
    id: normalizedId,
    kv_id: cloudFileId,
    songName,
    fileName,
    fileSize,
    addTime,
    hash: cloudHash,
    audio_id: cloudAudioId,
    album_audio_id: cloudAlbumAudioId,
    simpleSong: {
      ...baseSong,
      id: normalizedId,
      hash: cloudHash || baseSong?.hash || "",
      audio_id: cloudAudioId || baseSong?.audio_id || "",
      album_audio_id: cloudAlbumAudioId || baseSong?.album_audio_id || "",
      name: baseSong?.name || songName,
      cloudUrlParams: {
        hash: cloudHash || undefined,
        album_id: item?.album_id || baseSong?.al?.id || baseSong?.album?.id || undefined,
        album_audio_id: cloudAlbumAudioId || undefined,
        audio_id: cloudAudioId || undefined,
        name: songName,
      },
      source: "cloud",
      type: "cloud",
    },
  };
}

async function getCloudDiskPage(params) {
  const result = await request({
    url: "/user/cloud",
    method: "get",
    params,
  });
  const { root, payload } = getCloudResponseParts(result);
  assertCloudResponseSucceeded(root, "获取云盘数据失败");
  if (payload !== root) assertCloudResponseSucceeded(payload, "获取云盘数据失败");

  const list = extractCloudList(root, payload).map((item) => normalizeCloudSong(item));
  const total = firstFiniteNumber(
    payload?.total,
    payload?.count,
    payload?.total_count,
    payload?.total_num,
    payload?.data?.total,
    root?.total,
    root?.count
  );

  return {
    ...(result && typeof result === "object" && !Array.isArray(result) ? result : {}),
    count: total ?? list.length,
    totalKnown: total !== null,
    size: firstFiniteNumber(
      payload?.used_size,
      payload?.usedSize,
      payload?.size,
      payload?.total_size,
      payload?.data?.used_size,
      root?.used_size,
      root?.size
    ) || 0,
    maxSize: firstFiniteNumber(
      payload?.max_size,
      payload?.maxSize,
      payload?.capacity,
      payload?.data?.max_size,
      root?.max_size,
      root?.maxSize
    ) || 0,
    data: list,
  };
}

function normalizeCloudMutationResult(result, fallbackMessage) {
  const { root, payload } = getCloudResponseParts(result);
  assertCloudResponseSucceeded(root, fallbackMessage);
  if (payload !== root) assertCloudResponseSucceeded(payload, fallbackMessage);
  return { ...root, code: 200 };
}

/**
 * 获取用户云盘数据。
 * 酷狗接口使用 page/pagesize 分页，这里兼容旧调用方的 limit/offset 参数。
 */
export async function getCloudDiskData(params = {}) {
  const pagination = normalizeCloudPagination(params);
  const songs = [];
  let firstPage = null;
  let total = null;

  // ponytail: cap automatic paging at 100 requests; switch to virtual paging if accounts can exceed this.
  for (let index = 0; index < MAX_AUTO_PAGES; index += 1) {
    const pageResult = await getCloudDiskPage({
      ...params,
      page: pagination.page + index,
      pagesize: pagination.pagesize,
    });
    firstPage ||= pageResult;

    const pageSongs = Array.isArray(pageResult.data) ? pageResult.data : [];
    songs.push(...pageSongs);
    if (pageResult.totalKnown) total = pageResult.count;

    if (pageSongs.length < pagination.pagesize || (total !== null && total > 0 && songs.length >= total)) break;
  }

  return {
    ...(firstPage || {}),
    count: total === null ? songs.length : Math.max(total, songs.length),
    data: songs,
  };
}

/** 获取云盘歌曲播放地址。 */
export function getCloudDiskSongUrl(params = {}) {
  if (!String(params?.hash || "").trim()) {
    return Promise.reject(new Error("云盘歌曲缺少 hash，无法获取播放地址"));
  }

  return request({
    url: "/user/cloud/url",
    method: "get",
    params,
  });
}

/** 酷狗文档中未提供云盘详情接口，保留占位避免旧调用直接报错。 */
export function getCloudDiskDrtail(_params) {
  return Promise.resolve({
    code: 501,
    message: "KuGou API 暂未提供云盘详情接口",
  });
}

/** 删除用户云盘音乐，fileid 对应列表接口返回的 kv_id。 */
export function deleteCloudSong(params = {}) {
  return request({
    url: "/user/cloud/del",
    method: "post",
    params: { ...params, timestamp: Date.now() },
  }).then((result) => normalizeCloudMutationResult(result, "删除云盘歌曲失败"));
}

/** 按接口要求将文件本体作为 application/octet-stream 上传。 */
export function uploadCloudSong(file, params = {}) {
  if (!file) return Promise.reject(new TypeError("请选择要上传的音乐文件"));

  const fileName = String(file?.name || params?.name || "").trim();
  const fileExtension = fileName.includes(".") ? fileName.split(".").pop() : "";
  const extendname = String(params?.extendname || fileExtension || "mp3")
    .replace(/^\./, "")
    .toLowerCase();

  return request({
    url: "/user/cloud/upload",
    method: "post",
    headers: { "Content-Type": "application/octet-stream" },
    data: file,
    params: {
      ...params,
      extendname,
      name: params?.name || fileName || undefined,
      timestamp: Date.now(),
    },
    timeout: CLOUD_UPLOAD_TIMEOUT,
  }).then((result) => normalizeCloudMutationResult(result, "上传云盘歌曲失败"));
}
