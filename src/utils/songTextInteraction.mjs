// Cancel only the second left-button press: Chromium selects a word on that
// mousedown, before dblclick. A normal press-and-drag remains native/selectable.
export function preventPlaybackTextSelection(event) {
    if (event.button !== 0 || event.detail < 2) return
    if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    event.preventDefault()
}
