const SPLASH_FAMILIES = Object.freeze([
  "exa",
  "corporate",
  "popucom",
  "endfield",
  "ark",
]);

const SPLASH_FAMILY_LABELS = Object.freeze({
  exa: "星空",
  corporate: "黑白",
  popucom: "缤纷",
  endfield: "工程",
  ark: "工业",
});

const SPLASH_PHASES = Object.freeze([
  { threshold: 0, label: "准备" },
  { threshold: 38, label: "数据" },
  { threshold: 56, label: "服务" },
  { threshold: 82, label: "界面" },
  { threshold: 100, label: "完成" },
]);

function normalizeFamily(value) {
  return SPLASH_FAMILIES.includes(value) ? value : "ark";
}

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
    SPLASH_FAMILIES,
    SPLASH_FAMILY_LABELS,
    normalizeFamily,
    normalizeProgress,
    stageIndexForProgress,
  };
}

if (typeof document !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const root = document.documentElement;
  const family = normalizeFamily(params.get("family"));
  const progressElement = document.querySelector("[data-progress]");
  const progressOutput = document.querySelector("[data-progress-output]");
  const progressGhost = document.querySelector("[data-progress-ghost]");
  const progressBar = document.querySelector("[data-progress-bar]");
  const statusElement = document.querySelector("[data-status]");
  const currentPhaseElement = document.querySelector("[data-current-phase]");
  const phaseElements = [...document.querySelectorAll("[data-phase]")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentProgress = normalizeProgress(params.get("progress"), 8);
  let finishPromise;

  root.dataset.arkTheme = family;
  root.dataset.arkDepth = "complex";
  if (params.get("motion") === "paused") root.dataset.motion = "paused";
  document.querySelector("[data-theme-label]").textContent =
    SPLASH_FAMILY_LABELS[family];

  function renderProgress(progress) {
    currentProgress = normalizeProgress(progress, currentProgress);
    const activePhase = stageIndexForProgress(currentProgress);
    const formattedProgress = String(currentProgress).padStart(2, "0");

    root.style.setProperty("--splash-progress", currentProgress);
    progressElement.value = currentProgress;
    progressElement.textContent = `${currentProgress}%`;
    progressOutput.textContent = `${formattedProgress}%`;
    progressGhost.textContent = formattedProgress;
    progressBar.style.width = `${currentProgress}%`;
    currentPhaseElement.textContent = SPLASH_PHASES[activePhase].label;

    phaseElements.forEach((element, index) => {
      element.dataset.state =
        index < activePhase
          ? "complete"
          : index === activePhase
            ? "active"
            : "pending";
      if (index === activePhase) {
        element.setAttribute("aria-current", "step");
      } else {
        element.removeAttribute("aria-current");
      }
    });
  }

  window.setSplashStatus = (status, progress) => {
    if (typeof status === "string" && status.trim()) {
      statusElement.textContent = status.trim().slice(0, 80);
    }
    if (Number.isFinite(Number(progress))) renderProgress(progress);
  };

  window.finishSplash = () => {
    if (finishPromise) return finishPromise;
    renderProgress(100);
    root.classList.add("is-leaving");
    finishPromise = new Promise((resolve) => {
      window.setTimeout(resolve, reduceMotion.matches ? 0 : 460);
    });
    return finishPromise;
  };

  renderProgress(currentProgress);
  const qaStatus = params.get("status");
  if (qaStatus) window.setSplashStatus(qaStatus, currentProgress);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("is-ready"));
  });
}
