import { createRouter, createWebHashHistory } from 'vue-router'
import { isLogin } from '../utils/authority'
import { noticeOpen } from '../utils/dialog'
// 路由组件全部切换为懒加载，减小首屏体积
const HomePage = () => import('../views/HomePage.vue')
const CloudDisk = () => import('../views/CloudDisk.vue')
const PersonalFMPage = () => import('../views/PersonalFMPage.vue')
const LoginPage = () => import('../views/LoginPage.vue')
const LoginContent = () => import('../components/LoginContent.vue')
const MyMusic = () => import('../views/MyMusic.vue')
const SirenPage = () => import('../views/SirenPage.vue')
const LibraryDetail = () => import('../components/LibraryDetail.vue')
const RecommendSongs = () => import('../components/RecommendSongs.vue')
const LocalMusicDetail = () => import('../components/LocalMusicDetail.vue')
const SearchResult = () => import('../views/SearchResult.vue')
const Settings = () => import('../views/Settings.vue')
const RadioDetail = () => import('../components/RadioDetail.vue')

import { useUserStore } from '../store/userStore'
import { useLibraryStore } from '../store/libraryStore'
import { useLocalStore } from '../store/localStore'
import { storeToRefs } from 'pinia'
import { useOtherStore } from '../store/otherStore'
const userStore = useUserStore()
const libraryStore = useLibraryStore()
const { updateLibraryDetail } = libraryStore
const { libraryInfo } = storeToRefs(libraryStore)
const localStore = useLocalStore()
const otherStore = useOtherStore()
const hasDifferentLibraryId = (to, from) => String(to?.params?.id || '') != String(from?.params?.id || '')

const routes = [
    {
        path: '/',
        name: 'homepage',
        component: HomePage,
        beforeEnter: () => {
            if(!userStore.homePage) return {name: 'mymusic'}
        },
    },
    {
        path: '/cloud',
        name: 'clouddisk',
        component: CloudDisk,
        beforeEnter: () => {
            if(!userStore.cloudDiskPage) return {name: 'mymusic'}
            if(isLogin()) return
            noticeOpen("请先登录", 2)
            return {name: 'login'}
        },
    },
    {
        path: '/login',
        name: 'login',
        component: LoginPage
    },
    {
        path: '/siren',
        name: 'siren',
        component: SirenPage,
    },
    {
        path: '/siren/album/:id',
        name: 'sirenAlbum',
        component: SirenPage,
    },
    {
        path: '/mymusic',
        name: 'mymusic',
        component: MyMusic,
        children: [
            {
                path: '/mymusic/playlist/:id',
                name: 'playlist',
                component: LibraryDetail,
                beforeEnter: (to, from) => {
                    const needReload = !libraryInfo.value || from.name != 'playlist' || hasDifferentLibraryId(to, from)
                    if (needReload) {
                        // 先切路由，再异步补数据，避免首页点击后被接口等待阻塞。
                        void updateLibraryDetail(to.params.id, to.name, { deferRemaining: true, routeQuery: to.query })
                            .catch(error => {
                                console.error('加载歌单详情失败:', error)
                            })
                    }
                }
            },
            {
                path: '/mymusic/album/:id',
                name: 'album',
                component: LibraryDetail,
                beforeEnter: (to, from) => {
                    const needReload = !libraryInfo.value || from.name != 'album' || hasDifferentLibraryId(to, from)
                    if (needReload) {
                        // 专辑详情同样改为异步补数据，减少点击到页面出现的等待感。
                        void updateLibraryDetail(to.params.id, to.name)
                            .catch(error => {
                                const detail = error?.response?.data?.errmsg || error?.response?.data?.msg || error?.message || error
                                console.error('加载专辑详情失败:', detail)
                            })
                    }
                }
            },
            {
                path: '/mymusic/artist/:id',
                name: 'artist',
                component: LibraryDetail,
                beforeEnter: (to, from) => {
                    const needReload = !libraryInfo.value || from.name != 'artist' || hasDifferentLibraryId(to, from)
                    if (needReload) {
                        // 歌手页也不要阻塞切页，热门单曲和歌手信息到达后再渲染。
                        void updateLibraryDetail(to.params.id, to.name)
                            .catch(error => {
                                console.error('加载歌手详情失败:', error)
                            })
                    }
                }
            },
            {
                path: '/mymusic/playlist/rec',
                name: 'rec',
                component: RecommendSongs,
                beforeEnter: () => {
                    if(isLogin()) return
                    noticeOpen("请先登录", 2)
                    return {name: 'login'}
                }
            },
            {
                path: '/mymusic/dj/:id',
                name: 'dj',
                component: RadioDetail,
            },
            {
                path: '/mymusic/local/files',
                name: 'localFiles',
                component: LocalMusicDetail,
                beforeEnter: (to, from) => {
                    if(from.name != 'localFiles') localStore.updateLocalMusicDetail(to.name, to.query)
                }
            },
            {
                path: '/mymusic/local/album/:id',
                name: 'localAlbum',
                component: LocalMusicDetail,
                beforeEnter: (to, from) => {
                    if(from.name != 'localAlbum') localStore.updateLocalMusicDetail(to.name, null, to.params.id)
                }
            },
            {
                path: '/mymusic/local/artist/:id',
                name: 'localArtist',
                component: LocalMusicDetail,
                beforeEnter: (to, from) => {
                    if(from.name != 'localArtist') localStore.updateLocalMusicDetail(to.name, null, to.params.id)
                }
            },
        ],
        beforeEnter: (to, from) => {
            if(!isLogin() && !((from.name == 'homepage' || from.name == 'search') && to.fullPath != '/mymusic')) return {name: 'login'}
        },
    },
    {
        path: '/personalfm',
        name: 'personalfm',
        component: PersonalFMPage,
        beforeEnter: () => {
            if(isLogin()) return
            noticeOpen("请先登录", 2)
            return {name: 'login'}
        }
    },
    {
        path: '/login/account',
        name: 'account',
        component: LoginContent
    },
    {
        path: '/library',
        name: 'library',
        component: LibraryDetail
    },
    {
        path: '/search',
        name: 'search',
        component: SearchResult,
        beforeEnter: (to) => {
            otherStore.getSearchInfo(to.query.keywords)
        }
    },
    {
        path: '/settings',
        name: 'settings',
        component: Settings,
    },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
})

export default router
