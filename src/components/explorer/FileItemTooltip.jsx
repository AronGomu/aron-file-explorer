import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function FileItemTooltip({ id, text, point }) {
    const ref = useRef(null);
    const [position, setPosition] = useState({ left: point.x + 14, top: point.y + 18 });

    useLayoutEffect(() => {
        const { width, height } = ref.current.getBoundingClientRect();
        setPosition({
            left: Math.max(8, Math.min(point.x + 14, window.innerWidth - width - 8)),
            top: Math.max(8, point.y + height + 26 <= window.innerHeight
                ? point.y + 18 : point.y - height - 8),
        });
    }, [text, point.x, point.y]);

    return createPortal(<div ref={ref} id={id} role="tooltip" className="file-item-tooltip" style={position}>
        {text}
    </div>, document.body);
}
