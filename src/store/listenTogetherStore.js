import { defineStore } from 'pinia'

export const useListenTogetherStore = defineStore('listenTogether', {
    state: () => ({
        room: null, joining: false, busy: false, connection: '', error: '', detailError: '',
        members: [], songs: [], orders: [], messages: [], playback: null,
        listVersion: '', localPaused: false, owner: false, chatEnabled: true, lastSync: 0,
        moreSongs: false, loadingSongs: false,
    }),
    getters: {
        canControl: state => state.owner && state.room?.kind === 'music',
    },
})
