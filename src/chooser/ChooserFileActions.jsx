import React, { useEffect, useState } from 'react';
import { useContextMenu } from '../providers/ContextMenuProvider';
import { useHistory } from '../providers/HistoryProvider';
import { invoke } from '@tauri-apps/api/core';
import ContextMenu from '../components/contextMenu/ContextMenu';
import RenameModal from '../components/common/RenameModal';
import CreateFileButton from '../components/explorer/CreateFileButton';
import { replaceFileName } from '../utils/pathUtils';
import { focusItemPane } from '../utils/explorerFocus';

export default function ChooserFileActions({ onProperties, onError, onProcessingChange }) {
    const actions = useContextMenu();
    const { currentPath, navigateTo } = useHistory();
    const [renameTarget, setRenameTarget] = useState(null);

    useEffect(() => { onProcessingChange(actions.isProcessing); }, [actions.isProcessing, onProcessingChange]);
    useEffect(() => {
        const rename = event => { if (!event.detail?.item?.isParentNavigation) setRenameTarget(event.detail?.item || null); };
        const properties = event => onProperties(event.detail?.item);
        document.addEventListener('open-rename-modal', rename);
        document.addEventListener('show-properties', properties);
        return () => {
            document.removeEventListener('open-rename-modal', rename);
            document.removeEventListener('show-properties', properties);
        };
    }, [onProperties]);

    const closeRename = () => { setRenameTarget(null); requestAnimationFrame(focusItemPane); };
    const rename = async (item, name) => {
        try {
            await invoke('rename', { oldPath: item.path, newPath: replaceFileName(item.path, name) });
            navigateTo(currentPath);
        } catch (error) { onError(`Could not rename: ${error}`); }
    };

    return <>
        {actions.isOpen && <ContextMenu position={actions.position} items={actions.items} onClose={actions.closeContextMenu} />}
        <RenameModal isOpen={!!renameTarget} item={renameTarget} onClose={closeRename} onRename={rename} />
        <CreateFileButton dialogsOnly />
    </>;
}
