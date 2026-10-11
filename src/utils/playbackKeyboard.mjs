// Space belongs to focused form controls, editors and media controls first.
const spaceControlSelector = 'input, textarea, select, button, a[href], summary, audio, video, [role="textbox"], [role="combobox"], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="tab"], [role="menuitem"], .plyr'

function ownsSpace(element) {
    return element?.isContentEditable || Boolean(element?.closest?.(spaceControlSelector))
}

export function installSpacePlaybackShortcut(target, togglePlayback) {
    const handleKeydown = event => {
        if (event.key !== ' ' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        const path = event.composedPath?.() || [event.target]
        if (path.some(ownsSpace) || ownsSpace(target.document?.activeElement)) return
        event.preventDefault()
        togglePlayback()
    }
    // Bubble phase lets a component's own keyboard handling take precedence.
    target.addEventListener('keydown', handleKeydown)
    return () => target.removeEventListener('keydown', handleKeydown)
}
