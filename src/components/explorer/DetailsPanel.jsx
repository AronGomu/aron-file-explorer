import React, { useEffect, useRef, useState } from 'react';
import usePersistedState from '../../hooks/usePersistedState';
import FileIcon from './FileIcon';
import FolderContentsPreview from './FolderContentsPreview';
import IconButton from '../common/IconButton';
import { formatFileSize, formatDate, getFileType } from '../../utils/formatters';
import { getFileIconType } from '../../utils/icons';
import './detailsPanel.css';

const MIN_PREVIEW_WIDTH = 200;
const getMaximumPreviewWidth = (panel) => Math.max(MIN_PREVIEW_WIDTH,
    Math.floor((panel?.parentElement?.clientWidth || window.innerWidth) * 0.75));

/**
 * Component that displays detailed information about a selected item
 * @param {Object} props - Component properties
 * @param {Object} [props.item] - The selected item to display details for
 * @param {boolean} [props.isMultipleSelection=false] - Whether multiple items are selected
 * @param {Function} [props.onCollapse] - Callback to collapse the preview panel
 * @param {string} [props.viewMode='grid'] - Active explorer view mode
 * @returns {React.ReactElement} Details panel component
 */
const DetailsPanel = ({ item, isMultipleSelection = false, onCollapse, viewMode = 'grid' }) => {
    const [detailsPath, setDetailsPath] = useState(null);
    const [panelWidth, setPanelWidth] = usePersistedState('fileExplorerDetailsPanelWidth', 300);
    const [maximumWidth, setMaximumWidth] = useState(() => getMaximumPreviewWidth());
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef(null);
    const resizeStart = useRef(null);

    useEffect(() => {
        const constrainWidth = () => {
            const maximum = getMaximumPreviewWidth(panelRef.current);
            setMaximumWidth(maximum);
            setPanelWidth(width => Math.max(MIN_PREVIEW_WIDTH, Math.min(width, maximum)));
        };
        constrainWidth();
        const observer = new ResizeObserver(constrainWidth);
        observer.observe(panelRef.current.parentElement);
        return () => observer.disconnect();
    }, []);

    const resizePanel = (width) => setPanelWidth(Math.max(MIN_PREVIEW_WIDTH, Math.min(Math.round(width), maximumWidth)));

    const handleResizeStart = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        resizeStart.current = { x: event.clientX, width: panelRef.current.getBoundingClientRect().width };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizing(true);
    };

    const handleResizeMove = (event) => {
        if (!resizeStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        resizePanel(resizeStart.current.width + resizeStart.current.x - event.clientX);
    };

    const handleResizeEnd = (event) => {
        if (event.type === 'pointerup') handleResizeMove(event);
        resizeStart.current = null;
        setIsResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleResizeKeyDown = (event) => {
        if (event.key === 'ArrowLeft') resizePanel(panelWidth + 10);
        else if (event.key === 'ArrowRight') resizePanel(panelWidth - 10);
        else if (event.key === 'Home') resizePanel(MIN_PREVIEW_WIDTH);
        else if (event.key === 'End') resizePanel(maximumWidth);
        else return;
        event.preventDefault();
        event.stopPropagation();
    };

    const resizeHandle = (
        <div
            className="details-resize-handle"
            role="separator"
            aria-label="Resize preview pane"
            aria-orientation="vertical"
            aria-controls="explorer-preview-panel"
            aria-valuemin={MIN_PREVIEW_WIDTH}
            aria-valuemax={maximumWidth}
            aria-valuenow={panelWidth}
            aria-valuetext={`${panelWidth} pixels`}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onLostPointerCapture={handleResizeEnd}
            onKeyDown={handleResizeKeyDown}
        />
    );
    const panelClassName = `details-panel${isResizing ? ' details-resizing' : ''}`;
    const panelStyle = { '--details-panel-width': `${panelWidth}px` };
    const collapseButton = onCollapse && (
        <IconButton
            icon="chevron-right"
            className="details-panel-toggle"
            label="Collapse preview panel"
            title="Collapse preview panel (Space)"
            aria-expanded={true}
            aria-keyshortcuts="Space"
            onClick={onCollapse}
        />
    );

    // If no item selected or multiple items are selected
    if (!item || isMultipleSelection) {
        return (
            <div id="explorer-preview-panel" ref={panelRef} className={panelClassName} style={panelStyle}>
                {resizeHandle}
                {collapseButton}
                <div className="details-content">
                    {isMultipleSelection ? (
                        <div className="details-summary">
                            {/* In a real implementation, this would show the count of files and folders,
              total size, etc. */}
                            <p>Multiple items selected. Select a single item to view details.</p>
                        </div>
                    ) : (
                        <div className="details-empty">
                            <p>Select an item to view its details.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Determine if item is a directory or file
    const isDirectory = item.isDirectory || 'sub_file_count' in item;
    const isImage = !isDirectory && getFileIconType(item.name) === 'image';
    const canToggleDetails = isDirectory || isImage;
    const showDetails = !canToggleDetails || detailsPath === item.path;

    // Format size
    const size = item.size_in_bytes != null ? formatFileSize(item.size_in_bytes) : 'Unknown';

    // Get file type
    const fileType = isDirectory ? 'Folder' : getFileType(item.name);

    // Get extension (for files)
    const extension = !isDirectory && item.name.includes('.')
        ? item.name.split('.').pop().toUpperCase()
        : '';

    // Format dates
    const created = formatDate(item.created, true);
    const modified = formatDate(item.last_modified, true);
    const accessed = formatDate(item.accessed, true);

    return (
        <div id="explorer-preview-panel" ref={panelRef} className={`${panelClassName}${canToggleDetails ? ' with-details-toggle' : ''}`} style={panelStyle}>
            {resizeHandle}
            {collapseButton}
            <div className={`details-content${isDirectory && !showDetails ? ' folder-preview-content' : ''}${isImage && !showDetails ? ' image-preview-content' : ''}`}>
                {isDirectory && !showDetails ? (
                    <FolderContentsPreview path={item.path} viewMode={viewMode} />
                ) : <>
                    <div className={`details-preview${isImage && !showDetails ? ' image-preview-only' : ''}`}>
                        <div className={`details-icon${isImage ? ' details-image' : ''}`}>
                            <FileIcon
                                filename={item.name}
                                path={item.path}
                                revision={`${item.last_modified || ''}:${item.size_in_bytes ?? ''}`}
                                isDirectory={isDirectory}
                                size="large"
                                thumbnailSize={isImage && !showDetails ? 1024 : 512}
                            />
                        </div>

                        {showDetails && <>
                            <div className="details-name truncate" title={item.name}>
                                {item.name}
                            </div>

                            <div className="details-type">
                                {fileType}{extension ? ` (${extension})` : ''}
                            </div>
                        </>}
                    </div>

                    {showDetails && <>
                        <div className="details-section">
                            <h4 className="details-section-title">General</h4>

                            <div className="details-row">
                                <span className="details-label">Location:</span>
                                <span className="details-value truncate" title={item.path}>
                                  {item.path.replace(`/${item.name}`, '')}
                                </span>
                            </div>

                            {isDirectory ? (
                                <div className="details-row">
                                    <span className="details-label">Contents:</span>
                                    <span className="details-value">
                                        {item.sub_file_count ?? 'Unknown'} files, {item.sub_dir_count ?? 'Unknown'} folders
                                    </span>
                                </div>
                            ) : <div className="details-row">
                                <span className="details-label">Size:</span>
                                <span className="details-value">
                                  {size}
                                    {item.size_in_bytes != null && (
                                        <span className="details-value-secondary"> ({item.size_in_bytes.toLocaleString()} bytes)</span>
                                    )}
                                </span>
                            </div>}

                            <div className="details-row">
                                <span className="details-label">Type:</span>
                                <span className="details-value">{fileType}</span>
                            </div>
                        </div>

                        <div className="details-section">
                            <h4 className="details-section-title">Dates</h4>

                            <div className="details-row">
                                <span className="details-label">Created:</span>
                                <span className="details-value">{created}</span>
                            </div>

                            <div className="details-row">
                                <span className="details-label">Modified:</span>
                                <span className="details-value">{modified}</span>
                            </div>

                            <div className="details-row">
                                <span className="details-label">Accessed:</span>
                                <span className="details-value">{accessed}</span>
                            </div>
                        </div>

                        <div className="details-section">
                            <h4 className="details-section-title">Permissions</h4>

                            <div className="details-row">
                                <span className="details-label">Access rights:</span>
                                <span className="details-value">{item.access_rights_as_string}</span>
                            </div>

                            <div className="details-row">
                                <span className="details-label">Octal:</span>
                                <span className="details-value">{item.access_rights_as_number}</span>
                            </div>

                            <div className="details-row">
                                <span className="details-label">Symlink:</span>
                                <span className="details-value">{item.is_symlink ? 'Yes' : 'No'}</span>
                            </div>
                        </div>
                    </>}
                </>}
            </div>
            {canToggleDetails && (
                <IconButton
                    icon={showDetails ? 'eye' : 'info'}
                    className="details-info-toggle"
                    label={showDetails ? 'Show preview' : 'Show details'}
                    title={showDetails ? 'Show preview' : 'Show details'}
                    aria-pressed={showDetails}
                    onClick={() => setDetailsPath(showDetails ? null : item.path)}
                />
            )}
        </div>
    );
};

export default DetailsPanel;

