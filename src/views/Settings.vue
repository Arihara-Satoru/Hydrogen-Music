<script setup>
import { computed, onActivated, onUnmounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { author, version } from "../../package.json";
import { noticeOpen, dialogOpen } from "@/utils/dialog";
import { initSettings } from "@/utils/initApp";
import {
  getLoginDevices,
  getVipInfo,
  kickLoginDevice,
} from "@/api/user";
import { isLogin } from "@/utils/authority";
import { normalizeLoginDevices } from "@/utils/loginDevices";
import { getKugouApiDeviceIdentity } from "@/utils/request";
import { useUserStore } from "@/store/userStore";
import { usePlayerStore } from "@/store/playerStore";
import Selector from "../components/Selector.vue";
import FontSelector from "../components/FontSelector.vue";
import UpdateDialog from "../components/UpdateDialog.vue";
import { setTheme, getSavedTheme } from "@/utils/theme";
import { getDynamicThemeColor } from "@/utils/dynamicTheme";
import { resolveImageUrl } from "@/utils/imageUtils";
import { confirmAccountLogout } from "@/utils/accountSession";
import { getDailyVipClaimText } from "@/utils/dailyVipClaim";
import { applyCustomFontStyle } from "@/utils/setFont";
import { refreshListenGradeInfo } from "@/utils/listenTimeReporter";
import {
  getFmRecentCacheKey,
  markFmRecentCacheCleaned,
} from "@/utils/fmRecentCache.mjs";
import {
  buildFontOptions,
  loadSystemFontOptions,
  resolveSystemFontLabel,
  resolveSystemFontValue,
} from "@/utils/fontResolver";

const router = useRouter();
const userStore = useUserStore();
const playerStore = usePlayerStore();
const currentUser = computed(() => userStore.user || {});
const listenGradeLoading = ref(false);
const listenGradeText = computed(() => {
  const grade = Number(userStore.gradeInfo?.p_grade);
  if (Number.isFinite(grade)) return `LV.${grade}`;
  return listenGradeLoading.value ? "加载中…" : "暂不可用";
});
const formatListenDuration = (seconds) => {
  const totalSeconds = Number(seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "暂不可用";

  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
};
const listenDurationText = computed(() =>
  userStore.gradeInfo
    ? formatListenDuration(userStore.gradeInfo.d_sec)
    : listenGradeLoading.value
      ? "加载中…"
      : "暂不可用",
);
const profileAvatarUrl = computed(
  () =>
    currentUser.value.avatarUrl ||
    currentUser.value.kAvatarUrl ||
    currentUser.value.fxAvatarUrl ||
    "",
);
const profileAliases = computed(() =>
  [currentUser.value.kNickname, currentUser.value.fxNickname].filter(
    (value) => value && value !== currentUser.value.nickname,
  ),
);
const profileVipText = computed(() => {
  const user = currentUser.value;
  const parts = [];
  if (user.vipType) parts.push(`VIP ${user.vipType}`);
  if (user.mType) parts.push(`月卡 ${user.mType}`);
  if (user.yType) parts.push(`年卡 ${user.yType}`);
  if (user.svipLevel) parts.push(`SVIP ${user.svipLevel}`);
  if (user.bookvipValid) parts.push(`书包会员 ${user.bookvipValid}`);
  return parts.length ? parts.join(" · ") : "普通用户";
});
const profileDetailList = computed(() => [
  {
    label: "个性签名",
    value:
      currentUser.value.description || currentUser.value.signature || "未填写",
  },
  { label: "听歌等级", value: listenGradeText.value },
  { label: "累计听歌", value: listenDurationText.value },
  { label: "所在地", value: currentUser.value.location || "未填写" },
  {
    label: "生日",
    value:
      currentUser.value.birthdayText || currentUser.value.birthday || "未填写",
  },
  { label: "职业", value: currentUser.value.occupation || "未填写" },
  { label: "会员状态", value: profileVipText.value },
  {
    label: "今日 VIP",
    value: getDailyVipClaimText(
      currentUser.value.userId || currentUser.value.userid || "",
    ),
  },
  {
    label: "粉丝",
    value: currentUser.value.fans ?? currentUser.value.followeds ?? "未填写",
  },
  { label: "关注", value: currentUser.value.follows ?? "未填写" },
  { label: "访客", value: currentUser.value.visitors ?? "未填写" },
  { label: "历史访客", value: currentUser.value.hvisitors ?? "未填写" },
]);

const vipInfo = ref(null);
const loginDevices = ref([]);
const devicesLoading = ref(false);
const devicesError = ref("");
const kickingDeviceKey = ref("");
let deviceRequestSerial = 0;
const musicLevel = ref("flac");
const musicLevelOptions = ref([
  {
    label: "标准 (128kbps MP3)",
    value: "128",
  },
  {
    label: "高品质 (320kbps MP3)",
    value: "320",
  },
  {
    label: "无损 (FLAC)",
    value: "flac",
  },
  {
    label: "高清无损",
    value: "high",
  },
]);
const coverSize = ref(400);
const coverSizeOptions = ref(
  [480, 400, 240, 150, 135, 120, 110, 100, 93, 64].map((v) => ({
    label: String(v),
    value: v,
  })),
);
const lyricSize = ref(20);
const tlyricSize = ref(13);
const rlyricSize = ref(12);
const lyricInterlude = ref(13);
const searchAssistLimit = ref(8);
const autoPlayOnStartup = ref(false);
const pauseOnOtherAudio = ref(false);
const isWindows = window.process?.platform === "win32";
const globalShortcuts = ref(false);
const appUpdateEnabled = ref(true);
const startupAnimation = ref("ark");
const startupAnimationOptions = ref([
  { label: "星空", value: "exa" },
  { label: "黑白", value: "corporate" },
  { label: "缤纷", value: "popucom" },
  { label: "工程", value: "endfield" },
  { label: "工业", value: "ark" },
]);
const quitApp = ref("minimize");
const quitAppOptions = ref([
  {
    label: "最小化至托盘",
    value: "minimize",
  },
  {
    label: "直接退出",
    value: "quit",
  },
]);
const theme = ref("system");
const themeOptions = ref([
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
]);
const customThemeColor = computed({
  get: () => playerStore.customThemeColor || "#6b9fb4",
  set: (color) => {
    playerStore.dynamicTheme = false;
    playerStore.customThemeColor = color;
  },
});
const currentCoverUrl = computed(() => {
  const song = playerStore.songList?.[playerStore.currentIndex];
  if (!song) return "";
  if (song.type === "local") return playerStore.localBase64Img || "";

  const url = song.coverUrl || song.al?.picUrl || song.blurPicUrl || song.img1v1Url;
  return url ? resolveImageUrl(url) : "";
});
const lockingCurrentSongColor = ref(false);
const customFont = ref("");
const customFontLabel = ref("");
const systemFonts = ref([]);
const systemFontsLoading = ref(false);
let systemFontsLoadPromise = null;
const PERFORMANCE_CONFIRM_MESSAGE =
  "开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？";
const fontOptions = computed(() =>
  buildFontOptions({
    systemFonts: systemFonts.value,
    customFont: customFont.value,
    customFontLabel: customFontLabel.value,
  }),
);
const downloadFolder = ref(null);
const downloadCreateSongFolder = ref(false);
const downloadSaveLyricFile = ref(false);
const videoFolder = ref(null);
const localMusicVideos = ref([]);
const musicVideoModeOptions = [
  { label: "歌曲专属视频", value: "song" },
  { label: "本地随机视频池", value: "pool" },
];
if (!["song", "pool"].includes(playerStore.musicVideoMode)) {
  playerStore.musicVideoMode = "song";
}
const availableLocalMusicVideoCount = computed(
  () => localMusicVideos.value.filter((video) => video.available).length,
);
const localFolder = ref([]);
const shortcutsList = ref(null);
const selectedShortcut = ref(null);
const newShortcut = ref([]);
const shortcutCharacter = [
  "=",
  "-",
  "~",
  "@",
  "#",
  "$",
  "[",
  "]",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
];

// 更新相关状态
const showUpdateDialog = ref(false);
const newVersion = ref("");
let updateListenersInitialized = false;
let disposeManualUpdateAvailable = null;

const normalizeSearchAssistLimit = (value) => {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return 8;
  return Math.max(1, num);
};

const loadVipInfo = async () => {
  const requestUserId = userStore.user?.userId;
  if (!requestUserId || !isLogin()) {
    vipInfo.value = null;
    return;
  }

  try {
    const result = await getVipInfo();
    if (userStore.user?.userId != requestUserId) return;
    vipInfo.value = result?.data || null;
  } catch (error) {
    if (userStore.user?.userId != requestUserId) return;
    console.error("加载 VIP 信息失败:", error);
    vipInfo.value = null;
  }
};

const loadListenGradeInfo = async () => {
  const requestUserId = userStore.user?.userId;
  if (!requestUserId || !isLogin()) return;

  listenGradeLoading.value = true;
  try {
    await refreshListenGradeInfo();
  } finally {
    if (userStore.user?.userId == requestUserId) {
      listenGradeLoading.value = false;
    }
  }
};

const loadLoginDevices = async () => {
  const requestUserId = userStore.user?.userId;
  const requestSerial = ++deviceRequestSerial;
  if (!requestUserId || !isLogin()) {
    loginDevices.value = [];
    devicesError.value = "";
    return;
  }

  devicesLoading.value = true;
  devicesError.value = "";
  try {
    const result = await getLoginDevices();
    if (requestSerial !== deviceRequestSerial || userStore.user?.userId != requestUserId) return;
    loginDevices.value = normalizeLoginDevices(result, getKugouApiDeviceIdentity());
  } catch (error) {
    if (requestSerial !== deviceRequestSerial || userStore.user?.userId != requestUserId) return;
    console.error("加载登录设备失败:", error);
    loginDevices.value = [];
    devicesError.value = "设备列表加载失败，请稍后重试";
  } finally {
    if (requestSerial === deviceRequestSerial) devicesLoading.value = false;
  }
};

const isKickDeviceSuccess = (result) => {
  if (Number(result?.status) === 1 || Number(result?.error_code) === 0) return true;
  return /操作成功|退出成功/.test(String(result?.data || result?.message || result?.msg || ""));
};

const kickDevice = async (device) => {
  if (!device?.canKick || kickingDeviceKey.value) return;

  kickingDeviceKey.value = device.key;
  try {
    const result = await kickLoginDevice({
      t_mid: device.mid,
      t: device.loginTime,
      t_appid: device.appid,
      t_clientver: device.clientver,
    });
    if (!isKickDeviceSuccess(result)) {
      throw new Error(result?.msg || result?.message || result?.data || "device-kick-failed");
    }
    noticeOpen("设备已下线", 2);
    await loadLoginDevices();
  } catch (error) {
    console.error("设备下线失败:", error);
    noticeOpen("设备下线失败，请稍后重试", 2);
  } finally {
    kickingDeviceKey.value = "";
  }
};

const confirmKickDevice = (device) => {
  if (!device?.canKick) return;
  dialogOpen(
    "下线设备",
    `确定让“${device.name}”退出登录吗？该设备需要重新登录后才能继续使用。`,
    (confirmed) => {
      if (confirmed) void kickDevice(device);
    },
  );
};

onActivated(() => {
  void refreshLocalMusicVideoPool();
  windowApi.getSettings().then((settings) => {
    if (!settings) return;
    let loadedLevel = playerStore.quality ?? settings.music.level;
    // 兼容 electron 端保存的 lossless 值，映射为前端使用的 flac
    if (loadedLevel === "lossless") loadedLevel = "flac";
    musicLevel.value = loadedLevel;
    lyricSize.value = settings.music.lyricSize;
    tlyricSize.value = settings.music.tlyricSize;
    rlyricSize.value = settings.music.rlyricSize;
    lyricInterlude.value = settings.music.lyricInterlude;
    searchAssistLimit.value = normalizeSearchAssistLimit(
      settings.music.searchAssistLimit,
    );
    coverSize.value = settings.music.coverSize ?? 400;
    autoPlayOnStartup.value = settings?.music?.autoPlayOnStartup === true;
    pauseOnOtherAudio.value =
      settings?.music?.pauseOnOtherAudio === true;
    playerStore.showSongTranslation =
      settings?.music?.showSongTranslation !== false;
    playerStore.audioVisualizer = settings?.music?.audioVisualizer === true;
    playerStore.loudnessNormalization = settings?.music?.loudnessNormalization === true;
    videoFolder.value = settings.local.videoFolder;
    downloadFolder.value = settings.local.downloadFolder;
    downloadCreateSongFolder.value = !!settings.local.downloadCreateSongFolder;
    downloadSaveLyricFile.value = !!settings.local.downloadSaveLyricFile;
    localFolder.value = settings.local.localFolder;
    shortcutsList.value = settings.shortcuts;
    globalShortcuts.value = settings.other.globalShortcuts;
    // 兼容旧配置：未写入过该字段时默认保持开启更新。
    appUpdateEnabled.value = settings?.other?.enableUpdate !== false;
    startupAnimation.value = [
      "exa",
      "corporate",
      "popucom",
      "endfield",
      "ark",
    ].includes(settings?.other?.startupAnimation)
      ? settings.other.startupAnimation
      : "ark";
    quitApp.value = settings.other.quitApp;
    customFont.value = settings?.other?.customFont || "";
    customFontLabel.value = settings?.other?.customFontLabel || "";
  });

  // Initialize theme selection
  try {
    theme.value = getSavedTheme();
  } catch (_) {
    theme.value = "system";
  }

  void loadVipInfo();
  void loadListenGradeInfo();
  void loadLoginDevices();
  void loadSystemFonts();

  // 设置更新事件监听器
  setupUpdateListeners();
});

// 当从“首页/子页”切换到“主播放器界面”（widgetState: true -> false）时，
// 如果当前仍处于设置路由，则自动保存设置（避免未发生路由切换导致 onBeforeRouteLeave 不触发）。
watch(
  () => playerStore.widgetState,
  (now, prev) => {
    try {
      const isLeavingToPlayer = prev === true && now === false;
      const inSettings = router.currentRoute.value?.name === "settings";
      if (isLeavingToPlayer && inSettings) {
        setAppSettings();
        initSettings();
        noticeOpen("设置已保存", 2);
      }
    } catch (_) {
      // ignore
    }
  },
);

// 设置更新监听器
const setupUpdateListeners = () => {
  if (updateListenersInitialized) return;
  updateListenersInitialized = true;
  // 监听手动更新检查结果（不显示大窗弹出）
  disposeManualUpdateAvailable = windowApi.manualUpdateAvailable((version) => {
    newVersion.value = version;
    // 手动检查时直接在UpdateDialog中显示结果，不触发大窗弹出
  });
};

onUnmounted(() => disposeManualUpdateAvailable?.());

watch(
  () => userStore.user?.userId ?? null,
  (nextUserId, previousUserId) => {
    if (nextUserId === previousUserId) return;
    if (!nextUserId) {
      vipInfo.value = null;
      loginDevices.value = [];
      devicesError.value = "";
      deviceRequestSerial += 1;
      return;
    }
    void loadVipInfo();
    void loadListenGradeInfo();
    void loadLoginDevices();
  },
);

const setAppSettings = () => {
  let settings = {
    music: {
      level: musicLevel.value,
      lyricSize: lyricSize.value,
      tlyricSize: tlyricSize.value,
      rlyricSize: rlyricSize.value,
      lyricInterlude: lyricInterlude.value,
      searchAssistLimit: normalizeSearchAssistLimit(searchAssistLimit.value),
      showSongTranslation: playerStore.showSongTranslation,
      coverSize: coverSize.value,
      audioVisualizer: playerStore.audioVisualizer,
      loudnessNormalization: playerStore.loudnessNormalization,
      // 启动恢复上次歌单后是否自动播放。
      autoPlayOnStartup: autoPlayOnStartup.value,
      pauseOnOtherAudio: pauseOnOtherAudio.value,
    },
    local: {
      videoFolder: videoFolder.value,
      downloadFolder: downloadFolder.value,
      downloadCreateSongFolder: downloadCreateSongFolder.value,
      downloadSaveLyricFile: downloadSaveLyricFile.value,
      localFolder: localFolder.value,
    },
    shortcuts: shortcutsList.value,
    other: {
      globalShortcuts: globalShortcuts.value,
      // 关闭后会同时禁用启动自动检查和手动检查更新入口。
      enableUpdate: appUpdateEnabled.value,
      startupAnimation: startupAnimation.value,
      quitApp: quitApp.value,
      customFont: customFont.value,
      customFontLabel: customFont.value ? customFontLabel.value : "",
    },
  };
  playerStore.quality = musicLevel.value;
  windowApi.setSettings(JSON.stringify(settings));
};

const setCustomFont = (font, option = null) => {
  const rawFont = typeof font === "string" ? font : customFont.value;
  const resolvedFont = resolveSystemFontValue(rawFont, systemFonts.value);
  const resolvedLabel = resolvedFont
    ? String(
        resolveSystemFontLabel(
          resolvedFont,
          option?.label || customFontLabel.value || rawFont,
          systemFonts.value,
        ),
      ).trim()
    : "";
  const appliedFont = applyCustomFontStyle(resolvedFont);
  customFont.value = appliedFont;
  customFontLabel.value = appliedFont ? resolvedLabel : "";
};

const loadSystemFonts = async () => {
  if (systemFonts.value.length > 0) return systemFonts.value;
  if (systemFontsLoadPromise) return systemFontsLoadPromise;

  systemFontsLoading.value = true;
  systemFontsLoadPromise = loadSystemFontOptions()
    .then((fonts) => {
      systemFonts.value = Array.isArray(fonts) ? fonts : [];
      if (customFont.value) setCustomFont(customFont.value);
      return systemFonts.value;
    })
    .finally(() => {
      systemFontsLoading.value = false;
      systemFontsLoadPromise = null;
    });

  return systemFontsLoadPromise;
};

// apply theme immediately when user changes
watch(theme, (val) => setTheme(val));

onBeforeRouteLeave(() => {
  setAppSettings();
  initSettings();
  noticeOpen("设置已保存", 2);
});

const routerChange = () => {
  router.back();
};

const openDirectoryPicker = async () => {
  try {
    const openDirectory = windowApi?.openDirectory || windowApi?.openFile;
    if (typeof openDirectory !== "function") {
      noticeOpen("目录选择器不可用", 2);
      return null;
    }
    return await openDirectory();
  } catch (error) {
    console.error("打开目录选择器失败:", error);
    noticeOpen("打开目录选择器失败", 2);
    return null;
  }
};

const selectFolder = (type) => {
  if (type == "download") {
    openDirectoryPicker().then((path) => {
      downloadFolder.value = path;
    });
  } else if (type == "local") {
    openDirectoryPicker().then((path) => {
      if (path && localFolder.value.indexOf(path) == -1)
        localFolder.value.push(path);
    });
  } else if (type == "video") {
    openDirectoryPicker().then((path) => {
      videoFolder.value = path;
    });
  }
};
const deleteLocalFolder = (index) => {
  localFolder.value.splice(index, 1);
};

const formatShortcutName = (name) => {
  return name
    .replaceAll("+", " + ")
    .replace("Up", "↑")
    .replace("Down", "↓")
    .replace("Right", "→")
    .replace("Left", "←")
    .replace("Space", "空格")
    .replace("Numpad", "")
    .replace("num", "")
    .replace("CommandOrControl", "Ctrl")
    .replace("Control", "Ctrl");
};
const changeShortcut = (id, type) => {
  selectedShortcut.value = {
    id: id,
    type: type,
  };
  windowApi.unregisterShortcuts();
};
/**
 * author: yesplaymusic
 */
const updateShortcut = () => {
  let shortcut = [];
  newShortcut.value.map((e) => {
    if (e.keyCode >= 65 && e.keyCode <= 90) {
      shortcut.push(e.code.replace("Key", ""));
    } else if (["Control", "Shift", "Alt"].includes(e.key)) {
      shortcut.push(e.key);
    } else if (e.keyCode >= 48 && e.keyCode <= 57) {
      shortcut.push(e.code.replace("Digit", ""));
    } else if (e.keyCode >= 96 && e.keyCode <= 105) {
      shortcut.push(e.code.replace("Numpad", "num"));
    } else if (e.keyCode >= 112 && e.keyCode <= 123) {
      shortcut.push(e.code);
    } else if (
      ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      shortcut.push(e.code.replace("Arrow", ""));
    } else if (shortcutCharacter.includes(e.key)) {
      shortcut.push(e.key);
    }
  });
  const sortTable = {
    Control: 1,
    Shift: 2,
    Alt: 3,
  };
  shortcut = shortcut.sort((a, b) => {
    if (!sortTable[a] || !sortTable[b]) return 0;
    if (sortTable[a] - sortTable[b] <= -1) {
      return -1;
    } else if (sortTable[a] - sortTable[b] >= 1) {
      return 1;
    } else {
      return 0;
    }
  });
  shortcut = shortcut.join("+");
  return shortcut;
};
const inputShortcut = (k) => {
  if (!selectedShortcut.value) return;
  if (newShortcut.value.find((nk) => nk.keyCode === k.keyCode)) return;
  else newShortcut.value.push(k);
  if (
    (k.keyCode >= 65 && k.keyCode <= 90) ||
    (k.keyCode >= 48 && k.keyCode <= 57) ||
    (k.keyCode >= 96 && k.keyCode <= 105) ||
    (k.keyCode >= 112 && k.keyCode <= 123) ||
    ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(k.key) ||
    shortcutCharacter.includes(k.key)
  ) {
    if (selectedShortcut.value.type)
      shortcutsList.value.find(
        (sc) => sc.id == selectedShortcut.value.id,
      ).globalShortcut = updateShortcut();
    else
      shortcutsList.value.find(
        (sc) => sc.id == selectedShortcut.value.id,
      ).shortcut = updateShortcut();
    newShortcut.value = [];
  }
};
const setDefaultShortcuts = () => {
  shortcutsList.value = [
    {
      id: "play",
      name: "播放/暂停",
      shortcut: "CommandOrControl+P",
      globalShortcut: "CommandOrControl+Alt+P",
    },
    {
      id: "last",
      name: "上一首",
      shortcut: "CommandOrControl+Left",
      globalShortcut: "CommandOrControl+Alt+Left",
    },
    {
      id: "next",
      name: "下一首",
      shortcut: "CommandOrControl+Right",
      globalShortcut: "CommandOrControl+Alt+Right",
    },
    {
      id: "volumeUp",
      name: "增加音量",
      shortcut: "CommandOrControl+Up",
      globalShortcut: "CommandOrControl+Alt+Up",
    },
    {
      id: "volumeDown",
      name: "减少音量",
      shortcut: "CommandOrControl+Down",
      globalShortcut: "CommandOrControl+Alt+Down",
    },
    {
      id: "processForward",
      name: "快进(3s)",
      shortcut: "CommandOrControl+]",
      globalShortcut: "CommandOrControl+Alt+]",
    },
    {
      id: "processBack",
      name: "后退(3s)",
      shortcut: "CommandOrControl+[",
      globalShortcut: "CommandOrControl+Alt+[",
    },
  ];
};
const clearMusicVideo = () => {
  windowApi.clearUnusedVideo().then((result) => {
    if (result == "noSavePath") {
      noticeOpen("请先在设置中设置音乐视频缓存目录", 2);
      return;
    } else if (result) noticeOpen("清除完毕", 3);
    else noticeOpen("删除失败", 3);
  });
};
const applyLocalMusicVideoPoolPayload = (payload) => {
  localMusicVideos.value = Array.isArray(payload?.videos) ? payload.videos : [];
};
const refreshLocalMusicVideoPool = async () => {
  try {
    applyLocalMusicVideoPoolPayload(await windowApi.getMusicVideoPool());
  } catch (error) {
    console.error("读取本地音乐视频池失败:", error);
  }
};
const addLocalMusicVideos = async () => {
  try {
    const result = await windowApi.addMusicVideoPoolFiles();
    applyLocalMusicVideoPoolPayload(result);
    if (result?.canceled) return;

    if (result?.addedCount > 0) {
      playerStore.musicVideoPoolRevision++;
      noticeOpen(`已添加 ${result.addedCount} 个本地视频`, 2);
    } else {
      noticeOpen("没有新增视频，所选文件可能已在视频池中", 2);
    }
  } catch (error) {
    console.error("添加本地音乐视频失败:", error);
    noticeOpen("添加本地视频失败", 2);
  }
};
const removeLocalMusicVideo = async (filePath) => {
  try {
    applyLocalMusicVideoPoolPayload(
      await windowApi.removeMusicVideoPoolFile(filePath),
    );
    playerStore.musicVideoPoolRevision++;
  } catch (error) {
    console.error("移除本地音乐视频失败:", error);
    noticeOpen("移除本地视频失败", 2);
  }
};
const clearLocalMusicVideoPool = async (flag) => {
  if (!flag) return;
  try {
    applyLocalMusicVideoPoolPayload(await windowApi.clearMusicVideoPool());
    playerStore.musicVideoPoolRevision++;
    noticeOpen("本地视频池已清空，原视频文件未被删除", 2);
  } catch (error) {
    console.error("清空本地音乐视频池失败:", error);
    noticeOpen("清空本地视频池失败", 2);
  }
};
const confirmClearLocalMusicVideoPool = () => {
  dialogOpen(
    "确认清空",
    "只会清空视频池关联，不会删除您的本地视频文件，确定继续吗？",
    clearLocalMusicVideoPool,
  );
};
const setMusicVideo = () => {
  if (!playerStore.musicVideo)
    dialogOpen(
      "确定开启",
      "开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？",
      openMusicVideo,
    );
  else openMusicVideo(true);
};
const openMusicVideo = (flag) => {
  if (flag) playerStore.musicVideo = !playerStore.musicVideo;
};
const setLyricBlur = () => {
  if (!playerStore.lyricBlur)
    dialogOpen(
      "确定开启",
      "开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？",
      openLyricBlur,
    );
  else openLyricBlur(true);
};
const openLyricBlur = (flag) => {
  if (flag) playerStore.lyricBlur = !playerStore.lyricBlur;
};

const setCoverBlur = () => {
  if (!playerStore.coverBlur)
    dialogOpen(
      "确定开启",
      "开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？",
      openCoverBlur,
    );
  else openCoverBlur(true);
};
const openCoverBlur = (flag) => {
  if (flag) playerStore.coverBlur = !playerStore.coverBlur;
};
const setDynamicTheme = () => {
  if (!playerStore.dynamicTheme)
    dialogOpen(
      "确定开启",
      "开启后全局背景会根据当前播放歌曲的封面颜色动态变化，确定开启吗？",
      openDynamicTheme,
    );
  else openDynamicTheme(true);
};
const openDynamicTheme = (flag) => {
  if (!flag) return;
  playerStore.dynamicTheme = !playerStore.dynamicTheme;
  if (playerStore.dynamicTheme) playerStore.customThemeColor = "";
};
const clearCustomThemeColor = () => {
  playerStore.customThemeColor = "";
};
const lockCurrentSongColor = async () => {
  const coverUrl = currentCoverUrl.value;
  if (!coverUrl) {
    noticeOpen("当前没有可取色的歌曲封面", 2);
    return;
  }

  lockingCurrentSongColor.value = true;
  try {
    const color = await getDynamicThemeColor(coverUrl);
    if (coverUrl !== currentCoverUrl.value) return;
    if (!color) throw new Error("主题颜色不可用");

    playerStore.dynamicTheme = false;
    playerStore.customThemeColor = color;
    noticeOpen("已固定当前歌曲颜色", 2);
  } catch (_) {
    noticeOpen("当前歌曲颜色获取失败", 2);
  } finally {
    lockingCurrentSongColor.value = false;
  }
};
const setAudioVisualizer = () => {
  if (!playerStore.audioVisualizer)
    dialogOpen("确定开启", PERFORMANCE_CONFIRM_MESSAGE, openAudioVisualizer);
  else openAudioVisualizer(true);
};
const openAudioVisualizer = (flag) => {
  if (flag) playerStore.audioVisualizer = !playerStore.audioVisualizer;
};
const userLogout = () => {
  confirmAccountLogout(router);
};
const confirmLogout = () => {
  confirmAccountLogout(router);
};
const save = () => {
  selectedShortcut.value = null;
  setCustomFont();
  setAppSettings();
  initSettings();
  noticeOpen("设置已保存", 2);
};
const toGithub = () => {
  windowApi.toRegister("https://github.com/Arihara-Satoru/Hydrogen-Music");
};

// 检查更新功能
const checkForUpdates = () => {
  if (!appUpdateEnabled.value) {
    noticeOpen("应用更新已关闭，请先在设置中开启", 2);
    return;
  }
  showUpdateDialog.value = true;
  windowApi.checkForUpdate();
};

// 更新对话框事件处理
const handleUpdateDownload = () => {
  windowApi.downloadUpdate();
};

const handleUpdateInstall = () => {
  windowApi.installUpdate();
};

const handleUpdateCancel = () => {
  windowApi.cancelUpdate();
};

const handleUpdateRetry = () => {
  windowApi.checkForUpdate();
};

const closeUpdateDialog = () => {
  showUpdateDialog.value = false;
};

// ponytail: only known rebuildable localStorage caches live here; add new cache keys/prefixes when a feature persists more cache data.
const CACHE_LOCAL_STORAGE_KEYS = [
  "hydrogen-music-search-history",
  "siren_song_durations",
];
const CACHE_LOCAL_STORAGE_PREFIXES = [
  "hm.fm.recentPlayedQueue:",
  "hm.fm.recentPlayedQueueCleanup:",
];

const isCacheLocalStorageKey = (key) =>
  CACHE_LOCAL_STORAGE_KEYS.includes(key) ||
  CACHE_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

const clearRendererCacheData = async () => {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isCacheLocalStorageKey(key)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (_) {}

  try {
    sessionStorage.clear();
  } catch (_) {}

  try {
    if (window.caches) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch (_) {}

  window.dispatchEvent(
    new CustomEvent("fmClearRecent", {
      detail: { userId: userStore?.user?.userId || "guest" },
    }),
  );
  window.dispatchEvent(new CustomEvent("cacheDataCleared"));
};

const clearAllCacheData = async (flag) => {
  if (!flag) return;

  try {
    const result = await windowApi.clearAllCacheData();
    if (!result?.success) {
      noticeOpen("清除缓存失败", 2);
      return;
    }

    await clearRendererCacheData();
    localMusicVideos.value = [];
    playerStore.musicVideoPoolRevision++;
    const deletedVideoCount = Number(result.deletedMusicVideoFiles || 0);
    noticeOpen(
      deletedVideoCount > 0
        ? `缓存已清除，已删除 ${deletedVideoCount} 个视频缓存文件`
        : "缓存已清除",
      3,
    );
  } catch (error) {
    console.error("清除缓存失败:", error);
    noticeOpen("清除缓存失败", 2);
  }
};

const confirmClearAllCacheData = () => {
  dialogOpen(
    "确认清除缓存",
    "将清除搜索历史、本地扫描缓存、播放恢复、音乐视频缓存等可重建数据，确定继续吗？",
    clearAllCacheData,
  );
};

// 清空当前账号的“私人漫游”近期去重队列
const getFmRecentKey = () => {
  return getFmRecentCacheKey(userStore?.user?.userId);
};
const toggleFmCacheAutoClear = () => {
  userStore.autoClearFmCacheEvery3Days = !userStore.autoClearFmCacheEvery3Days;
  if (userStore.autoClearFmCacheEvery3Days) {
    markFmRecentCacheCleaned(localStorage, userStore?.user?.userId);
  }
};
const clearFmRecent = () => {
  try {
    localStorage.removeItem(getFmRecentKey());
    markFmRecentCacheCleaned(localStorage, userStore?.user?.userId);
    // 通知个人FM组件刷新其内存中的近期队列
    window.dispatchEvent(
      new CustomEvent("fmClearRecent", {
        detail: { userId: userStore?.user?.userId || "guest" },
      }),
    );
    noticeOpen("已清空当前账号的私人漫游缓存", 2);
  } catch (e) {
    console.error("清空私人漫游缓存失败:", e);
    noticeOpen("清空失败", 2);
  }
};
</script>

<template>
  <div class="settings-page" @click="selectedShortcut = null">
    <div class="view-control">
      <svg
        t="1669039513804"
        @click="routerChange()"
        class="router-last"
        viewBox="0 0 1024 1024"
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        p-id="1053"
        width="200"
        height="200"
      >
        <path
          d="M716.608 1010.112L218.88 512.384 717.376 13.888l45.248 45.248-453.248 453.248 452.48 452.48z"
          p-id="1054"
        ></path>
      </svg>
      <span class="setting-title">
        设置(离开页面以保存设置或
        <span class="save" @click="save()">点击</span>
        保存)
      </span>
    </div>
    <div class="settings-container">
      <h1 class="settings-title">设置</h1>
      <div
        class="settings-user-info"
        v-if="isLogin()"
        :style="
          profileAvatarUrl
            ? {
                backgroundImage: `linear-gradient(var(--settings-profile-overlay), var(--settings-profile-overlay)), url(${currentUser.backgroundUrl || profileAvatarUrl})`,
              }
            : {}
        "
      >
        <div class="user-top">
          <div class="user">
            <div class="user-head">
              <img :src="profileAvatarUrl + '?param=300y300'" alt="" />
            </div>
            <div class="user-info">
              <div class="user-name">{{ currentUser.nickname }}</div>
              <div class="user-alias" v-if="profileAliases.length">
                {{ profileAliases.join(" / ") }}
              </div>
              <div class="user-signature">
                {{
                  currentUser.description ||
                  currentUser.signature ||
                  "这个用户很懒，什么都没有留下。"
                }}
              </div>
              <div class="user-vip" v-if="vipInfo && currentUser.vipType != 0">
                <img :src="vipInfo.redVipDynamicIconUrl" alt="" />
              </div>
            </div>
          </div>
          <div class="logout" @click="userLogout()">
            <span>退出</span>
          </div>
        </div>
        <div class="profile-details">
          <div
            class="profile-item"
            v-for="item in profileDetailList"
            :key="item.label"
          >
            <span class="profile-label">{{ item.label }}</span>
            <span class="profile-value">{{ item.value }}</span>
          </div>
        </div>
      </div>
      <section
        class="settings-device-management"
        v-if="isLogin()"
        aria-labelledby="device-management-title"
      >
        <div class="device-management-header">
          <div>
            <h2 id="device-management-title">设备管理</h2>
            <p>查看当前账号的登录设备，并让不再使用的设备退出登录。</p>
          </div>
          <button
            class="device-refresh"
            type="button"
            :disabled="devicesLoading"
            @click="loadLoginDevices"
          >
            {{ devicesLoading ? "刷新中…" : "刷新" }}
          </button>
        </div>
        <div class="device-status" v-if="devicesLoading && loginDevices.length === 0" aria-live="polite">
          正在读取登录设备…
        </div>
        <div class="device-status device-error" v-else-if="devicesError" role="status">
          {{ devicesError }}
        </div>
        <div class="device-status" v-else-if="loginDevices.length === 0">
          暂无可显示的登录设备
        </div>
        <div class="device-list" v-else>
          <article class="device-card" v-for="device in loginDevices" :key="device.key">
            <div class="device-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <rect x="5" y="2.5" width="14" height="19" rx="2.2" />
                <line x1="9" y1="5.5" x2="15" y2="5.5" />
                <circle cx="12" cy="18.5" r="0.8" />
              </svg>
            </div>
            <div class="device-copy">
              <div class="device-title-line">
                <h3>{{ device.name }}</h3>
                <span class="current-device" v-if="device.isCurrent">当前设备</span>
              </div>
              <p>{{ device.platformName }}<span v-if="device.clientver"> · V{{ device.clientver }}</span></p>
              <p v-if="device.location">{{ device.location }}</p>
              <p v-if="device.loginTimeText">登录于 {{ device.loginTimeText }}</p>
            </div>
            <button
              class="device-kick"
              type="button"
              :disabled="!device.canKick || !!kickingDeviceKey"
              :title="device.isCurrent ? '当前设备不能从这里下线' : !device.canKick ? '设备信息不完整，无法下线' : '让此设备退出登录'"
              @click="confirmKickDevice(device)"
            >
              {{ kickingDeviceKey === device.key ? "下线中…" : device.isCurrent ? "本机" : "下线" }}
            </button>
          </article>
        </div>
      </section>
      <div class="settings">
        <div class="settings-item">
          <h2 class="item-title">音乐</h2>
          <div class="line"></div>
          <div class="item-options">
            <div class="option">
              <div class="option-name">音质选择</div>
              <div class="option-operation">
                <Selector
                  v-model="musicLevel"
                  :options="musicLevelOptions"
                  :maxItems="4"
                ></Selector>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启背景封面模糊</div>
              <div class="option-operation">
                <div class="toggle" @click="setCoverBlur()">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.coverBlur }"
                  >
                    {{ playerStore.coverBlur ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="playerStore.coverBlur"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启全局动态取色</div>
              <div class="option-operation">
                <div class="toggle" @click="setDynamicTheme()">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.dynamicTheme }"
                  >
                    {{ playerStore.dynamicTheme ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="playerStore.dynamicTheme"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">自定义全局颜色</div>
              <div class="option-operation">
                <div class="theme-color-control">
                  <input
                    v-model="customThemeColor"
                    type="color"
                    aria-label="自定义全局颜色"
                    title="自定义全局颜色"
                  />
                  <button
                    class="theme-color-action theme-color-lock"
                    type="button"
                    :disabled="lockingCurrentSongColor"
                    @click="lockCurrentSongColor"
                  >
                    {{ lockingCurrentSongColor ? "正在固定" : "当前歌曲颜色" }}
                  </button>
                  <button
                    class="theme-color-action"
                    type="button"
                    @click="clearCustomThemeColor"
                  >
                    恢复默认
                  </button>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启歌词模糊</div>
              <div class="option-operation">
                <div class="toggle" @click="setLyricBlur()">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.lyricBlur }"
                  >
                    {{ playerStore.lyricBlur ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="playerStore.lyricBlur"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">显示歌曲翻译</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="
                    playerStore.showSongTranslation =
                      !playerStore.showSongTranslation
                  "
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.showSongTranslation }"
                  >
                    {{ playerStore.showSongTranslation ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="playerStore.showSongTranslation"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">图片大小</div>
              <div class="option-operation">
                <Selector
                  v-model="coverSize"
                  :options="coverSizeOptions"
                ></Selector>
              </div>
            </div>
            <div class="option">
              <div class="option-name">音乐可视化</div>
              <div class="option-operation">
                <div class="toggle" @click="setAudioVisualizer()">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.audioVisualizer }"
                  >
                    {{ playerStore.audioVisualizer ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="playerStore.audioVisualizer"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">响度均衡（实验性）</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="playerStore.loudnessNormalization = !playerStore.loudnessNormalization"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.loudnessNormalization }"
                  >
                    {{ playerStore.loudnessNormalization ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="playerStore.loudnessNormalization"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">启动后自动播放音乐</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="autoPlayOnStartup = !autoPlayOnStartup"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': autoPlayOnStartup }"
                  >
                    {{ autoPlayOnStartup ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="autoPlayOnStartup"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option" v-if="isWindows">
              <div class="option-name">其他应用发声时暂停</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  role="switch"
                  tabindex="0"
                  :aria-checked="pauseOnOtherAudio"
                  aria-label="其他应用发声时暂停"
                  @click="pauseOnOtherAudio = !pauseOnOtherAudio"
                  @keydown.enter.prevent="
                    pauseOnOtherAudio = !pauseOnOtherAudio
                  "
                  @keydown.space.prevent="
                    pauseOnOtherAudio = !pauseOnOtherAudio
                  "
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': pauseOnOtherAudio }"
                  >
                    {{ pauseOnOtherAudio ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="pauseOnOtherAudio"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">搜索下拉条目数量</div>
              <div class="option-operation">
                <input v-model="searchAssistLimit" name="searchAssistLimit" />
              </div>
            </div>
            <div class="option">
              <div class="option-name">歌词字体大小</div>
              <div class="option-operation">
                <input v-model="lyricSize" name="lyricSize" />
              </div>
            </div>
            <div class="option">
              <div class="option-name">歌词翻译字体大小</div>
              <div class="option-operation">
                <input v-model="tlyricSize" name="tlyricSize" />
              </div>
            </div>
            <div class="option">
              <div class="option-name">罗马歌词字体大小</div>
              <div class="option-operation">
                <input v-model="rlyricSize" name="rlyricSize" />
              </div>
            </div>
            <div class="option">
              <div class="option-name">歌词间奏等待时间(单位：秒)</div>
              <div class="option-operation">
                <input v-model="lyricInterlude" name="lyricInterlude" />
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启音乐视频功能</div>
              <div class="option-operation">
                <div class="toggle" @click="setMusicVideo()">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': playerStore.musicVideo }"
                  >
                    {{ playerStore.musicVideo ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="playerStore.musicVideo"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option" v-if="playerStore.musicVideo">
              <div class="option-name">音乐视频来源</div>
              <Selector
                v-model="playerStore.musicVideoMode"
                :options="musicVideoModeOptions"
              ></Selector>
            </div>
            <div
              class="option"
              v-if="
                playerStore.musicVideo && playerStore.musicVideoMode === 'song'
              "
            >
              <div class="option-name">删除所有未被使用的音乐视频</div>
              <div class="option-operation">
                <div class="button" @click="clearMusicVideo()">清除</div>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-item">
          <h2 class="item-title">本地</h2>
          <div class="line"></div>
          <div class="item-options">
            <div
              class="option music-video-pool-option"
              v-if="
                playerStore.musicVideo && playerStore.musicVideoMode === 'pool'
              "
            >
              <div class="option-name">本地随机视频池</div>
              <div class="music-video-pool-control">
                <div class="music-video-pool-head">
                  <span>
                    已选择 {{ localMusicVideos.length }} 个，
                    {{ availableLocalMusicVideoCount }} 个可用
                  </span>
                  <div class="music-video-pool-actions">
                    <button type="button" @click="addLocalMusicVideos">
                      添加视频
                    </button>
                    <button
                      type="button"
                      :disabled="localMusicVideos.length === 0"
                      @click="confirmClearLocalMusicVideoPool"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div class="music-video-pool-list" v-if="localMusicVideos.length">
                  <div
                    class="music-video-pool-item"
                    v-for="video in localMusicVideos"
                    :key="video.path"
                    :class="{ 'is-missing': !video.available }"
                  >
                    <span class="music-video-pool-name" :title="video.path">
                      {{ video.name }}
                    </span>
                    <span class="music-video-pool-status" v-if="!video.available">
                      文件不可用
                    </span>
                    <button
                      type="button"
                      :aria-label="`移除 ${video.name}`"
                      @click="removeLocalMusicVideo(video.path)"
                    >
                      移除
                    </button>
                  </div>
                </div>
                <div class="music-video-pool-tip">
                  支持 MP4、M4V、WebM 和 MOV；切歌时随机选择，原文件不会被复制或删除。
                </div>
              </div>
            </div>
            <div
              class="option"
              v-if="
                playerStore.musicVideo && playerStore.musicVideoMode === 'song'
              "
            >
              <div class="option-name">音乐视频缓存</div>
              <div class="select-download-folder">
                <div class="selected-folder" :title="videoFolder">
                  {{ videoFolder ? videoFolder : "待选择" }}
                </div>
                <div class="select-option" @click="selectFolder('video')">
                  选择
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">下载目录</div>
              <div class="select-download-folder">
                <div class="selected-folder" :title="downloadFolder">
                  {{ downloadFolder ? downloadFolder : "待选择" }}
                </div>
                <div class="select-option" @click="selectFolder('download')">
                  选择
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">下载歌曲时创建独立文件夹</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="downloadCreateSongFolder = !downloadCreateSongFolder"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': downloadCreateSongFolder }"
                  >
                    {{ downloadCreateSongFolder ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="downloadCreateSongFolder"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">下载歌曲时创建独立歌词文件</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="downloadSaveLyricFile = !downloadSaveLyricFile"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': downloadSaveLyricFile }"
                  >
                    {{ downloadSaveLyricFile ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="downloadSaveLyricFile"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">本地目录</div>
              <div class="local-folder">
                <div class="selected-local-folder-item">
                  <div
                    class="selected-folder"
                    :title="item"
                    @contextmenu="deleteLocalFolder(index)"
                    v-for="(item, index) in localFolder"
                  >
                    {{ item ? item : "请添加" }}
                  </div>
                  <div class="tip">
                    您可以同时添加多个目录,右键移除您不需要的目录。数据量过大时需要一定扫描时间,请稍等。
                  </div>
                </div>
                <div class="add-option" @click="selectFolder('local')">
                  添加
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-item">
          <h2 class="item-title">快捷键</h2>
          <div class="line"></div>
          <div
            class="item-options"
            tabindex="0"
            @keydown="inputShortcut($event)"
          >
            <div class="option">
              <div class="option-name">开启全局快捷键</div>
              <div class="option-operation">
                <div class="toggle" @click="globalShortcuts = !globalShortcuts">
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': globalShortcuts }"
                  >
                    {{ globalShortcuts ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="globalShortcuts"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="shortcuts-title">
              <div class="title-function">功能说明</div>
              <div class="title-shortcuts">快捷键</div>
              <div
                class="title-globalShortcuts"
                :class="{ 'forbid-shortcuts': !globalShortcuts }"
              >
                全局快捷键
              </div>
            </div>
            <div class="shortcuts" v-for="(item, index) in shortcutsList">
              <div class="shortcut-name">{{ item.name }}</div>
              <div
                class="shortcut"
                :class="{
                  'shortcut-selected':
                    selectedShortcut &&
                    selectedShortcut.id == item.id &&
                    !selectedShortcut.type,
                }"
                @click.stop="changeShortcut(item.id, false)"
              >
                {{ formatShortcutName(item.shortcut) }}
              </div>
              <div
                class="globalShortcut"
                :class="{
                  'shortcut-selected':
                    selectedShortcut &&
                    selectedShortcut.id == item.id &&
                    selectedShortcut.type,
                  'forbid-shortcuts': !globalShortcuts,
                }"
                @click.stop="changeShortcut(item.id, true)"
              >
                {{ formatShortcutName(item.globalShortcut) }}
              </div>
            </div>
            <div class="default-shortcuts" @click="setDefaultShortcuts()">
              恢复默认快捷键
            </div>
          </div>
        </div>
        <div class="settings-item">
          <h2 class="item-title">其他</h2>
          <div class="line"></div>
          <div class="item-options">
            <div class="option">
              <div class="option-name">主题</div>
              <div class="option-operation">
                <Selector v-model="theme" :options="themeOptions"></Selector>
              </div>
            </div>
            <div class="option">
              <div class="option-name">自定义字体</div>
              <div class="option-operation">
                <FontSelector
                  v-model="customFont"
                  :options="fontOptions"
                  :max-items="8"
                  @update:modelValue="setCustomFont"
                ></FontSelector>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启首页页面</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="userStore.homePage = !userStore.homePage"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': userStore.homePage }"
                  >
                    {{ userStore.homePage ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="userStore.homePage"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启云盘页面</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="userStore.cloudDiskPage = !userStore.cloudDiskPage"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': userStore.cloudDiskPage }"
                  >
                    {{ userStore.cloudDiskPage ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="userStore.cloudDiskPage"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启私人漫游页面</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="userStore.personalFMPage = !userStore.personalFMPage"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': userStore.personalFMPage }"
                  >
                    {{ userStore.personalFMPage ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="userStore.personalFMPage"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启塞壬唱片页面</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="userStore.sirenPage = !userStore.sirenPage"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': userStore.sirenPage }"
                  >
                    {{ userStore.sirenPage ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="userStore.sirenPage"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option" v-if="userStore.personalFMPage">
              <div class="option-name">每 3 天自动清理漫游缓存</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="toggleFmCacheAutoClear"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': userStore.autoClearFmCacheEvery3Days }"
                  >
                    {{ userStore.autoClearFmCacheEvery3Days ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div
                      class="toggle-on"
                      v-show="userStore.autoClearFmCacheEvery3Days"
                    ></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option" v-if="userStore.personalFMPage">
              <div class="option-name">清空漫游缓存</div>
              <div class="option-operation">
                <div class="button" @click="clearFmRecent">清空</div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">清除所有缓存数据</div>
              <div class="option-operation">
                <div class="button" @click="confirmClearAllCacheData">清除</div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">开启应用更新</div>
              <div class="option-operation">
                <div
                  class="toggle"
                  @click="appUpdateEnabled = !appUpdateEnabled"
                >
                  <div
                    class="toggle-off"
                    :class="{ 'toggle-on-in': appUpdateEnabled }"
                  >
                    {{ appUpdateEnabled ? "已开启" : "已关闭" }}
                  </div>
                  <Transition name="toggle">
                    <div class="toggle-on" v-show="appUpdateEnabled"></div>
                  </Transition>
                </div>
              </div>
            </div>
            <div class="option">
              <div class="option-name">启动动画（下次启动生效）</div>
              <div class="option-operation">
                <Selector
                  v-model="startupAnimation"
                  :options="startupAnimationOptions"
                ></Selector>
              </div>
            </div>
            <div class="option">
              <div class="option-name">退出应用时</div>
              <div class="option-operation">
                <Selector
                  v-model="quitApp"
                  :options="quitAppOptions"
                ></Selector>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="app-version">
        <div class="app-icon">
          <img src="../assets/icon/icon.ico" alt="" />
        </div>
        <div class="version">V{{ version }}</div>
        <div class="update-check">
          <button class="check-update-btn" @click="checkForUpdates">
            检查更新
          </button>
        </div>
        <div class="app-author" @click="toGithub()">
          Made by {{ author.name }} | Modified from Hydrogen Music
        </div>
      </div>
    </div>

    <!-- 更新对话框 -->
    <UpdateDialog
      :visible="showUpdateDialog"
      :new-version="newVersion"
      @close="closeUpdateDialog"
      @download="handleUpdateDownload"
      @install="handleUpdateInstall"
      @cancel="handleUpdateCancel"
      @retry="handleUpdateRetry"
    />
  </div>
</template>

<style scoped lang="scss">
.settings-page {
  width: 100%;
  height: 100%;
  .view-control {
    margin-bottom: 15px;
    margin-left: -8px;
    height: 32px;
    display: flex;
    flex-direction: row;
    align-items: center;
    svg {
      padding: 8px;
      width: 32px;
      height: 32px;
      float: left;
      transition: 0.2s;
      &:hover {
        cursor: pointer;
        opacity: 0.7;
      }
      &:active {
        transform: scale(0.9);
      }
    }
    .router-last {
      margin-right: 5px;
    }
    .setting-title {
      font: 17px SourceHanSansCN-Bold;
      color: black;
      .save {
        font-size: 15px;
        padding: 6px;
        background-color: rgba(255, 255, 255, 0.35);
        transition: 0.1s;
        &:hover {
          cursor: pointer;
          opacity: 0.8;
        }
        &:active {
          opacity: 0.5;
        }
      }
    }
  }
  .settings-container {
    margin: 0 auto;
    padding-bottom: 140px;
    width: 80%;
    height: calc(100% - 47px);
    overflow: auto;
    &::-webkit-scrollbar {
      display: none;
    }
    .settings-title {
      font-family: SourceHanSansCN-Bold;
      color: black;
      text-align: left;
    }
    .settings-user-info {
      padding: 20px 40px;
      width: 100%;
      min-height: 220px;
      background-color: rgba(255, 255, 255, 0.42);
      background-repeat: no-repeat;
      background-position: center;
      background-size: cover;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(0, 0, 0, 0.05);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.06);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      .user-top {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
      }
      .user {
        min-width: 0;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 15px;
        .user-head {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          overflow: hidden;
          img {
            width: 100%;
            height: 100%;
          }
        }
        .user-info {
          min-width: 0;
          .user-name {
            font: 20px Source Han Sans;
            font-weight: bold;
            color: black;
          }
          .user-alias {
            margin-top: 4px;
            font: 12px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.72);
          }
          .user-signature {
            margin-top: 6px;
            max-width: 520px;
            font: 13px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.62);
            line-height: 1.5;
            word-break: break-word;
          }
          .user-vip {
            margin-top: 8px;
            width: 40px;
            img {
              width: 100%;
            }
          }
        }
      }
      .profile-details {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px 18px;
        .profile-item {
          padding: 10px 12px;
          min-height: 60px;
          background-color: var(--layer);
          border: 1px solid rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          .profile-label {
            font: 12px SourceHanSansCN-Bold;
            color: rgba(0, 0, 0, 0.55);
          }
          .profile-value {
            font: 14px SourceHanSansCN-Bold;
            color: black;
            word-break: break-word;
          }
        }
      }
      .logout {
        font: 14px SourceHanSansCN-Bold;
        font-weight: bold;
        color: black;
        transition: 0.2s;
        &:hover {
          cursor: pointer;
        }
        &:active {
          transform: scale(0.95);
        }
      }
    }
    .settings-device-management {
      margin-top: 28px;
      padding: 22px 24px;
      width: 100%;
      background: var(--layer);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      .device-management-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        h2 {
          margin: 0;
          font: 20px SourceHanSansCN-Bold;
          color: var(--text);
        }
        p {
          margin: 6px 0 0;
          font: 13px SourceHanSansCN-Bold;
          line-height: 1.55;
          color: var(--muted-text);
        }
      }
      button {
        min-height: 44px;
        border: 1px solid var(--border);
        background: transparent;
        color: var(--text);
        font: 13px SourceHanSansCN-Bold;
        cursor: pointer;
        transition: 0.2s;
        &:hover:not(:disabled) {
          background: var(--layer);
          border-color: var(--text);
        }
        &:focus-visible {
          outline: 2px solid var(--text);
          outline-offset: 2px;
        }
        &:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
      }
      .device-refresh {
        min-width: 76px;
        padding: 0 16px;
        flex: 0 0 auto;
      }
      .device-status {
        margin-top: 18px;
        padding: 18px;
        border: 1px dashed var(--border);
        font: 13px SourceHanSansCN-Bold;
        color: var(--muted-text);
        text-align: center;
      }
      .device-error {
        color: #a03232;
      }
      .device-list {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
      }
      .device-card {
        padding: 14px;
        min-width: 0;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--layer) 72%, transparent);
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        .device-icon {
          width: 44px;
          height: 44px;
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          svg {
            width: 24px;
            height: 24px;
            fill: none;
            stroke: var(--text);
            stroke-width: 1.4;
            stroke-linecap: round;
          }
        }
        .device-copy {
          min-width: 0;
        }
        .device-title-line {
          display: flex;
          align-items: center;
          gap: 8px;
          h3 {
            margin: 0;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font: 15px SourceHanSansCN-Bold;
            color: var(--text);
          }
        }
        .current-device {
          padding: 2px 6px;
          flex: 0 0 auto;
          border: 1px solid var(--border);
          font: 10px SourceHanSansCN-Bold;
          color: var(--muted-text);
        }
        p {
          margin: 3px 0 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font: 11px SourceHanSansCN-Bold;
          color: var(--muted-text);
        }
        .device-kick {
          min-width: 64px;
          padding: 0 12px;
        }
      }
    }
    .settings {
      width: 100%;
      .settings-item {
        margin-top: 45px;
        width: 100%;
        .item-title {
          margin: 0;
          font: 20px SourceHanSansCN-Bold;
          color: black;
          font-family: SourceHanSansCN-Bold;
          color: black;
          text-align: left;
        }
        .line {
          margin-top: 8px;
          margin-bottom: 25px;
          width: 100%;
          height: 0.5px;
          background-color: rgba(0, 0, 0, 0.2);
        }
        .item-options {
          outline: none;
          .option {
            margin-bottom: 32px;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            .option-name {
              font-family: SourceHanSansCN-Bold;
              font-size: 16px;
              color: black;
              text-align: left;
            }
            input,
            .selector {
              margin-right: 1px;
              width: 200px;
              height: 34px;
              padding: 5px 1px;
              background-color: transparent;
              color: black;
              border: none;
              outline: none;
              appearance: none;
              font: 13px SourceHanSansCN-Bold;
              text-align: center;
              transition: 0.2s;
              &:hover {
                cursor: pointer;
                opacity: 0.8;
                box-shadow: none;
              }
            }
            select {
              padding: 8px 10px;
            }
            option {
              background-color: rgba(255, 255, 255, 0.35);
              border: none;
              outline: none;
            }
            .toggle {
              margin-right: 1px;
              height: 34px;
              width: 200px;
              position: relative;
              overflow: hidden;
              &:hover {
                cursor: pointer;
              }
              &:focus-visible {
                outline: 2px solid black;
                outline-offset: 2px;
              }
              .toggle-on,
              .toggle-off {
                padding: 5px 10px;
                width: 100%;
                height: 100%;
                font: 13px SourceHanSansCN-Bold;
                transition: 0.2s;
                line-height: 24px;
              }
              .toggle-off {
                background-color: rgba(255, 255, 255, 0.35);
              }
              .toggle-on {
                background-color: black;
                position: absolute;
                top: 0;
                left: 0;
                z-index: -1;
              }
              .toggle-on-in {
                color: white;
                background-color: transparent;
              }
            }
            .button {
              margin-right: 1px;
              padding: 5px 10px;
              width: 200px;
              background-color: rgba(255, 255, 255, 0.35);
              font: 13px SourceHanSansCN-Bold;
              &:hover {
                cursor: pointer;
                opacity: 0.8;
                box-shadow: 0 0 0 1px black;
              }
            }
            &.music-video-pool-option {
              align-items: flex-start;
            }
            .music-video-pool-control {
              width: 50vw;
              display: flex;
              flex-direction: column;
              gap: 10px;
              font: 12px SourceHanSansCN-Bold;
              color: black;
              .music-video-pool-head,
              .music-video-pool-item,
              .music-video-pool-actions {
                display: flex;
                align-items: center;
              }
              .music-video-pool-head {
                min-height: 34px;
                padding-left: 10px;
                justify-content: space-between;
                background-color: rgba(255, 255, 255, 0.35);
              }
              .music-video-pool-actions {
                gap: 8px;
                padding-right: 8px;
              }
              button {
                min-width: 58px;
                height: 26px;
                padding: 0 10px;
                border: 0;
                border-radius: 0;
                background-color: rgba(255, 255, 255, 0.55);
                color: black;
                font: 12px SourceHanSansCN-Bold;
                cursor: pointer;
                &:hover:not(:disabled),
                &:focus-visible {
                  box-shadow: 0 0 0 1px black;
                  outline: none;
                }
                &:disabled {
                  cursor: default;
                  opacity: 0.45;
                }
              }
              .music-video-pool-list {
                max-height: 180px;
                overflow-y: auto;
              }
              .music-video-pool-item {
                min-height: 32px;
                padding: 3px 8px 3px 10px;
                gap: 10px;
                background-color: rgba(255, 255, 255, 0.22);
                border-bottom: 1px solid rgba(0, 0, 0, 0.08);
                &.is-missing {
                  opacity: 0.62;
                }
              }
              .music-video-pool-name {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                text-align: left;
              }
              .music-video-pool-status {
                color: #8a1f1f;
                white-space: nowrap;
              }
              .music-video-pool-tip {
                font-size: 10px;
                text-align: left;
                opacity: 0.68;
              }
            }
            .theme-color-control {
              width: 224px;
              height: 34px;
              display: grid;
              grid-template-columns: 34px 1fr auto;
              align-items: center;
              background-color: rgba(255, 255, 255, 0.35);
              font: 13px SourceHanSansCN-Bold;
              .theme-color-action {
                height: 34px;
                padding: 0 12px;
                border: none;
                border-left: 1px solid var(--border);
                border-radius: 0;
                background-color: transparent;
                color: black;
                font: inherit;
                cursor: pointer;
                white-space: nowrap;
                transition: 0.2s;
                &:hover:not(:disabled) {
                  background-color: rgba(255, 255, 255, 0.14);
                }
                &:focus-visible {
                  outline: none;
                  box-shadow: inset 0 0 0 1px var(--text);
                }
                &:disabled {
                  cursor: wait;
                  opacity: 0.5;
                }
              }
              input[type="color"] {
                margin: 0;
                padding: 0;
                width: 34px;
                height: 34px;
                border: none;
                border-radius: 0;
                background-color: transparent;
                appearance: none;
                &::-webkit-color-swatch-wrapper {
                  padding: 6px;
                }
                &::-webkit-color-swatch {
                  border: 1px solid var(--border);
                  border-radius: 50%;
                }
              }
            }
            .select-download-folder {
              display: flex;
              flex-direction: row;
              align-items: center;
              .selected-folder {
                width: 50vw;
                height: 30px;
                background-color: rgba(255, 255, 255, 0.35);
                font: 13px SourceHanSansCN-Bold;
                color: black;
                line-height: 30px;
                overflow: hidden;
              }
              .select-option {
                margin-right: 2px;
                margin-left: 15px;
                padding: 5px 15px;
                font: 13px SourceHanSansCN-Bold;
                color: black;
                background-color: rgba(255, 255, 255, 0.35);
                transition: 0.2s;
                &:hover {
                  cursor: pointer;
                  opacity: 0.8;
                  box-shadow: 0 0 0 1px black;
                }
              }
            }
            .local-folder {
              display: flex;
              flex-direction: row;
              align-items: center;
              .selected-local-folder-item {
                display: flex;
                flex-direction: column;
                .selected-folder {
                  margin-bottom: 10px;
                  width: 50vw;
                  height: 30px;
                  background-color: rgba(255, 255, 255, 0.35);
                  font: 13px SourceHanSansCN-Bold;
                  color: black;
                  line-height: 30px;
                  overflow: hidden;
                }
                .tip {
                  font: 10px SourceHanSansCN-Bold;
                  color: black;
                  text-align: left;
                }
              }
              .add-option {
                margin-right: 2px;
                margin-left: 15px;
                padding: 5px 15px;
                font: 13px SourceHanSansCN-Bold;
                color: black;
                background-color: rgba(255, 255, 255, 0.35);
                transition: 0.2s;
                &:hover {
                  cursor: pointer;
                  opacity: 0.8;
                  box-shadow: 0 0 0 1px black;
                }
              }
            }
          }
          .forbid-shortcuts {
            opacity: 0.5;
            pointer-events: none;
          }
          .shortcuts-title {
            font: 14px SourceHanSansCN-Bold;
            color: black;
            display: flex;
            flex-direction: row;
            align-items: center;
            text-align: left;
            div {
              margin-right: 15px;
              padding: 0 6px;
            }
            .title-function {
              min-width: 130px;
            }
            .title-shortcuts,
            .title-globalShortcuts {
              min-width: 200px;
            }
          }
          .shortcuts {
            font: 14px SourceHanSansCN-Bold;
            color: black;
            display: flex;
            flex-direction: row;
            display: flex;
            flex-direction: row;
            align-items: center;
            text-align: left;
            div {
              margin-top: 15px;
              margin-right: 15px;
              padding: 6px;
              background-color: rgba(255, 255, 255, 0.35);
            }
            .shortcut-name {
              min-width: 130px;
              background-color: transparent;
            }
            .shortcut,
            .globalShortcut {
              min-width: 200px;
              &:hover {
                cursor: pointer;
              }
            }
            .shortcut-selected {
              box-shadow: 0 0 0 1px black;
            }
          }
          .default-shortcuts {
            margin-top: 15px;
            margin-left: 1px;
            width: 120px;
            padding: 6px;
            background-color: rgba(255, 255, 255, 0.35);
            font: 14px SourceHanSansCN-Bold;
            transition: 0.2s;
            color: black;
            &:hover {
              cursor: pointer;
              box-shadow: 0 0 0 1px black;
            }
          }
        }
      }
    }
    .app-version {
      display: flex;
      flex-direction: column;
      align-items: center;
      .app-icon {
        margin-bottom: 10px;
        width: 65px;
        height: 65px;
        img {
          width: 100%;
          height: 100%;
        }
      }
      .version {
        font: 14px Geometos;
        color: black;
      }
      .update-check {
        margin: 8px 0;

        .check-update-btn {
          padding: 5px 15px;
          background-color: rgba(255, 255, 255, 0.35);
          color: black;
          border: none;
          border-radius: 0;
          outline: none;
          font: 13px SourceHanSansCN-Bold;
          cursor: pointer;
          transition: 0.2s;

          &:hover {
            opacity: 0.8;
            box-shadow: 0 0 0 1px black;
          }

          &:focus {
            outline: none;
            border-radius: 0;
            box-shadow: 0 0 0 1px black;
          }

          &:active {
            outline: none;
            border-radius: 0;
            box-shadow: 0 0 0 1px black;
          }
        }
      }
      .app-author {
        margin-top: 10px;
        font: 14px Bender-Bold;
        color: black;
        &:hover {
          cursor: pointer;
          text-decoration: underline;
        }
      }
    }
  }
}
.toggle-enter-active,
.toggle-leave-active {
  transition: 0.1s;
}
.toggle-enter-from,
.toggle-leave-to {
  transform: translateX(-100%);
}
</style>
