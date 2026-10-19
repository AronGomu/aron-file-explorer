import { useEffect, useState } from 'react';
import { useContextMenu } from '../providers/ContextMenuProvider';
import { FILE_DRAG_TYPE } from '../utils/fileDrag';

export default function useFavoritesDropTarget(onAdd) {
    const { draggedItems = [], endItemDrag, isProcessing } = useContextMenu();
    const [active, setActive] = useState(false);
    useEffect(() => { setActive(false); }, [draggedItems]);
    const isDragging = !isProcessing && draggedItems.some(item => !item.isParentNavigation);
    const accepts = event => isDragging && !event.target.closest?.('.sidebar-item') &&
        Array.from(event.dataTransfer?.types || []).includes(FILE_DRAG_TYPE);
    const clearForItem = event => {
        if (event.target.closest?.('.sidebar-item')) setActive(false);
    };
    const over = event => {
        if (!accepts(event)) { setActive(false); return; }
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'link';
        setActive(true);
    };

    return { isDragging, dropTargetProps: {
        'data-favorites-drop-active': active && isDragging ? 'true' : undefined,
        onDragEnterCapture: clearForItem,
        onDragOverCapture: clearForItem,
        onDragEnter: over,
        onDragOver: over,
        onDragLeave: event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
        },
        onDrop: event => {
            if (!accepts(event)) return;
            event.preventDefault(); event.stopPropagation();
            const items = draggedItems.filter(item => !item.isParentNavigation);
            setActive(false);
            endItemDrag();
            onAdd(items);
        },
    } };
}
