import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { arrowSelection } from '../../utils/fileSelection';
import { focusItemPane, isEditingTarget } from '../../utils/explorerFocus';
import { getFileType } from '../../utils/formatters';
import { useFileSystem } from '../../providers/FileSystemProvider';
import { useContextMenu } from '../../providers/ContextMenuProvider';
import { useHistory } from '../../providers/HistoryProvider';
import { showError } from '../../utils/NotificationSystem';
import FileItem from './FileItem';
import EmptyState from './EmptyState';
import './fileList.css';

const LIST_COLUMNS = [
    { key: 'name', label: 'Name', className: 'column-name', width: 240, minWidth: 120 },
    { key: 'size_in_bytes', label: 'Size', className: 'column-size', width: 96, minWidth: 64 },
    { key: 'type', label: 'Type', className: 'column-type', width: 128, minWidth: 80 },
    { key: 'last_modified', label: 'Modified', className: 'column-modified', width: 168, minWidth: 100 },
];
const MAX_COLUMN_WIDTH = 2000;

/**
 * Component to display a list of files and directories
 * @param {Object} props - Component properties
 * @param {Object} props.data - The file/directory data to display
 * @param {boolean} props.isLoading - Whether the file list is currently loading
 * @param {string} [props.viewMode='grid'] - Display mode: 'grid', 'list', or 'details'
 * @param {boolean} [props.isSearching=false] - Whether the list is showing search results
 * @param {string} [props.searchTerm=''] - The search term being used
 * @param {boolean} [props.disableArrowKeys=false] - Whether to disable arrow key navigation
 * @param {Function} [props.onColumnsChange] - Callback when columns per row changes
 * @returns {React.ReactElement} File list component
 */
const FileList = ({ data, isLoading, viewMode = 'grid', isSearching = false, searchTerm = '', disableArrowKeys = false, onColumnsChange }) => {
    const { selectedItems, selectItem, selectMultiple, loadDirectory, clearSelection, focusedItem, setFocusedItem, openFile } = useFileSystem();
    const { openContextMenu } = useContextMenu();
    const { currentPath, getDirectoryViewState, saveDirectoryViewState } = useHistory();
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
    const [columnsPerRow, setColumnsPerRow] = useState(4); // Dynamic column calculation
    const [viewZoom, setViewZoom] = useState(100);
    const viewZoomValue = useRef(100);
    const viewZoomTarget = useRef(100);
    const viewZoomFrame = useRef(null);
    const listZoom = viewMode === 'list' ? viewZoom / 100 : 1;
    const [columnWidths, setColumnWidths] = useState(() =>
        Object.fromEntries(LIST_COLUMNS.map(column => [column.key, column.width])));
    const columnResize = useRef(null);
    const containerRef = useRef(null);
    const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
    const [selectionBox, setSelectionBox] = useState(null);
    const selectionDrag = useRef(null);
    const suppressDragClick = useRef(false);
    const previousListing = useRef(null);
    const restoringSelection = useRef(false);

    useEffect(() => {
        if (!isLoading && data?.directory === currentPath && !isEditingTarget(document.activeElement) &&
            !document.activeElement.closest?.('video, audio, object, iframe')) focusItemPane();
    }, [isLoading, data?.directory, currentPath]);

    const scrollItemIntoView = useCallback((index) => {
        const container = containerRef.current;
        const element = container?.querySelectorAll('.file-item')[index];
        if (!element) return;
        const bounds = container.getBoundingClientRect();
        const itemBounds = element.getBoundingClientRect();
        const headerHeight = container.querySelector('.file-list-header')?.getBoundingClientRect().height || 0;
        const viewportTop = bounds.top + container.clientTop;
        const visibleTop = viewportTop + headerHeight;
        const visibleBottom = viewportTop + container.clientHeight;
        if (itemBounds.top < visibleTop) container.scrollTop += itemBounds.top - visibleTop;
        else if (itemBounds.bottom > visibleBottom) container.scrollTop += itemBounds.bottom - visibleBottom;
    }, []);

    const rememberScrollPosition = (event) => {
        const path = data?.directory || currentPath;
        if (event.target !== event.currentTarget || isLoading || isSearching ||
            path !== currentPath || previousListing.current?.data !== data) return;
        const saved = getDirectoryViewState(path);
        if (saved) saveDirectoryViewState(path, {
            ...saved, scrollTop: event.currentTarget.scrollTop, scrollLeft: event.currentTarget.scrollLeft
        });
    };

    const handleColumnResizeStart = (event, column) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        columnResize.current = { column, x: event.clientX, width: columnWidths[column.key], zoom: listZoom, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleColumnResizeMove = (event) => {
        const drag = columnResize.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const width = Math.max(drag.column.minWidth, Math.min(MAX_COLUMN_WIDTH, Math.round(drag.width + (event.clientX - drag.x) / drag.zoom)));
        setColumnWidths(widths => ({ ...widths, [drag.column.key]: width }));
    };

    const handleColumnResizeEnd = (event) => {
        if (columnResize.current?.pointerId !== event.pointerId) return;
        if (event.type === 'pointerup') handleColumnResizeMove(event);
        columnResize.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleColumnResizeKey = (event, column) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        const delta = (event.key === 'ArrowLeft' ? -10 : 10) / listZoom;
        setColumnWidths(widths => ({ ...widths, [column.key]: Math.max(column.minWidth, Math.min(MAX_COLUMN_WIDTH, widths[column.key] + delta)) }));
    };

    const changeViewZoom = useCallback((delta) => {
        viewZoomTarget.current = Math.max(50, Math.min(1000, viewZoomTarget.current + delta));
        if (viewZoomFrame.current !== null) return;

        let previousTime = performance.now();
        const animate = (time) => {
            const elapsed = Math.max(0, Math.min(64, time - previousTime));
            previousTime = time;
            const remaining = viewZoomTarget.current - viewZoomValue.current;
            const finished = Math.abs(remaining) < 0.02;
            viewZoomValue.current = finished ? viewZoomTarget.current
                : viewZoomValue.current + remaining * (1 - Math.exp(-elapsed / 65));
            setViewZoom(viewZoomValue.current);
            viewZoomFrame.current = finished ? null : requestAnimationFrame(animate);
        };
        viewZoomFrame.current = requestAnimationFrame(animate);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!['grid', 'list'].includes(viewMode) || !container) return;

        const handleWheel = (event) => {
            if (!event.ctrlKey || event.altKey || event.deltaY === 0) return;
            event.preventDefault();
            event.stopPropagation();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
            const pixels = Math.max(-100, Math.min(100, event.deltaY * unit));
            // Proportional steps give finer control at small sizes and accelerate at large sizes.
            changeViewZoom(viewZoomTarget.current * Math.expm1(-pixels * 0.0005));
        };
        const handleZoomKey = (event) => {
            if (!event.ctrlKey || event.altKey || event.target.isContentEditable ||
                event.target.closest?.('input, textarea, select, [role="dialog"], .modal-overlay, #explorer-preview-panel')) return;
            let direction;
            if (event.key === '+' || event.key === '=') direction = 1;
            else if (event.key === '-' || event.key === '_') direction = -1;
            else return;
            event.preventDefault();
            event.stopPropagation();
            changeViewZoom(direction * 10);
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('keydown', handleZoomKey, true);
        return () => {
            container.removeEventListener('wheel', handleWheel);
            window.removeEventListener('keydown', handleZoomKey, true);
            if (viewZoomFrame.current !== null) cancelAnimationFrame(viewZoomFrame.current);
            viewZoomFrame.current = null;
            viewZoomTarget.current = viewZoomValue.current;
        };
    }, [viewMode, data, isLoading, changeViewZoom]);

    useEffect(() => {
        selectionDrag.current = null;
        setSelectionBox(null);
        const container = containerRef.current;
        return () => {
            const drag = selectionDrag.current;
            selectionDrag.current = null;
            if (drag && container?.hasPointerCapture(drag.pointerId)) {
                container.releasePointerCapture(drag.pointerId);
            }
        };
    }, [data, viewMode, isLoading]);

    const handleSelectionStart = (event) => {
        suppressDragClick.current = false;
        if (!['grid', 'list'].includes(viewMode) || event.button !== 0 || event.pointerType !== 'mouse' ||
            event.target.closest('[data-path], .file-list-header')) return;
        const container = event.currentTarget;
        const bounds = container.getBoundingClientRect();
        const x = event.clientX - bounds.left - container.clientLeft;
        const y = event.clientY - bounds.top - container.clientTop;
        if (x < 0 || y < 0 || x >= container.clientWidth || y >= container.clientHeight) return;
        event.preventDefault();
        selectionDrag.current = {
            pointerId: event.pointerId,
            startX: x + container.scrollLeft,
            startY: y + container.scrollTop,
            clientX: event.clientX,
            clientY: event.clientY,
            initialItems: selectedItems,
            initialFocus: focusedItem,
            initialIndex: lastSelectedIndex,
            additive: event.ctrlKey || event.metaKey || event.shiftKey,
            active: false,
            items: getSortedData(),
        };
        container.setPointerCapture(event.pointerId);
    };

    const updateRegionSelection = () => {
        const drag = selectionDrag.current;
        const container = containerRef.current;
        if (!drag || !container) return;
        const bounds = container.getBoundingClientRect();
        const originX = bounds.left + container.clientLeft;
        const originY = bounds.top + container.clientTop;
        const x = Math.max(0, Math.min(container.clientWidth, drag.clientX - originX)) + container.scrollLeft;
        const y = Math.max(0, Math.min(container.clientHeight, drag.clientY - originY)) + container.scrollTop;
        if (!drag.active && Math.hypot(x - drag.startX, y - drag.startY) < 4) return;
        drag.active = true;
        const left = Math.min(drag.startX, x);
        const top = Math.min(drag.startY, y);
        const right = Math.max(drag.startX, x);
        const bottom = Math.max(drag.startY, y);
        setSelectionBox({ left, top, width: right - left, height: bottom - top });
        const paths = new Set(drag.additive ? drag.initialItems.map(item => item.path) : []);
        container.querySelectorAll('.file-item[data-path]').forEach(element => {
            const rect = element.getBoundingClientRect();
            const itemLeft = rect.left - originX + container.scrollLeft;
            const itemTop = rect.top - originY + container.scrollTop;
            if (itemLeft < right && itemLeft + rect.width > left &&
                itemTop < bottom && itemTop + rect.height > top) {
                paths.add(element.dataset.path);
            }
        });
        const items = drag.items.filter(item => paths.has(item.path));
        selectMultiple(items);
        setFocusedItem(items.at(-1) || null);
        setLastSelectedIndex(items.length ? drag.items.indexOf(items.at(-1)) : -1);
    };

    const handleSelectionMove = (event) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.clientX = event.clientX;
        drag.clientY = event.clientY;
        updateRegionSelection();
    };

    const handleSelectionEnd = (event) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.type === 'pointerup') handleSelectionMove(event);
        else if (drag.active) {
            selectMultiple(drag.initialItems);
            setFocusedItem(drag.initialFocus);
            setLastSelectedIndex(drag.initialIndex);
        }
        suppressDragClick.current = drag.active;
        selectionDrag.current = null;
        setSelectionBox(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleSelectionClick = (event) => {
        if (!suppressDragClick.current || event.detail === 0) return;
        suppressDragClick.current = false;
        event.preventDefault();
        event.stopPropagation();
    };

    /**
     * Calculate columns per row based on container width and item size
     */
    const calculateColumnsPerRow = useCallback(() => {
        if (!containerRef.current || viewMode !== 'grid') {
            setColumnsPerRow(1);
            onColumnsChange?.(1);
            return;
        }

        const container = containerRef.current;
        
        // Try to get computed styles first
        const computedStyle = window.getComputedStyle(container.querySelector('.file-list') || container);
        const gridTemplateColumns = computedStyle.getPropertyValue('grid-template-columns');
        
        // If CSS Grid is being used, count the columns from grid-template-columns
        if (gridTemplateColumns && gridTemplateColumns !== 'none') {
            const columns = gridTemplateColumns.split(' ').length;
            setColumnsPerRow(columns);
            onColumnsChange?.(columns);
            return;
        }
        
        // Fallback: Calculate based on container width
        const containerWidth = container.offsetWidth || container.clientWidth;
        
        if (containerWidth === 0) {
            // Container not ready yet, use default
            setColumnsPerRow(4);
            onColumnsChange?.(4);
            return;
        }
        
        // Try counting actual file items in the DOM
        const fileItems = container.querySelectorAll('[data-path]');
        if (fileItems.length >= 2) {
            const firstItem = fileItems[0];
            const firstItemRect = firstItem.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            let columnsInFirstRow = 1;
            for (let i = 1; i < fileItems.length; i++) {
                const itemRect = fileItems[i].getBoundingClientRect();
                if (Math.abs(itemRect.top - firstItemRect.top) < 10) {
                    // Same row (within 10px tolerance)
                    columnsInFirstRow++;
                } else {
                    // Different row, stop counting
                    break;
                }
            }
            
            if (columnsInFirstRow > 1) {
                setColumnsPerRow(columnsInFirstRow);
                onColumnsChange?.(columnsInFirstRow);
                return;
            }
        }
        
        // More conservative estimates for item width
        const estimatedItemWidth = 160;
        const gap = 12;
        const padding = 32;
        
        const availableWidth = containerWidth - padding;
        const columns = Math.max(1, Math.floor((availableWidth + gap) / (estimatedItemWidth + gap)));
        
        setColumnsPerRow(columns);
        onColumnsChange?.(columns);
    }, [viewMode, onColumnsChange]);

    // Calculate columns on mount and resize
    useEffect(() => {
        calculateColumnsPerRow();
        
        const handleResize = () => {
            setTimeout(calculateColumnsPerRow, 100);
        };
        
        window.addEventListener('resize', handleResize);
        
        // Use ResizeObserver if available for more accurate detection
        let resizeObserver;
        if (containerRef.current && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                setTimeout(calculateColumnsPerRow, 50);
            });
            resizeObserver.observe(containerRef.current);
        }
        
        return () => {
            window.removeEventListener('resize', handleResize);
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, [calculateColumnsPerRow]);

    // Also recalculate when view mode changes or data changes
    useEffect(() => {
        setTimeout(calculateColumnsPerRow, 100);
    }, [viewMode, data, viewZoom, calculateColumnsPerRow]);

    /**
     * Returns sorted data based on current sort configuration
     * @returns {Array} Sorted array of files and directories
     */
    const getSortedData = () => {
        if (!data || (!data.directories?.length && !data.files?.length)) {
            return [];
        }

        const { key, direction } = sortConfig;

        // Combine directories and files for sorting
        const combinedItems = [
            ...(data.directories || []).map(dir => ({ ...dir, isDirectory: true })),
            ...(data.files || []).map(file => ({ ...file, isDirectory: false }))
        ];

        // Always put directories first
        const sortedItems = [...combinedItems].sort((a, b) => {
            if (a.isParentNavigation) return -1;
            if (b.isParentNavigation) return 1;
            // Directories always come before files
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;

            let aValue, bValue;
            if (key === 'size_in_bytes') {
                // Folders: always sort as 0 (or -1) so they group together and don't mix with files
                aValue = a.isDirectory ? -1 : a.size_in_bytes || 0;
                bValue = b.isDirectory ? -1 : b.size_in_bytes || 0;
            } else if (key === 'type') {
                // Folders: always 'Folder', Files: use getFileType
                aValue = a.isDirectory ? 'Folder' : (a.name ? getFileType(a.name) : '');
                bValue = b.isDirectory ? 'Folder' : (b.name ? getFileType(b.name) : '');
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            } else if (key === 'created' || key === 'last_modified' || key === 'accessed') {
                aValue = new Date(a[key]).getTime();
                bValue = new Date(b[key]).getTime();
            } else {
                aValue = a[key];
                bValue = b[key];
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                }
            }

            if (aValue < bValue) return direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sortedItems;
    };

    /**
     * Handles click on the container (empty space)
     * @param {React.MouseEvent} e - The click event
     */
    const handleContainerClick = (e) => {
        // Clear clicks on empty list space, but preserve item and sorting interactions
        if (e.detail !== 0 && !e.target.closest('[data-path]') && !e.target.closest('.file-list-header')) {
            clearSelection();
            setLastSelectedIndex(-1);
        }
    };

    /**
     * Handles right-click context menu
     * @param {React.MouseEvent} e - The context menu event
     */
    const handleContextMenu = (e) => {
        // Always prevent default browser context menu in our container
        e.preventDefault();
        e.stopPropagation();

        const currentSortedItems = getSortedData();
        
        // Determine if we clicked on an item or empty space
        const clickedItem = e.target.closest('[data-path]');
        const item = clickedItem ? currentSortedItems.find(item => item.path === clickedItem.dataset.path) : null;

        openContextMenu(e, item);
    };

    // Get sorted data - call this before useEffects that need it
    const sortedItems = getSortedData();

    /**
     * Sets up keyboard event listeners for multi-selection
     */
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isLoading || (data?.directory && data.directory !== currentPath)) return;
            const isArrow = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key);
            // Don't handle arrow keys if user is typing in an input or textarea
            if (e.defaultPrevented || document.querySelector('[role="dialog"], .modal-overlay') ||
                e.isComposing || e.altKey || e.target.closest?.('select, [role="dialog"], video, audio, object, iframe') ||
                (!isArrow && e.target.closest?.('button, [role="button"]')) ||
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement || 
                e.target.isContentEditable ||
                (e.target.closest?.('#explorer-preview-panel') &&
                    !e.target.closest?.('.details-resize-handle, .details-split-handle')) ||
                disableArrowKeys) {
                return;
            }

            // Handle arrow key navigation for focused item
            if (sortedItems && sortedItems.length > 0) {
                const currentFocusedIndex = focusedItem 
                    ? sortedItems.findIndex(item => item.path === focusedItem.path)
                    : -1;

                const range = isArrow ? arrowSelection({
                    current: currentFocusedIndex, anchor: lastSelectedIndex, key: e.key,
                    columns: viewMode === 'grid' ? columnsPerRow : 1, count: sortedItems.length,
                }) : null;

                if (range) {
                    e.preventDefault();
                    focusItemPane();
                    const item = sortedItems[range.index];
                    if (e.shiftKey) {
                        selectMultiple(sortedItems.slice(range.start, range.end + 1));
                        setLastSelectedIndex(range.anchor);
                    } else if (!e.ctrlKey && !e.metaKey) {
                        selectItem(item, false);
                        setLastSelectedIndex(range.index);
                    }
                    setFocusedItem(item);
                    scrollItemIntoView(range.index);
                }

                switch (e.key) {
                    case 'Enter':
                        if (focusedItem) {
                            e.preventDefault();
                            if (focusedItem.isDirectory) {
                                loadDirectory(focusedItem.path);
                            } else {
                                openFile(focusedItem.path);
                            }
                        }
                        break;
                }
            }
        };

        /**
         * Prevents default browser context menu while allowing scrolling
         * @param {MouseEvent} e - The mouse event
         */
        const preventDefaultContextMenu = (e) => {
            // Only prevent if the target is within our file list AND it's actually a right-click
            if (e.button === 2 && (e.target.closest('.file-list-container') || e.target.closest('.empty-state-container'))) {
                e.preventDefault();
            }
        };

        /**
         * Handles select-item events from context menu
         * @param {CustomEvent} e - The custom event
         */
        const handleSelectItem = (e) => {
            if (e.detail && e.detail.item) {
                selectItem(e.detail.item, false);
                setLastSelectedIndex(sortedItems.findIndex(item => item.path === e.detail.item.path));
            }
        };

        /**
         * Handles clear selection events
         */
        const handleClearSelection = () => {
            clearSelection();
            setLastSelectedIndex(-1);
        };

        // Use passive listeners where possible to improve scroll performance
        // Note: keydown cannot be passive because we need preventDefault for arrow keys
        window.addEventListener('keydown', handleKeyDown, { passive: false });
        window.addEventListener('mousedown', preventDefaultContextMenu, { passive: false });
        document.addEventListener('select-item', handleSelectItem);
        document.addEventListener('clear-selection', handleClearSelection);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mousedown', preventDefaultContextMenu);
            document.removeEventListener('select-item', handleSelectItem);
            document.removeEventListener('clear-selection', handleClearSelection);
        };
    }, [selectItem, selectMultiple, clearSelection, lastSelectedIndex, sortedItems, focusedItem, setFocusedItem, loadDirectory, openFile, viewMode, showError, disableArrowKeys, columnsPerRow, isLoading, data, currentPath, scrollItemIntoView]);

    // Restore only after the requested folder's listing has finished loading.
    useLayoutEffect(() => {
        const path = isSearching ? null : data?.directory || currentPath;
        if (isLoading) {
            previousListing.current = null;
            return;
        }
        if (!data || (path && path !== currentPath)) return;
        if (previousListing.current?.data === data && previousListing.current.path === path) return;
        previousListing.current = { data, path };
        restoringSelection.current = true;

        const saved = path ? getDirectoryViewState(path) : null;
        const selectedPaths = new Set(saved?.selectedPaths || []);
        let selection = sortedItems.filter(item => selectedPaths.has(item.path));
        const focus = sortedItems.find(item => item.path === saved?.focusedPath) ||
            selection[0] || sortedItems[0] || null;
        if (!selection.length && focus) selection = [focus];
        selectMultiple(selection);
        setFocusedItem(focus);
        const focusIndex = focus ? sortedItems.findIndex(item => item.path === focus.path) : -1;
        const anchorIndex = sortedItems.findIndex(item => item.path === saved?.anchorPath);
        setLastSelectedIndex(anchorIndex >= 0 ? anchorIndex : focusIndex);

        if (containerRef.current) {
            containerRef.current.scrollTop = saved?.scrollTop || 0;
            containerRef.current.scrollLeft = saved?.scrollLeft || 0;
            scrollItemIntoView(focusIndex);
        }
    }, [data, isLoading, isSearching, currentPath, sortedItems, getDirectoryViewState,
        selectMultiple, setFocusedItem, scrollItemIntoView]);

    useLayoutEffect(() => {
        if (restoringSelection.current) {
            restoringSelection.current = false;
            return;
        }
        const path = data?.directory || currentPath;
        if (isLoading || isSearching || !data || path !== currentPath ||
            previousListing.current?.data !== data) return;
        saveDirectoryViewState(path, {
            selectedPaths: selectedItems.map(item => item.path),
            focusedPath: focusedItem?.path || null,
            anchorPath: sortedItems[lastSelectedIndex]?.path || null,
            scrollTop: containerRef.current?.scrollTop || 0,
            scrollLeft: containerRef.current?.scrollLeft || 0
        });
    }, [data, isLoading, isSearching, currentPath, selectedItems, focusedItem,
        lastSelectedIndex, sortedItems, saveDirectoryViewState]);

    // If data is null or loading, show loading state
    if (isLoading) {
        return (
            <div className="file-list-wrapper">
                <div className="file-list-container" tabIndex={-1}>
                    <div className="loading-state">
                        <div className="loading-spinner"></div>
                        <p>Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    // If data is empty, show empty state
    if (!data || (!data.directories?.length && !data.files?.length)) {
        return (
            <div className="file-list-wrapper">
                <div className="file-list-container" tabIndex={-1}>
                    <div
                        className="empty-state-container"
                        onClick={handleContainerClick}
                        onContextMenu={handleContextMenu}
                        style={{ height: '100%', width: '100%' }}
                    >
                        <EmptyState
                            type={isSearching ? 'no-results' : 'empty-folder'}
                            searchTerm={isSearching ? searchTerm : undefined}
                        />
                    </div>
                </div>
            </div>
        );
    }

    /**
     * Handles changing the sort column/direction
     * @param {string} key - The column key to sort by
     */
    const handleSort = (key) => {
        setLastSelectedIndex(-1);
        setSortConfig(prevConfig => {
            // If clicking the same column, toggle direction
            if (prevConfig.key === key) {
                return {
                    ...prevConfig,
                    direction: prevConfig.direction === 'asc' ? 'desc' : 'asc'
                };
            }

            // Otherwise, sort by the new column in ascending order
            return { key, direction: 'asc' };
        });
    };

    /**
     * Handles item click (selection and opening)
     * @param {Object} item - The clicked item
     * @param {number} index - Index of the clicked item
     * @param {React.MouseEvent} event - Click event with current modifier keys
     * @param {boolean} [isDoubleClick=false] - Whether this is a double-click
     */
    const handleItemClick = (item, index, event, isDoubleClick = false) => {
        focusItemPane();
        // Always set the focused item when clicking on it
        setFocusedItem(item);

        // For double-click, open the item
        if (isDoubleClick) {
            if (item.isDirectory) {
                loadDirectory(item.path);
            } else {
                openFile(item.path);
            }
            return;
        }

        // For single click, handle selection
        const isAlreadySelected = selectedItems.some(selected => selected.path === item.path);

        if (event.shiftKey && lastSelectedIndex !== -1) {
            // Multi-select with shift key
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const itemsToSelect = sortedItems.slice(start, end + 1);

            selectMultiple(itemsToSelect);
        } else if (event.ctrlKey || event.metaKey) {
            // Toggle selection with Ctrl key
            if (isAlreadySelected) {
                // Deselect by clearing and re-selecting others
                const otherSelected = selectedItems.filter(selected => selected.path !== item.path);
                clearSelection();
                otherSelected.forEach(otherItem => {
                    selectItem(otherItem, true);
                });
            } else {
                selectItem(item, true);
            }
            setLastSelectedIndex(index);
        } else {
            // Single selection
            if (isAlreadySelected && selectedItems.length === 1) {
                // If clicking on the only selected item, deselect it
                clearSelection();
                setLastSelectedIndex(-1);
            } else {
                selectItem(item, false);
                setLastSelectedIndex(index);
            }
        }
    };

    return (
        <div className="file-list-wrapper">
            <div
                ref={containerRef}
                tabIndex={-1}
                className={`file-list-container view-mode-${viewMode.toLowerCase()} scrollable-content`}
                style={{
                    '--file-grid-zoom': viewZoom / 100,
                    '--file-list-zoom': listZoom,
                    '--file-list-columns': LIST_COLUMNS.map(column => `${columnWidths[column.key] * listZoom}px`).join(' '),
                    '--file-list-table-width': `${LIST_COLUMNS.reduce((width, column) => width + columnWidths[column.key] * listZoom, 0)}px`,
                }}
                role={viewMode === 'list' ? 'table' : undefined}
                aria-label={viewMode === 'list' ? 'Files' : undefined}
                onClick={handleContainerClick}
                onContextMenu={handleContextMenu}
                onPointerDown={handleSelectionStart}
                onPointerMove={handleSelectionMove}
                onPointerUp={handleSelectionEnd}
                onPointerCancel={handleSelectionEnd}
                onLostPointerCapture={handleSelectionEnd}
                onScrollCapture={updateRegionSelection}
                onScroll={rememberScrollPosition}
                onClickCapture={handleSelectionClick}
            >
                {viewMode === 'list' && (
                    <div
                        className="file-list-header"
                        role="row"
                        onKeyDown={(event) => {
                            if (['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation();
                        }}
                    >
                        {LIST_COLUMNS.map(column => (
                            <div
                                key={column.key}
                                className={`file-list-column ${column.className}`}
                                role="columnheader"
                                aria-sort={sortConfig.key === column.key ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                                <button type="button" className="file-column-sort" onClick={() => handleSort(column.key)}>
                                    {column.label}
                                    {sortConfig.key === column.key && <span className={`sort-icon sort-${sortConfig.direction}`} aria-hidden="true"></span>}
                                </button>
                                <div
                                    className="file-column-resize"
                                    role="separator"
                                    aria-label={`Resize ${column.label} column`}
                                    aria-orientation="vertical"
                                    aria-valuemin={Math.round(column.minWidth * listZoom)}
                                    aria-valuemax={Math.round(MAX_COLUMN_WIDTH * listZoom)}
                                    aria-valuenow={Math.round(columnWidths[column.key] * listZoom)}
                                    aria-valuetext={`${Math.round(columnWidths[column.key] * listZoom)} pixels`}
                                    tabIndex={0}
                                    onPointerDown={(event) => handleColumnResizeStart(event, column)}
                                    onPointerMove={handleColumnResizeMove}
                                    onPointerUp={handleColumnResizeEnd}
                                    onPointerCancel={handleColumnResizeEnd}
                                    onLostPointerCapture={handleColumnResizeEnd}
                                    onKeyDown={(event) => handleColumnResizeKey(event, column)}
                                />
                            </div>
                        ))}
                    </div>
                )}
                {/* Details view header with sortable columns */}
                {viewMode === 'details' && (
                    <div className="file-list-header">
                        <div
                            className={`file-list-column column-name ${sortConfig.key === 'name' ? `sorted-${sortConfig.direction}` : ''}`}
                            onClick={() => handleSort('name')}
                        >
                            Name
                            {sortConfig.key === 'name' && (
                                <span className={`sort-icon sort-${sortConfig.direction}`}></span>
                            )}
                        </div>
                        <div
                            className={`file-list-column column-size ${sortConfig.key === 'size_in_bytes' ? `sorted-${sortConfig.direction}` : ''}`}
                            onClick={() => handleSort('size_in_bytes')}
                        >
                            Size
                            {sortConfig.key === 'size_in_bytes' && (
                                <span className={`sort-icon sort-${sortConfig.direction}`}></span>
                            )}
                        </div>
                        <div
                            className={`file-list-column column-type ${sortConfig.key === 'type' ? `sorted-${sortConfig.direction}` : ''}`}
                            onClick={() => handleSort('type')}
                        >
                            Type
                            {sortConfig.key === 'type' && (
                                <span className={`sort-icon sort-${sortConfig.direction}`}></span>
                            )}
                        </div>
                        <div
                            className={`file-list-column column-modified ${sortConfig.key === 'last_modified' ? `sorted-${sortConfig.direction}` : ''}`}
                            onClick={() => handleSort('last_modified')}
                        >
                            Modified
                            {sortConfig.key === 'last_modified' && (
                                <span className={`sort-icon sort-${sortConfig.direction}`}></span>
                            )}
                        </div>
                    </div>
                )}

                {/* File list content */}
                <div className={`file-list view-mode-${viewMode.toLowerCase()} scrollable-content`} role={viewMode === 'list' ? 'rowgroup' : undefined}>
                    {sortedItems.map((item, index) => (
                        <FileItem
                            key={item.path}
                            item={item}
                            viewMode={viewMode}
                            thumbnailSize={viewMode === 'grid' ? (viewZoom > 700 ? 1024 : viewZoom > 350 ? 512 : 256) : 256}
                            isSelected={selectedItems.some(selected => selected.path === item.path)}
                            isFocused={focusedItem && focusedItem.path === item.path}
                            onClick={(event) => handleItemClick(item, index, event)}
                            onDoubleClick={(event) => handleItemClick(item, index, event, true)}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
                </div>
                {selectionBox && (
                    <div className="file-selection-region" style={selectionBox} aria-hidden="true" />
                )}
            </div>
        </div>
    );
};

export default FileList;

