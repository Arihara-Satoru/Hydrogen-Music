import { defineStore } from "pinia";

export const useUserStore = defineStore('userStore', {
    state: () => {
        return {
            user: null,
            loginMode: null,
            likelist: null,
            favoritePlaylistId: null,
            favoritePlaylistName: null,
            gradeInfo: null,
            appOptionShow: false,
            biliUser: null,
            homePage: true,
            cloudDiskPage: true,
            personalFMPage: true,
            autoClearFmCacheEvery3Days: false,
            sirenPage: false,
        }
    },
    actions: {
        updateUser(userinfo) {
            this.user = userinfo
        },
        resetAccountState() {
            this.user = null
            this.loginMode = null
            this.likelist = null
            this.favoritePlaylistId = null
            this.favoritePlaylistName = null
            this.gradeInfo = null
            this.appOptionShow = false
        },
        updateLikelist(likelist) {
            this.likelist = Array.isArray(likelist) ? likelist : []
        },
        updateFavoritePlaylistId(playlistId) {
            this.favoritePlaylistId = playlistId
        },
        updateFavoritePlaylistName(playlistName) {
            this.favoritePlaylistName = playlistName
        },
        updateFavoritePlaylistMeta(playlist = null) {
            this.favoritePlaylistId = playlist?.id ?? null
            this.favoritePlaylistName = playlist?.name ?? null
        },
        updateGradeInfo(gradeInfo = null) {
            this.gradeInfo = gradeInfo
        }
    },
    persist: {
        storage: localStorage,
        pick: ['user','biliUser','homePage','cloudDiskPage','personalFMPage','autoClearFmCacheEvery3Days','sirenPage','favoritePlaylistId','favoritePlaylistName']
    },
})
