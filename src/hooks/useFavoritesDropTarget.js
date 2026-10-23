import { useEffect, useState } from 'react';
import { useContextMenu } from '../providers/ContextMenuProvider';
import { FILE_DRAG_TYPE } from '../utils/fileDrag';

export default function useFavoritesDropTarget(onAdd) {
    const { draggedItems = [], endItemDrag, isProcessing } = useContextMenu();
    const [active, setActive] = useState(false);
    useEffect(() => { setActive(false); }, [draggedItems]);
    const folders = draggedItems.filter(item => !item.isParentNavigation && (item.isDirectory || 'sub_file_count' in item));
    const isDragging = !isProcessing && folders.length > 0;
    const accepts = event => isDragging &&
        Array.from(event.dataTransfer?.types || []).includes(FILE_DRAG_TYPE);
    const over = event => {
        if (!accepts(event)) { setActive(false); return; }
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'link';
        setActive(true);
    };

    return { isDragging, dropTargetProps: {
        'data-favorites-drop-active': active && isDragging ? 'true' : undefined,
        onDragEnter: over,
        onDragOver: over,
        onDragLeave: event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
        },
        onDrop: event => {
            if (!accepts(event)) return;
            event.preventDefault(); event.stopPropagation();
            setActive(false);
            endItemDrag();
            onAdd(folders);
        },
    } };
}
