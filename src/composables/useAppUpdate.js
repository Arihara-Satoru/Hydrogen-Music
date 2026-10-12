import { computed, onMounted, onUnmounted, ref } from 'vue';

export function useAppUpdate() {
  const state = ref({ status: 'idle', progress: 0, error: '', version: '', canDownload: false, canAutoInstall: false, revision: -1 });
  let dispose;
  let disposed = false;
  const receive = (next) => {
    if (!disposed && next && next.revision >= state.value.revision) state.value = next;
  };
  onMounted(() => {
    dispose = windowApi.onAppUpdateState?.(receive);
    windowApi.getAppUpdateState?.().then(receive).catch(() => {});
  });
  onUnmounted(() => { disposed = true; dispose?.(); });
  const busy = computed(() => ['checking', 'downloading', 'cancelling', 'installing'].includes(state.value.status));
  const openRelease = () => windowApi.toRegister(state.value.manualDownloadUrl || 'https://github.com/Arihara-Satoru/Hydrogen-Music/releases');
  const start = () => {
    if (busy.value) return;
    if (!state.value.canDownload) openRelease();
    else if (state.value.status === 'ready') windowApi.installUpdate();
    else if (state.value.version) windowApi.downloadUpdate();
    else windowApi.checkForUpdate();
  };
  const label = computed(() => {
    switch (state.value.status) {
      case 'checking': return '正在检查…';
      case 'downloading': return `下载中 ${state.value.progress}%`;
      case 'cancelling': return '正在取消…';
      case 'installing': return '正在安装并重启…';
      case 'ready': return '安装并重启';
      case 'error': return state.value.canDownload ? '重试更新' : '前往 GitHub 下载';
      default: return state.value.canAutoInstall ? '下载并安装' : state.value.canDownload ? '下载更新' : '前往 GitHub 更新';
    }
  });
  return { state, busy, start, label, openRelease, cancel: () => windowApi.cancelUpdate() };
}
