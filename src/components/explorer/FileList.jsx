import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getFileType } from '../../utils/formatters';
import { useFileSystem } from '../../providers/FileSystemProvider';
import { useContextMenu } from '../../providers/ContextMenuProvider';
import { showError } from '../../utils/NotificationSystem';
import FileItem from './FileItem';
import EmptyState from './EmptyState';
import IconButton from '../common/IconButton';
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
 * @param {boolean} [props.isPreviewPanelOpen=false] - Whether the preview panel is open
 * @param {Function} [props.onPreviewPanelToggle] - Callback to toggle the preview panel
 * @returns {React.ReactElement} File list component
 */
const FileList = ({ data, isLoading, viewMode = 'grid', isSearching = false, searchTerm = '', disableArrowKeys = false, onColumnsChange, isPreviewPanelOpen = false, onPreviewPanelToggle }) => {
    const { selectedItems, selectItem, selectMultiple, loadDirectory, clearSelection, focusedItem, setFocusedItem, openFile } = useFileSystem();
    const { openContextMenu } = useContextMenu();
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
    const [columnsPerRow, setColumnsPerRow] = useState(4); // Dynamic column calculation
    const [gridZoom, setGridZoom] = useState(100);
    const [columnWidths, setColumnWidths] = useState(() =>
        Object.fromEntries(LIST_COLUMNS.map(column => [column.key, column.width])));
    const columnResize = useRef(null);
    const containerRef = useRef(null);
    const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
    const [selectionBox, setSelectionBox] = useState(null);
    const selectionDrag = useRef(null);
    const suppressDragClick = useRef(false);

    const handleColumnResizeStart = (event, column) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        columnResize.current = { column, x: event.clientX, width: columnWidths[column.key], pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleColumnResizeMove = (event) => {
        const drag = columnResize.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const width = Math.max(drag.column.minWidth, Math.min(MAX_COLUMN_WIDTH, Math.round(drag.width + event.clientX - drag.x)));
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
        const delta = event.key === 'ArrowLeft' ? -10 : 10;
        setColumnWidths(widths => ({ ...widths, [column.key]: Math.max(column.minWidth, Math.min(MAX_COLUMN_WIDTH, widths[column.key] + delta)) }));
    };

    const changeGridZoom = useCallback((direction) => {
        setGridZoom(zoom => Math.max(50, Math.min(250, zoom + direction * 10)));
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (viewMode !== 'grid' || !container) return;

        const handleWheel = (event) => {
            if (!event.ctrlKey || event.altKey || event.deltaY === 0) return;
            event.preventDefault();
            event.stopPropagation();
            changeGridZoom(event.deltaY < 0 ? 1 : -1);
        };
        const handleZoomKey = (event) => {
            if (!event.ctrlKey || event.altKey || event.target.isContentEditable ||
                event.target.closest?.('input, textarea, select, [role="dialog"], .modal-overlay, .enhanced-terminal')) return;
            let direction;
            if (event.key === '+' || event.key === '=') direction = 1;
            else if (event.key === '-' || event.key === '_') direction = -1;
            else return;
            event.preventDefault();
            event.stopPropagation();
            changeGridZoom(direction);
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('keydown', handleZoomKey, true);
        return () => {
            container.removeEventListener('wheel', handleWheel);
            window.removeEventListener('keydown', handleZoomKey, true);
        };
    }, [viewMode, data, isLoading, changeGridZoom]);

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
        if (viewMode !== 'grid' || event.button !== 0 || event.pointerType !== 'mouse' ||
            event.target.closest('[data-path]')) return;
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
    }, [viewMode, data, gridZoom, calculateColumnsPerRow]);

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
            if (e.target.closest?.('.enhanced-terminal')) return;

            // Don't handle arrow keys if user is typing in an input or textarea
            if (e.target instanceof HTMLInputElement || 
                e.target instanceof HTMLTextAreaElement || 
                e.target.isContentEditable ||
                disableArrowKeys) {
                return;
            }

            // Handle arrow key navigation for focused item
            if (sortedItems && sortedItems.length > 0) {
                const currentFocusedIndex = focusedItem 
                    ? sortedItems.findIndex(item => item.path === focusedItem.path)
                    : -1;

                let newFocusedIndex = currentFocusedIndex;
                let moved = false;

                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        if (viewMode === 'grid') {
                            newFocusedIndex = currentFocusedIndex + columnsPerRow;
                            if (newFocusedIndex < sortedItems.length) {
                                setFocusedItem(sortedItems[newFocusedIndex]);
                                moved = true;
                            } else {
                                const remainder = currentFocusedIndex % columnsPerRow;
                                setFocusedItem(sortedItems[remainder]);
                                newFocusedIndex = remainder;
                                moved = true;
                            }
                        } else {
                            newFocusedIndex = currentFocusedIndex < sortedItems.length - 1 
                                ? currentFocusedIndex + 1 
                                : 0;
                            setFocusedItem(sortedItems[newFocusedIndex]);
                            moved = true;
                        }
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        if (viewMode === 'grid') {
                            newFocusedIndex = currentFocusedIndex - columnsPerRow;
                            if (newFocusedIndex >= 0) {
                                setFocusedItem(sortedItems[newFocusedIndex]);
                                moved = true;
                            } else {
                                const remainder = currentFocusedIndex % columnsPerRow;
                                const totalRows = Math.ceil(sortedItems.length / columnsPerRow);
                                const lastRowStartIndex = (totalRows - 1) * columnsPerRow;
                                const targetIndex = Math.min(lastRowStartIndex + remainder, sortedItems.length - 1);
                                setFocusedItem(sortedItems[targetIndex]);
                                newFocusedIndex = targetIndex;
                                moved = true;
                            }
                        } else {
                            newFocusedIndex = currentFocusedIndex > 0 
                                ? currentFocusedIndex - 1 
                                : sortedItems.length - 1;
                            setFocusedItem(sortedItems[newFocusedIndex]);
                            moved = true;
                        }
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        if (viewMode === 'grid') {
                            if (currentFocusedIndex < sortedItems.length - 1) {
                                newFocusedIndex = currentFocusedIndex + 1;
                                setFocusedItem(sortedItems[newFocusedIndex]);
                                moved = true;
                            }
                        } else {
                            newFocusedIndex = currentFocusedIndex < sortedItems.length - 1 
                                ? currentFocusedIndex + 1 
                                : 0;
                            setFocusedItem(sortedItems[newFocusedIndex]);
                            moved = true;
                        }
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        if (viewMode === 'grid') {
                            if (currentFocusedIndex > 0) {
                                newFocusedIndex = currentFocusedIndex - 1;
                                setFocusedItem(sortedItems[newFocusedIndex]);
                                moved = true;
                            }
                        } else {
                            newFocusedIndex = currentFocusedIndex > 0 
                                ? currentFocusedIndex - 1 
                                : sortedItems.length - 1;
                            setFocusedItem(sortedItems[newFocusedIndex]);
                            moved = true;
                        }
                        break;
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

                const item = sortedItems[newFocusedIndex];
                if (moved && item) {
                    const container = containerRef.current;
                    const element = container?.querySelectorAll('.file-item')[newFocusedIndex];
                    if (element) {
                        const containerBounds = container.getBoundingClientRect();
                        const itemBounds = element.getBoundingClientRect();
                        const headerHeight = container.querySelector('.file-list-header')?.getBoundingClientRect().height || 0;
                        const viewportTop = containerBounds.top + container.clientTop;
                        const visibleTop = viewportTop + headerHeight;
                        const visibleBottom = viewportTop + container.clientHeight;

                        if (itemBounds.top < visibleTop) {
                            container.scrollTop += itemBounds.top - visibleTop;
                        } else if (itemBounds.bottom > visibleBottom) {
                            container.scrollTop += itemBounds.bottom - visibleBottom;
                        }
                    }

                    if (e.shiftKey && lastSelectedIndex !== -1) {
                        // Shift+Arrow: select range from lastSelectedIndex to newFocusedIndex
                        const start = Math.min(lastSelectedIndex, newFocusedIndex);
                        const end = Math.max(lastSelectedIndex, newFocusedIndex);
                        const itemsToSelect = sortedItems.slice(start, end + 1);
                        clearSelection();
                        itemsToSelect.forEach(rangeItem => {
                            selectItem(rangeItem, true);
                        });
                    } else if (e.ctrlKey || e.metaKey) {
                        // Cmd/Ctrl+Arrow: add/remove focused item to selection
                        const isAlreadySelected = selectedItems.some(selected => selected.path === item.path);
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
                        setLastSelectedIndex(newFocusedIndex);
                    } else {
                        // No modifier: single selection
                        selectItem(item, false);
                        setLastSelectedIndex(newFocusedIndex);
                    }
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
    }, [selectItem, clearSelection, sortedItems, focusedItem, setFocusedItem, loadDirectory, viewMode, showError, disableArrowKeys, columnsPerRow]);

    /**
     * Clears selection when displayed data changes
     */

    // Track if this is the first mount or a navigation (not a deselection)
    const isFirstMount = useRef(true);
    const prevDataRef = useRef();

    useEffect(() => {
        // Only clear selection if the data object reference actually changed (navigation), not just selection
        if (prevDataRef.current !== data) {
            clearSelection();
            setLastSelectedIndex(-1);
            prevDataRef.current = data;
        }
    }, [data, clearSelection]);

    useEffect(() => {
        // Only focus first item on first mount or navigation, not after deselection
        if (sortedItems.length > 0 && !focusedItem && isFirstMount.current) {
            setFocusedItem(sortedItems[0]);
            isFirstMount.current = false;
        }
    }, [sortedItems, focusedItem, setFocusedItem]);

    const expandPreviewButton = !isPreviewPanelOpen && onPreviewPanelToggle && (
        <IconButton
            icon="chevron-left"
            className="file-list-preview-toggle"
            label="Expand preview panel"
            title="Expand preview panel (Space)"
            aria-expanded={false}
            aria-keyshortcuts="Space"
            onClick={onPreviewPanelToggle}
        />
    );

    // If data is null or loading, show loading state
    if (isLoading) {
        return (
            <div className={`file-list-wrapper${expandPreviewButton ? ' with-preview-toggle' : ''}`}>
                {expandPreviewButton}
                <div className="file-list-container">
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
            <div className={`file-list-wrapper${expandPreviewButton ? ' with-preview-toggle' : ''}`}>
                {expandPreviewButton}
                <div className="file-list-container">
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

            // Clear current selection and select range
            clearSelection();
            itemsToSelect.forEach(rangeItem => {
                selectItem(rangeItem, true);
            });
            setLastSelectedIndex(index);
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
        <div className={`file-list-wrapper${expandPreviewButton ? ' with-preview-toggle' : ''}`}>
            {expandPreviewButton}
            <div
                ref={containerRef}
                className={`file-list-container view-mode-${viewMode.toLowerCase()} scrollable-content`}
                style={{
                    '--file-grid-zoom': gridZoom / 100,
                    '--file-list-columns': LIST_COLUMNS.map(column => `${columnWidths[column.key]}px`).join(' '),
                    '--file-list-table-width': `${LIST_COLUMNS.reduce((width, column) => width + columnWidths[column.key], 0)}px`,
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
                                    aria-valuemin={column.minWidth}
                                    aria-valuemax={MAX_COLUMN_WIDTH}
                                    aria-valuenow={columnWidths[column.key]}
                                    aria-valuetext={`${columnWidths[column.key]} pixels`}
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

