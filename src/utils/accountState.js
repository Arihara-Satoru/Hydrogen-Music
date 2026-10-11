import pinia from '../store/pinia'
import { useCloudStore } from '../store/cloudStore'
import { useLibraryStore } from '../store/libraryStore'
import { useUserStore } from '../store/userStore'
import { clearLoginCookies } from './authority'
import { resetTogetherSession } from './listenTogetherSession'

export async function clearAccountScopedState(options = {}) {
    const { clearCookies = true } = options
    resetTogetherSession()

    if (clearCookies) {
        clearLoginCookies()
    }

    const userStore = useUserStore(pinia)
    const cloudStore = useCloudStore(pinia)
    const libraryStore = useLibraryStore(pinia)

    userStore.resetAccountState()
    cloudStore.resetAccountState()
    libraryStore.resetAccountState()
}
