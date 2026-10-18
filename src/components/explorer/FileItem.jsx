import React, { useState, useEffect } from 'react';
import FileIcon from './FileIcon';
import { formatFileSize, formatDate, getFileType } from '../../utils/formatters';
import { replaceFileName } from '../../utils/pathUtils.js';
import { getFileIconType } from '../../utils/icons';
import { invoke } from '@tauri-apps/api/core';
import { useFileSystem } from '../../providers/FileSystemProvider';
import { useHistory } from '../../providers/HistoryProvider';
import { useContextMenu } from '../../providers/ContextMenuProvider';
import useFileDropTarget from '../../hooks/useFileDropTarget';
import { showError, showConfirm } from '../../utils/NotificationSystem';
import './fileItem.css';

/**
 * Component that displays a single file or directory item
 * @param {Object} props - Component properties
 * @param {Object} props.item - The file or directory object to display
 * @param {string} [props.viewMode='grid'] - The view mode: 'grid', 'list', or 'details'
 * @param {boolean} [props.isSelected=false] - Whether the item is currently selected
 * @param {boolean} [props.isFocused=false] - Whether the item is currently focused for keyboard navigation
 * @param {Function} props.onClick - Click handler function
 * @param {Function} props.onDoubleClick - Double-click handler function
 * @param {Function} props.onContextMenu - Context menu handler function
 * @returns {React.ReactElement} File/directory item component
 */
const FileItem = ({
                      item,
                      viewMode = 'grid',
                      thumbnailSize = 256,
                      isSelected = false,
                      isFocused = false,
                      onClick,
                      onDoubleClick,
                      onContextMenu
                  }) => {
    const { loadDirectory } = useFileSystem();
    const { currentPath } = useHistory();
    const { clipboard, isProcessing, draggedItems, beginItemDrag, endItemDrag } = useContextMenu();
    const dropTargetProps = useFileDropTarget();

    const isDirectory = item.isDirectory || 'sub_file_count' in item;
    const hideImageName = viewMode === 'grid' && !isDirectory && getFileIconType(item.name) === 'image';
    const imageRevision = `${item.last_modified || ''}:${item.size_in_bytes ?? ''}`;
    const fileType = isDirectory ? 'Folder' : getFileType(item.name);
    const size = isDirectory
        ? `${item.sub_file_count || 0} items`
        : formatFileSize(item.size_in_bytes);

    // Check if this item is cut (in clipboard with cut operation)
    const isCut = clipboard.operation === 'cut' && 
                  clipboard.items.some(clipItem => clipItem.path === item.path);

    // Format modified date
    const modified = item.isParentNavigation ? '' : formatDate(item.last_modified);


    /**
     * Handles the rename operation with robust path handling
     * @param {Object} item - The item to rename
     * @param {string} newName - The new name for the item
     */
    const handleRename = async (item, newName) => {
        if (!newName || newName === item.name) return;

        try {
            // Use the robust path utility to create the new path
            const newPath = replaceFileName(item.path, newName);

            console.log(`Renaming: "${item.path}" -> "${newPath}"`);

            await invoke('rename', {
                oldPath: item.path,
                newPath: newPath
            });

            console.log('Rename operation completed successfully');

            // Reload current directory
            if (currentPath) {
                await loadDirectory(currentPath);
            }
        } catch (error) {
            console.error('Rename operation failed:', error);
            if (error.message && error.message.includes('already exists')) {
                const shouldCreateCopy = await showConfirm(`A file named "${newName}" already exists. Create a copy instead?`, 'File Exists');
                if (shouldCreateCopy) {
                    const extension = newName.includes('.') ? newName.split('.').pop() : '';
                    const baseName = extension ? newName.replace(`.${extension}`, '') : newName;
                    const copyName = extension ? `${baseName} - Copy.${extension}` : `${baseName} - Copy`;
                    handleRename(item, copyName);
                }
            } else {
                showError(`Failed to rename: ${error.message || error}`);
            }
        }
    };

    /**
     * Handles click events on the file item
     * @param {React.MouseEvent} e - The click event
     */
    const handleClick = (e) => {
        if (onClick) onClick(e);
    };

    /**
     * Handles double-click events on the file item
     * @param {React.MouseEvent} e - The double-click event
     */
    const handleDoubleClick = (e) => {
        // Prevent text selection on double-click
        e.preventDefault();
        e.stopPropagation();
        
        // Clear any existing text selection
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }
        
        if (onDoubleClick) onDoubleClick(e);
    };

    /**
     * Handles right-click context menu events on the file item
     * @param {React.MouseEvent} e - The context menu event
     */
    const handleContextMenu = (e) => {
        if (onContextMenu) onContextMenu(e);
    };

    return (
        <>
            <div
                className={`file-item view-mode-${viewMode.toLowerCase()} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${isDirectory ? 'directory' : 'file'} ${isCut ? 'cut' : ''} ${hideImageName ? 'image-item' : ''}`}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                draggable={!isProcessing}
                onDragStart={event => beginItemDrag(event, item)}
                onDragEnd={endItemDrag}
                data-file-drag-source={draggedItems.some(dragged => dragged.path === item.path) ? 'true' : undefined}
                {...dropTargetProps(isDirectory ? item.path : null)}
                onContextMenu={handleContextMenu}
                data-path={item.path}
                title={hideImageName ? item.name : undefined}
                aria-label={hideImageName ? item.name : undefined}
                role={viewMode === 'list' ? 'row' : undefined}
            >
                {viewMode === 'grid' && (
                    <div className="file-item-grid">
                        <div className="file-icon-container">
                            <FileIcon filename={item.name} path={item.path} revision={imageRevision} isDirectory={isDirectory} thumbnailSize={thumbnailSize} />
                        </div>

                        {!hideImageName && (
                            <div className="file-name truncate" title={item.name}>
                                {item.name}
                            </div>
                        )}
                    </div>
                )}

                {viewMode === 'list' && (
                    <div className="file-item-list">
                        <div className="file-column column-name" role="cell">
                            <div className="file-icon-container">
                                <FileIcon filename={item.name} path={item.path} revision={imageRevision} isDirectory={isDirectory} />
                            </div>
                            <div className="file-name truncate" title={item.name}>
                                {item.name}
                            </div>
                        </div>
                        <div className="file-column column-size" role="cell" title={isDirectory ? undefined : size}>
                            {isDirectory ? '—' : size}
                        </div>
                        <div className="file-column column-type" role="cell" title={fileType}>
                            {fileType}
                        </div>
                        <div className="file-column column-modified" role="cell" title={modified}>
                            {modified}
                        </div>
                    </div>
                )}

                {viewMode === 'details' && (
                    <div className="file-item-details">
                        <div className="file-column column-name">
                            <div className="file-icon-container">
                                <FileIcon filename={item.name} path={item.path} revision={imageRevision} isDirectory={isDirectory} />
                            </div>

                            <div className="file-name truncate" title={item.name}>
                                {item.name}
                            </div>
                        </div>

                        <div className="file-column column-size">
                            {size}
                        </div>

                        <div className="file-column column-type">
                            {fileType}
                        </div>

                        <div className="file-column column-modified">
                            {modified}
                        </div>
                    </div>
                )}
            </div>

        </>
    );
};

export default FileItem;
