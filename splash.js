const SPLASH_PHASES = Object.freeze([
  { threshold: 0, label: "准备", telemetry: "LOADING CORE KERNEL & SOUND DRIVERS..." },
  { threshold: 30, label: "数据", telemetry: "SCANNING LOCAL ARCHIVE & CACHED TRACKS..." },
  { threshold: 52, label: "服务", telemetry: "CONNECTING MONSTER SIREN AUDIO PIPELINE..." },
  { threshold: 80, label: "界面", telemetry: "COMPOSING STAGE LAYOUT & GRAPHICS ACCELERATION..." },
  { threshold: 100, label: "就绪", telemetry: "AUDIO ENGINE READY // LAUNCHING MAIN STAGE" },
]);

function normalizeProgress(value, fallback = 8) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(100, Math.max(0, Math.round(numeric)))
    : fallback;
}

function stageIndexForProgress(progress) {
  const value = normalizeProgress(progress, 0);
  return SPLASH_PHASES.reduce(
    (active, phase, index) => (value >= phase.threshold ? index : active),
    0,
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SPLASH_PHASES,
    normalizeProgress,
    stageIndexForProgress,
  };
}

if (typeof document !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const root = document.documentElement;

  const isDynamic = params.get("dynamic") === "1";
  const isDark = params.get("dark") === "1";
  const customColor = params.get("customColor");

  if (isDark) {
    root.classList.add("dark");
  }

  if (isDynamic) {
    root.classList.add("dynamic-theme");
    const setVar = (name, val) => {
      if (val !== null && val !== undefined) root.style.setProperty(name, val);
    };
    setVar("--ambient-hue", params.get("hue") || "210");
    setVar("--ambient-saturation", (params.get("sat") || "28") + "%");
    setVar("--ambient-hue-secondary", params.get("secHue") || "252");
    setVar("--ambient-saturation-secondary", (params.get("secSat") || "36") + "%");
    setVar("--ambient-secondary-strength", params.get("secStr") || "1");
    setVar("--ambient-hue-tertiary", params.get("terHue") || "210");
    setVar("--ambient-saturation-tertiary", (params.get("terSat") || "28") + "%");
    setVar("--ambient-tertiary-strength", params.get("terStr") || "1");
    setVar("--ambient-primary-x", (params.get("priX") || "12") + "%");
    setVar("--ambient-primary-y", (params.get("priY") || "8") + "%");
    setVar("--ambient-secondary-x", (params.get("secX") || "92") + "%");
    setVar("--ambient-secondary-y", (params.get("secY") || "96") + "%");
    setVar("--ambient-tertiary-x", (params.get("terX") || "52") + "%");
    setVar("--ambient-tertiary-y", (params.get("terY") || "54") + "%");
    setVar("--ambient-gradient-angle", (params.get("gradAngle") || "160") + "deg");
  } else if (customColor && /^#[\da-f]{6}$/i.test(customColor)) {
    root.classList.add("custom-theme");
    root.style.setProperty("--custom-theme-color", customColor);
  }

  const progressBar = document.querySelector("[data-progress-bar]");
  const progressNumber = document.querySelector("[data-progress-number]");
  const statusElement = document.querySelector("[data-status]");
  const telemetryElement = document.querySelector("[data-telemetry]");
  const currentPhaseElement = document.querySelector("[data-current-phase]");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentProgress = normalizeProgress(params.get("progress"), 8);
  let finishPromise = null;

  function renderProgress(progress) {
    currentProgress = normalizeProgress(progress, currentProgress);
    const activeIndex = stageIndexForProgress(currentProgress);
    const phaseInfo = SPLASH_PHASES[activeIndex];
    const formatted = String(currentProgress).padStart(2, "0");

    if (progressBar) {
      progressBar.style.width = `${currentProgress}%`;
    }
    if (progressNumber) {
      progressNumber.textContent = formatted;
    }
    if (currentPhaseElement && phaseInfo) {
      currentPhaseElement.textContent = phaseInfo.label;
    }
    if (telemetryElement && phaseInfo && !telemetryElement.dataset.custom) {
      telemetryElement.textContent = phaseInfo.telemetry;
    }
  }

  window.setSplashStatus = (status, progress) => {
    if (typeof status === "string" && status.trim()) {
      const clean = status.trim().replace(/^["']|["']$/g, "").slice(0, 80);
      if (statusElement) {
        statusElement.textContent = clean;
      }
    }
    if (Number.isFinite(Number(progress))) {
      renderProgress(progress);
    }
  };

  window.finishSplash = () => {
    if (finishPromise) return finishPromise;
    renderProgress(100);
    if (statusElement) statusElement.textContent = "准备就绪";
    if (telemetryElement) telemetryElement.textContent = "LAUNCHING MAIN STAGE...";
    root.classList.add("is-leaving");

    finishPromise = new Promise((resolve) => {
      window.setTimeout(resolve, reduceMotion.matches ? 0 : 200);
    });
    return finishPromise;
  };

  window.addEventListener("message", (event) => {
    if (!event.data || typeof event.data !== "object") return;
    if (event.data.type === "setSplashStatus") {
      window.setSplashStatus?.(event.data.status, event.data.progress);
    } else if (event.data.type === "finishSplash") {
      window.finishSplash?.();
    }
  });

  renderProgress(currentProgress);

  const initialStatus = params.get("status");
  if (initialStatus) {
    window.setSplashStatus(initialStatus, currentProgress);
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("is-ready"));
  });
}
