export const isEditingTarget = target => {
    const field = target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]');
    return Boolean(field && !field.disabled && !field.readOnly &&
        field.getAttribute('aria-disabled') !== 'true' && field.getAttribute('aria-readonly') !== 'true');
};

export function focusItemPane() {
    if (document.querySelector('[role="dialog"], .modal-overlay, .context-menu')) return;
    document.querySelector('.file-list-container')?.focus({ preventScroll: true });
}

export function restoreItemPaneAfterPointer(event) {
    if (isEditingTarget(event.target) || event.target.closest?.('video, audio, object, iframe')) return;
    requestAnimationFrame(() => {
        if (!isEditingTarget(document.activeElement)) focusItemPane();
    });
}
