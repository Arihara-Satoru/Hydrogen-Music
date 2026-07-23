const normalizePlaybackKey = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

export function createOtherAudioPauseController({
  isPlaying,
  hasPlayableTrack,
  getPlaybackKey,
  pause,
  resume,
}) {
  let otherAudioActive = false;
  let resumePending = false;
  let pendingPlaybackKey = null;
  let manualOverride = false;

  const clearPendingResume = () => {
    resumePending = false;
    pendingPlaybackKey = null;
  };

  const rememberPendingResume = () => {
    const playbackKey = normalizePlaybackKey(getPlaybackKey?.());
    if (!playbackKey || hasPlayableTrack?.() === false) {
      clearPendingResume();
      return false;
    }
    resumePending = true;
    pendingPlaybackKey = playbackKey;
    return true;
  };

  const setOtherAudioActive = (active) => {
    const nextActive = active === true;
    if (nextActive === otherAudioActive) return;

    otherAudioActive = nextActive;
    if (nextActive) {
      manualOverride = false;
      if (isPlaying?.() && rememberPendingResume()) {
        Promise.resolve(pause?.()).catch(() => {});
      }
      return;
    }

    manualOverride = false;
    const currentPlaybackKey = normalizePlaybackKey(getPlaybackKey?.());
    const shouldResume =
      resumePending &&
      pendingPlaybackKey === currentPlaybackKey &&
      hasPlayableTrack?.() !== false;
    clearPendingResume();
    if (shouldResume) Promise.resolve(resume?.()).catch(() => {});
  };

  const requestPlayback = ({ userInitiated = false } = {}) => {
    if (!otherAudioActive) return true;

    if (userInitiated) {
      manualOverride = true;
      clearPendingResume();
      return true;
    }
    if (manualOverride) return true;

    rememberPendingResume();
    return false;
  };

  const handleManualPause = () => {
    manualOverride = false;
    clearPendingResume();
  };

  const getState = () => ({
    otherAudioActive,
    resumePending,
    manualOverride,
  });

  return {
    getState,
    handleManualPause,
    requestPlayback,
    setOtherAudioActive,
  };
}
