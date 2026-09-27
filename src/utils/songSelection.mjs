export const selectSongRange = (items, start, end, previous = []) => {
    const selected = new Set(previous)
    for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
        if (items[index]) selected.add(items[index].rowKey)
    }
    return selected
}
