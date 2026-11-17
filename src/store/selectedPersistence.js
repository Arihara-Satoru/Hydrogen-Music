import { watch } from 'vue';

// 只对配置的持久化字段建立依赖，不通过 $subscribe 深度遍历整个 store。
export function selectedPersistence({ store, options }) {
    const config = options.selectedPersist;
    if (!config) return;
    const { storage, pick } = config;
    const key = config.key || store.$id;
    const select = () => Object.fromEntries(pick.map(field => [field, store[field]]));
    const hydrate = () => {
        try {
            const raw = storage.getItem(key);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
            store.$patch(Object.fromEntries(pick.filter(field => Object.hasOwn(saved, field))
                .map(field => [field, saved[field]])));
        } catch (error) {
            console.warn('[persistence] 恢复播放器状态失败', error);
        }
    };
    const persist = () => {
        try { storage.setItem(key, JSON.stringify(select())); }
        catch (error) { console.warn('[persistence] 保存播放器状态失败', error); }
    };
    hydrate();
    // 深度监听仅发生于选中的小对象，保留 lyricType/listInfo 等嵌套配置保存。
    watch(select, persist, { deep: true });
    return { $persist: persist, $hydrate: hydrate };
}
