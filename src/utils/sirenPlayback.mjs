export function buildSirenPlaybackQueue(albums, detailsById) {
    return (Array.isArray(albums) ? albums : []).flatMap(album => {
        const albumId = String(album?.id || '').trim()
        const songs = detailsById?.[albumId]?.songs
        return Array.isArray(songs) ? songs : []
    })
}
