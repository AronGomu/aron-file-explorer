import React, { useEffect, useRef, useState } from 'react';
import usePersistedState from '../../hooks/usePersistedState';
import FileContentPreview from './FileContentPreview';
import FileDetails from './FileDetails';
import IconButton from '../common/IconButton';
import { formatFileSize, formatDate, getFileType } from '../../utils/formatters';
import { getDirectoryPath } from '../../utils/pathUtils';
import './detailsPanel.css';

const MIN_PREVIEW_WIDTH = 200;
const COLLAPSED_PREVIEW_WIDTH = 48;
const COLLAPSE_RESISTANCE = 100;
const getMaximumPreviewWidth = (panel) => Math.max(MIN_PREVIEW_WIDTH,
    Math.floor((panel?.parentElement?.clientWidth || window.innerWidth) * 0.75));

/**
 * Component that displays detailed information about a selected item
 * @param {Object} props - Component properties
 * @param {Object} [props.item] - The selected item to display details for
 * @param {boolean} [props.isMultipleSelection=false] - Whether multiple items are selected
 * @param {Function} [props.onCollapse] - Callback to collapse the preview panel
 * @param {boolean} [props.isCollapsed=false] - Whether the preview is collapsed to its rail
 * @param {Function} [props.onOpenChange] - Callback to open or collapse the preview panel
 * @param {string} [props.viewMode='grid'] - Active explorer view mode
 * @returns {React.ReactElement} Details panel component
 */
const DetailsPanel = ({ item, isMultipleSelection = false, onCollapse, isCollapsed = false, onOpenChange, viewMode = 'grid', autoCopy = true }) => {
    const [showInformation, setShowInformation] = usePersistedState('fileExplorerDetailsVisible', false);
    const [splitRatio, setSplitRatio] = usePersistedState('fileExplorerPreviewSplit', 0.6);
    const [isSplitting, setIsSplitting] = useState(false);
    const splitRef = useRef(null);
    const splitStart = useRef(null);
    const previewFraction = Math.max(0.15, Math.min(0.85, splitRatio));
    const [panelWidth, setPanelWidth] = usePersistedState('fileExplorerDetailsPanelWidth', 300);
    const [maximumWidth, setMaximumWidth] = useState(() => getMaximumPreviewWidth());
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef(null);
    const resizeStart = useRef(null);

    useEffect(() => {
        const shortcuts = event => {
            if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], .modal-overlay') ||
                event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'i') {
                event.preventDefault();
                if (!event.repeat) setShowInformation(visible => !visible);
            }
        };
        document.addEventListener('keydown', shortcuts);
        return () => document.removeEventListener('keydown', shortcuts);
    }, []);

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

    const resizePanel = (width) => {
        const collapsed = width < MIN_PREVIEW_WIDTH;
        if (!collapsed) setPanelWidth(Math.min(Math.round(width), maximumWidth));
        const previousCollapsed = resizeStart.current?.collapsed ?? isCollapsed;
        if (collapsed !== previousCollapsed) {
            if (resizeStart.current) resizeStart.current.collapsed = collapsed;
            if (onOpenChange) onOpenChange(!collapsed);
            else onCollapse?.();
        }
    };

    const handleResizeStart = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        resizeStart.current = { x: event.clientX, width: panelRef.current.getBoundingClientRect().width, collapsed: isCollapsed };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizing(true);
    };

    const handleResizeMove = (event) => {
        if (!resizeStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const width = resizeStart.current.width + resizeStart.current.x - event.clientX;
        if (!resizeStart.current.collapsed && width < MIN_PREVIEW_WIDTH &&
            width > MIN_PREVIEW_WIDTH - COLLAPSE_RESISTANCE) {
            setPanelWidth(MIN_PREVIEW_WIDTH);
            return;
        }
        resizePanel(width);
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
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') resizePanel(isCollapsed ? panelWidth : panelWidth + 10);
        else if (event.key === 'ArrowRight') resizePanel(isCollapsed ? COLLAPSED_PREVIEW_WIDTH : panelWidth - 10);
        else if (event.key === 'Home') resizePanel(COLLAPSED_PREVIEW_WIDTH);
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
            title="Resize preview pane (Alt+Shift+Left/Right)"
            aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+Home Alt+Shift+End"
            aria-orientation="vertical"
            aria-controls="explorer-preview-panel"
            aria-valuemin={COLLAPSED_PREVIEW_WIDTH}
            aria-valuemax={maximumWidth}
            aria-valuenow={isCollapsed ? COLLAPSED_PREVIEW_WIDTH : panelWidth}
            aria-valuetext={isCollapsed ? 'Collapsed' : `${panelWidth} pixels`}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onLostPointerCapture={handleResizeEnd}
            onKeyDown={handleResizeKeyDown}
        />
    );
    const resizeSplit = (ratio) => setSplitRatio(Math.max(0.15, Math.min(0.85, ratio)));

    const handleSplitStart = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        splitStart.current = {
            y: event.clientY, ratio: previewFraction,
            height: Math.max(1, splitRef.current.clientHeight - event.currentTarget.offsetHeight)
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsSplitting(true);
    };

    const handleSplitMove = (event) => {
        const drag = splitStart.current;
        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        resizeSplit(drag.ratio + (event.clientY - drag.y) / drag.height);
    };

    const handleSplitEnd = (event) => {
        if (event.type === 'pointerup') handleSplitMove(event);
        splitStart.current = null;
        setIsSplitting(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleSplitKeyDown = (event) => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowUp') resizeSplit(previewFraction - 0.02);
        else if (event.key === 'ArrowDown') resizeSplit(previewFraction + 0.02);
        else if (event.key === 'Home') resizeSplit(0.15);
        else if (event.key === 'End') resizeSplit(0.85);
        else return;
        event.preventDefault();
        event.stopPropagation();
    };

    const panelClassName = `details-panel${isCollapsed ? ' details-panel-collapsed' : ''}${isResizing ? ' details-resizing' : ''}${isSplitting ? ' details-splitting' : ''}`;
    const hasItem = item && !isMultipleSelection;
    const revision = item ? `${item.last_modified || ''}:${item.size_in_bytes ?? ''}` : '';
    const isDirectory = hasItem && (item.isDirectory || 'sub_file_count' in item);
    const footerSummary = hasItem ? [
        item.name,
        isDirectory ? 'Folder' : getFileType(item.name),
        isDirectory ? [
            Number.isFinite(item.sub_file_count) ? `${item.sub_file_count} files` : null,
            Number.isFinite(item.sub_dir_count) ? `${item.sub_dir_count} folders` : null,
        ].filter(Boolean).join(', ') : Number.isFinite(item.size_in_bytes) ? formatFileSize(item.size_in_bytes) : null,
        item.last_modified ? `Modified ${formatDate(item.last_modified, true)}` : null,
        getDirectoryPath(item.path),
    ].filter(Boolean).join(' · ') : '';

    return (
        <div id="explorer-preview-panel" ref={panelRef} className={panelClassName}
            style={{ '--details-panel-width': `${isCollapsed ? COLLAPSED_PREVIEW_WIDTH : panelWidth}px` }}>
            {resizeHandle}
            <div className="details-panel-header">
                {onCollapse && <IconButton
                    icon={isCollapsed ? 'chevron-left' : 'chevron-right'}
                    className="details-panel-toggle"
                    label={isCollapsed ? 'Expand preview panel' : 'Collapse preview panel'}
                    title={`${isCollapsed ? 'Expand' : 'Collapse'} preview panel (Space)`}
                    aria-expanded={!isCollapsed}
                    aria-keyshortcuts="Space"
                    onClick={onCollapse}
                />}
                {!isCollapsed && hasItem && <span className="details-panel-title truncate" title={item.name}>{item.name}</span>}
            </div>
            {!isCollapsed && (hasItem ? <>
                <div ref={splitRef} className="details-body" style={{
                    gridTemplateRows: showInformation
                        ? `minmax(0, ${previewFraction}fr) 12px minmax(0, ${1 - previewFraction}fr)`
                        : 'minmax(0, 1fr)'
                }}>
                    <section id="explorer-file-preview" className="details-preview-area" aria-label="File preview">
                        <FileContentPreview key={`${item.path}:${revision}`} item={item} viewMode={viewMode} autoCopy={autoCopy} />
                    </section>
                    {showInformation && <>
                        <div className="details-split-handle" role="separator"
                            aria-label="Resize preview and information sections" aria-orientation="horizontal"
                            title="Resize preview and information sections (Alt+Shift+Up/Down)"
                            aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown Alt+Shift+Home Alt+Shift+End"
                            aria-controls="explorer-file-preview explorer-file-information"
                            aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(previewFraction * 100)}
                            aria-valuetext={`${Math.round(previewFraction * 100)}% preview`}
                            tabIndex={0} onPointerDown={handleSplitStart} onPointerMove={handleSplitMove}
                            onPointerUp={handleSplitEnd} onPointerCancel={handleSplitEnd}
                            onLostPointerCapture={handleSplitEnd} onKeyDown={handleSplitKeyDown} />
                        <section id="explorer-file-information" className="details-information" aria-label="File information">
                            <FileDetails item={item} />
                        </section>
                    </>}
                </div>
                <div className="details-panel-footer">
                    <span className="details-footer-summary truncate" title={footerSummary}>{footerSummary}</span>
                    <IconButton icon="info" className="details-info-toggle"
                        label={showInformation ? 'Hide information' : 'Show information'}
                        title={`${showInformation ? 'Hide' : 'Show'} information (Ctrl+Alt+I)`}
                        aria-keyshortcuts="Control+Alt+i Meta+Alt+i"
                        aria-expanded={showInformation} aria-controls="explorer-file-information"
                        onClick={() => setShowInformation(visible => !visible)} />
                </div>
            </> : <div className="details-empty">
                <p>{isMultipleSelection
                    ? 'Multiple items selected. Select a single item to view its preview.'
                    : 'Select an item to view its preview.'}</p>
            </div>)}
        </div>
    );
};

export default DetailsPanel;
