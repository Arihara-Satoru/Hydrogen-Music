// Keep the player independent of the API/session module (and its async imports).
let handler = null
let savedPlayer = null
export function setTogetherPersonalSnapshot(value) { savedPlayer = value }
export function getTogetherPersonalSnapshot() { return savedPlayer }
export function setTogetherHandler(value) { handler = value }
export function interceptTogetherControl(action, payload) {
    if (!handler) return false
    handler(action, payload)
    return true
}
export function isTogetherPlayback() { return handler !== null }
