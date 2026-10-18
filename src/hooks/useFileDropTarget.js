import { useEffect, useState } from 'react';
import { useContextMenu } from '../providers/ContextMenuProvider';
import { FILE_DRAG_TYPE } from '../utils/fileDrag';
import './fileDropTarget.css';

export default function useFileDropTarget() {
    const { draggedItems = [], canDropItems, dropItems } = useContextMenu();
    const [activePath, setActivePath] = useState(null);
    useEffect(() => { setActivePath(null); }, [draggedItems]);

    return path => {
        if (!path) return {};
        const accepts = event => Array.from(event.dataTransfer?.types || []).includes(FILE_DRAG_TYPE) && canDropItems?.(path);
        const over = event => {
            if (!accepts(event)) {
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setActivePath(path);
        };
        return {
            'data-file-drop-path': path,
            'data-file-drop-active': activePath === path && draggedItems.length > 0 ? 'true' : undefined,
            onDragEnter: over,
            onDragOver: over,
            onDragLeave: event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setActivePath(active => active === path ? null : active);
            },
            onDrop: event => {
                if (!accepts(event)) return;
                event.preventDefault();
                event.stopPropagation();
                setActivePath(null);
                dropItems(path);
            },
        };
    };
}
