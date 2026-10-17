// Arrow navigation uses the displayed order and never wraps across boundaries.
export function arrowSelection({ current, anchor, key, columns, count }) {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key];
    const index = current < 0 ? 0 : Math.max(0, Math.min(count - 1, current + delta));
    const origin = anchor >= 0 && anchor < count ? anchor : current >= 0 ? current : index;
    return { index, anchor: origin, start: Math.min(origin, index), end: Math.max(origin, index) };
}
