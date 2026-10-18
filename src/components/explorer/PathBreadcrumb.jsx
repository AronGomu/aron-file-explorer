import React, { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useHistory } from '../../providers/HistoryProvider';
import { useFileSystem } from '../../providers/FileSystemProvider';
import { useSftp } from '../../providers/SftpProvider';
import { useSettings } from '../../providers/SettingsProvider';
import './pathBreadcrumb.css';
import { focusItemPane } from '../../utils/explorerFocus';
import useFileDropTarget from '../../hooks/useFileDropTarget';

/**
 * PathBreadcrumb component - Displays the current file path as interactive breadcrumbs
 * and provides path editing functionality
 *
 * @param {Object} props - Component props
 * @param {Function} [props.onCopyPath] - Callback function to copy the current path
 * @param {boolean} [props.isVisible=true] - Whether the breadcrumb is visible
 * @returns {React.ReactElement} PathBreadcrumb component
 */
const PathBreadcrumb = ({ onCopyPath, isVisible = true, onSearch, showHidden, directoriesOnly = false }) => {
    const dropTargetProps = useFileDropTarget();
    const { currentPath, navigateTo } = useHistory();
    const { loadDirectory, currentDirData, openFile } = useFileSystem();
    const { settings } = useSettings();
    const showHiddenPaths = showHidden ?? settings.show_hidden_files_and_folders;
    const { isSftpPath, parseSftpPath, createSftpUrl, createSftpPath, sftpConnections } = useSftp();
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const inputRef = useRef(null);
    const searchInputRef = useRef(null);
    const listRef = useRef(null);
    const listId = useId();
    const [completion, setCompletion] = useState({ input: null, entries: [], resolvedPath: '', error: '' });
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const [popupBounds, setPopupBounds] = useState(null);
    const [recentPaths, setRecentPaths] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('pathBarRecentFolders') || '[]');
            return Array.isArray(saved) ? saved.filter(path => typeof path === 'string').slice(0, 30) : [];
        } catch { return []; }
    });
    const suggestions = completion.input === editValue ? completion.entries : [];

    useEffect(() => {
        if (!currentPath || currentDirData?.directory !== currentPath || isSftpPath(currentPath)) return;
        setRecentPaths(previous => {
            const next = [currentPath, ...previous.filter(path => path !== currentPath)].slice(0, 30);
            try { localStorage.setItem('pathBarRecentFolders', JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
            return next;
        });
    }, [currentPath, currentDirData?.directory, isSftpPath]);

    useEffect(() => {
        if (!isEditing || !isVisible) return;
        let cancelled = false;
        setActiveSuggestion(0);
        const timer = setTimeout(async () => {
            try {
                // Remote paths retain their existing navigation; never send them to the local filesystem.
                if (isSftpPath(editValue)) {
                    if (!cancelled) setCompletion({ input: editValue, entries: [], resolvedPath: editValue, error: '' });
                    return;
                }
                const result = await invoke('complete_path', { input: editValue, currentPath, showHidden: showHiddenPaths, directoriesOnly });
                if (cancelled) return;
                const query = editValue.toLowerCase();
                const recent = !/[\\/]/.test(editValue) ? recentPaths.filter(path =>
                    (showHiddenPaths || !path.split(/[\\/]/).some(part => part.startsWith('.'))) &&
                    (!query || path.split(/[\\/]/).at(-1).toLowerCase().includes(query))
                ).map(path => ({
                    path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path, isDirectory: true, recent: true,
                })) : [];
                const seen = new Set();
                const entries = [...recent, ...result.entries].filter(entry => {
                    if (seen.has(entry.path)) return false;
                    seen.add(entry.path); return true;
                });
                setCompletion({ input: editValue, entries, resolvedPath: result.resolvedPath, error: '' });
            } catch {
                if (!cancelled) setCompletion({ input: editValue, entries: [], resolvedPath: '', error: 'Folder unavailable. Check the path or permissions.' });
            }
        }, 70);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [isEditing, isVisible, editValue, currentPath, showHiddenPaths, directoriesOnly, recentPaths, isSftpPath]);

    useLayoutEffect(() => {
        if (!isEditing || !isVisible) return;
        const position = () => {
            const rect = inputRef.current?.closest('.path-breadcrumb')?.getBoundingClientRect();
            if (rect) setPopupBounds({ left: rect.left, top: rect.bottom + 4, width: rect.width,
                maxHeight: Math.max(80, Math.min(360, window.innerHeight - rect.bottom - 12)) });
        };
        position();
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        const observer = new ResizeObserver(position);
        observer.observe(inputRef.current.closest('.path-breadcrumb'));
        return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); observer.disconnect(); };
    }, [isEditing, isVisible]);

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeSuggestion, completion]);

    useEffect(() => {
        if (!isVisible) return;
        const shortcuts = event => {
            if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], .modal-overlay')) return;
            const primary = event.ctrlKey || event.metaKey;
            if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
                event.preventDefault(); handleClick();
            } else if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
                event.preventDefault(); setIsEditing(false); setIsSearchVisible(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
            }
        };
        document.addEventListener('keydown', shortcuts);
        return () => document.removeEventListener('keydown', shortcuts);
    });

    /**
     * Parses the current path into segments for breadcrumb navigation
     * Handles Windows, Unix, and SFTP paths
     *
     * @returns {Array<{name: string, path: string, displayPath?: string}>} Array of path segments with display name and full path
     */
    const getPathSegments = () => {
        if (!currentPath) return [];

        const segments = [];
        let currentSegment = '';

        // Handle SFTP paths (sftp:connectionName:remotePath)
        if (isSftpPath(currentPath)) {
            const parsed = parseSftpPath(currentPath);
            if (parsed && parsed.connection) {
                // Add connection as root segment
                segments.push({
                    name: `${parsed.connection.username}@${parsed.connection.host}`,
                    path: `sftp:${parsed.connectionName}:.`,
                    displayPath: `sftp://${parsed.connection.username}@${parsed.connection.host}/`,
                });

                // Parse the remote path and add segments
                if (parsed.remotePath && parsed.remotePath !== '.') {
                    const pathParts = parsed.remotePath.split('/').filter(part => part && part !== '.');
                    let buildPath = parsed.remotePath.startsWith('/') ? '/' : '';
                    
                    for (let i = 0; i < pathParts.length; i++) {
                        buildPath += (buildPath && !buildPath.endsWith('/') ? '/' : '') + pathParts[i];
                        segments.push({
                            name: pathParts[i],
                            path: `sftp:${parsed.connectionName}:${buildPath}`,
                            displayPath: `sftp://${parsed.connection.username}@${parsed.connection.host}/${buildPath}`,
                        });
                    }
                }
            }
        }
        // Handle Windows paths (C:\path\to\folder)
        else if (currentPath.includes(':\\')) {
            const parts = currentPath.split('\\');

            // Add the drive letter (e.g., C:)
            segments.push({
                name: parts[0],
                path: parts[0] + '\\',
            });

            // Add the rest of the path
            for (let i = 1; i < parts.length; i++) {
                if (!parts[i]) continue;

                currentSegment += '\\' + parts[i];
                segments.push({
                    name: parts[i],
                    path: parts[0] + currentSegment,
                });
            }
        }
        // Handle Unix paths (/path/to/folder)
        else {
            const parts = currentPath.split('/');

            // Handle root directory
            if (parts[0] === '') {
                segments.push({
                    name: '/',
                    path: '/',
                });
                parts.shift(); // Remove empty string from beginning
            }

            // Add the rest of the path
            for (let i = 0; i < parts.length; i++) {
                if (!parts[i]) continue;

                currentSegment += '/' + parts[i];
                segments.push({
                    name: parts[i],
                    path: currentSegment,
                });
            }
        }

        return segments;
    };

    const pathSegments = getPathSegments();

    /**
     * Converts a standard SFTP URL back to internal format for navigation
     * @param {string} inputPath - The path entered by user (could be standard SFTP URL or internal format)
     * @returns {string} - Internal format path for navigation
     */
    const convertToInternalPath = (inputPath) => {
        // If it's already internal format or not SFTP, return as-is
        if (!inputPath.startsWith('sftp://')) {
            return inputPath;
        }
        
        try {
            const url = new URL(inputPath);
            const username = url.username;
            const hostname = url.hostname;
            const port = url.port || '22';
            const remotePath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
            
            // Find matching connection from saved connections
            const connection = sftpConnections.find(conn => 
                conn.username === username && 
                conn.host === hostname && 
                conn.port.toString() === port
            );
            
            if (connection) {
                return createSftpPath(connection, remotePath || '.');
            }
        } catch (error) {
            console.error('Failed to parse SFTP URL:', error);
        }
        
        // If conversion fails, return original input
        return inputPath;
    };

    /**
     * Enables path editing mode when clicking on the breadcrumb
     * For SFTP paths, shows the standard URL format for editing
     */
    const handleClick = () => {
        setIsEditing(true);
        
        // For SFTP paths, show standard URL format for editing
        if (isSftpPath(currentPath)) {
            const parsed = parseSftpPath(currentPath);
            if (parsed && parsed.connection) {
                const displayUrl = createSftpUrl(parsed.connection, parsed.remotePath);
                setEditValue(displayUrl || currentPath || '');
                return;
            }
        }
        
        setEditValue(currentPath || '');
    };

    /**
     * Handles keyboard events in the path input
     * - Enter: Navigate to the entered path (converts standard SFTP URLs to internal format)
     * - Escape: Cancel editing
     *
     * @param {React.KeyboardEvent} e - Keyboard event
     */
    const handleKeyDown = (e) => {
        if (e.nativeEvent.isComposing) return;
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
            e.preventDefault(); e.stopPropagation();
            setActiveSuggestion(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (e.key === 'Tab' && !e.shiftKey && suggestions.length) {
            e.preventDefault(); e.stopPropagation();
            const entry = suggestions[activeSuggestion];
            const separator = entry.path.includes('\\') ? '\\' : '/';
            setEditValue(entry.path + (entry.isDirectory && !entry.path.endsWith(separator) ? separator : ''));
            setActiveSuggestion(0);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            openSuggestion(suggestions[activeSuggestion]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setIsEditing(false);
            setEditValue(currentPath || '');
            requestAnimationFrame(focusItemPane);
        }
    };

    const openSuggestion = async entry => {
        let path = entry?.path;
        if (!path && editValue) {
            path = convertToInternalPath(editValue);
            if (!isSftpPath(path)) {
                try {
                    const result = completion.input === editValue && completion.resolvedPath ? completion :
                        await invoke('complete_path', { input: editValue, currentPath, showHidden: showHiddenPaths, directoriesOnly });
                    path = result.resolvedPath;
                } catch {
                    setCompletion({ input: editValue, entries: [], resolvedPath: '', error: 'Folder unavailable. Check the path or permissions.' });
                    return;
                }
            }
        }
        if (!path || !inputRef.current || inputRef.current.value !== editValue || document.activeElement !== inputRef.current) return;
        setIsEditing(false);
        if (entry && !entry.isDirectory) openFile(path);
        else if (path !== currentPath) loadDirectory(path);
        requestAnimationFrame(focusItemPane);
    };

    /**
     * Navigates to the selected path segment
     *
     * @param {string} path - Path to navigate to
     */
    const handleSegmentClick = (path) => {
        loadDirectory(path);
    };

    /**
     * Handles search icon click to show/hide search overlay
     */
    const handleSearchClick = () => {
        if (isSearchVisible) {
            // Clear search completely and return to breadcrumb view
            setSearchQuery('');
            if (onSearch) {
                onSearch('');
            }
            setIsSearchVisible(false);
            requestAnimationFrame(focusItemPane);
            setIsEditing(false); // Ensure we're not in editing mode
        } else {
            // Show search overlay and focus input
            setIsEditing(false); // Exit editing mode when starting search
            setIsSearchVisible(true);
            setTimeout(() => {
                if (searchInputRef.current) {
                    searchInputRef.current.focus();
                }
            }, 0);
        }
    };

    /**
     * Handles search input changes and performs local folder search
     */
    const handleSearchChange = (e) => {
        const query = e.target.value;
        setSearchQuery(query);
        
        // Perform local search like in MainLayout
        if (!query.trim()) {
            // Clear search results
            if (onSearch) {
                onSearch('');
            }
            return;
        }

        // Simple local search filtering current directory contents
        if (currentDirData && onSearch) {
            onSearch(query);
        }
    };

    /**
     * Handles search input key events
     */
    const handleSearchKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            // Clear search completely and return to breadcrumb view
            setSearchQuery('');
            if (onSearch) {
                onSearch('');
            }
            setIsSearchVisible(false);
            requestAnimationFrame(focusItemPane);
        }
    };

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    useEffect(() => {
        if (!isEditing) return;
        const dismissOnOutsidePointerDown = (event) => {
            const input = inputRef.current;
            if (!input || event.target.closest?.('.path-breadcrumb, .path-completions')) return;
            input.setSelectionRange(input.selectionEnd, input.selectionEnd);
            input.blur();
        };
        document.addEventListener('pointerdown', dismissOnOutsidePointerDown, true);
        return () => document.removeEventListener('pointerdown', dismissOnOutsidePointerDown, true);
    }, [isEditing]);

    // Update edit value when path changes
    useEffect(() => {
        setEditValue(currentPath || '');
        setSearchQuery('');
        setIsSearchVisible(false);
    }, [currentPath]);

    // Don't render full component if not visible
    if (!isVisible) {
        return <div className="path-breadcrumb-placeholder"></div>;
    }

    return (
        <div className="path-breadcrumb-container">
            <div className={`path-breadcrumb ${isEditing ? 'editing' : ''} ${isSearchVisible ? 'searching' : ''}`} onClick={!isEditing && !isSearchVisible ? (e) => {
                // Only handle click if it's not on the search icon button
                if (!e.target.closest('.search-icon-btn')) {
                    handleClick(e);
                }
            } : undefined}>
                {isSearchVisible ? (
                    <input
                        ref={searchInputRef}
                        className="path-search-input"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        onKeyDown={handleSearchKeyDown}
                        onBlur={(e) => {
                            // Delay blur handler to allow click handler to run first
                            setTimeout(() => {
                                if (!searchQuery.trim() && isSearchVisible) {
                                    // Clear search completely and return to breadcrumb view
                                    if (onSearch) {
                                        onSearch('');
                                    }
                                    setIsSearchVisible(false);
                                }
                            }, 100);
                        }}
                        placeholder="Search in current folder"
                        aria-label="Search in current folder"
                    />
                ) : isEditing ? (
                    <input
                        ref={inputRef}
                        className="path-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={() => setIsEditing(false)}
                        aria-label="Path input"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={Boolean(popupBounds)}
                        aria-controls={listId}
                        aria-activedescendant={suggestions.length ? `${listId}-${activeSuggestion}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                    />
                ) : (
                    <div className="breadcrumb-segments">
                        {pathSegments.map((segment, index) => (
                            <React.Fragment key={segment.path}>
                                {index > 0 && <span className="segment-divider">/</span>}
                                <button
                                    className={`segment-button ${segment.path === '/' ? 'root-segment' : ''} ${index === pathSegments.length - 1 ? 'current' : ''}`}
                                    aria-label={segment.path === '/' ? 'System root' : undefined}
                                    title={segment.path === '/' ? 'System root (/)' : undefined}
                                    {...dropTargetProps(segment.path)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSegmentClick(segment.path);
                                    }}
                                >
                                    {segment.path === '/' ? (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                                            <path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
                                            <path d="M6 16h.01M10 16h.01" />
                                        </svg>
                                    ) : segment.name}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                )}
                
                
                {/* Action buttons container */}
                <div className="action-buttons">
                    {/* Copy path button with separator when not in search mode */}
                    {!isSearchVisible && onCopyPath && currentPath && (
                        <>
                            <div className="copy-separator"></div>
                            <button
                                className="copy-path-btn-internal"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCopyPath();
                                }}
                                title="Copy current path"
                                aria-label="Copy current path"
                            >
                                <span className="icon icon-copy"></span>
                            </button>
                        </>
                    )}

                    {/* Separation line when not in search mode */}
                    {!isSearchVisible && <div className="search-separator"></div>}
                    
                    {/* Always show search icon - changes to cross when search is active */}
                    <button
                        className="search-icon-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleSearchClick();
                        }}
                        title={isSearchVisible ? "Clear search (F10)" : "Search in current folder (Ctrl+F)"}
                        aria-keyshortcuts="Control+f Meta+f"
                        aria-label={isSearchVisible ? "Clear search" : "Search in current folder"}
                    >
                        <span className={`icon ${isSearchVisible ? 'icon-x' : 'icon-search'}`}></span>
                    </button>
                </div>
            </div>
            {isEditing && popupBounds && createPortal(
                <div className="path-completions" style={popupBounds}
                    onPointerDown={event => { if (event.target.closest('.path-completion-option')) event.preventDefault(); }}>
                    <div className="path-completions-list" id={listId} role="listbox" aria-label="Path suggestions" ref={listRef}>
                        {suggestions.map((entry, index) => (
                            <div key={entry.path} id={`${listId}-${index}`} role="option"
                                aria-selected={index === activeSuggestion}
                                className="path-completion-option"
                                onPointerMove={() => setActiveSuggestion(index)}
                                onClick={() => openSuggestion(entry)}>
                                <span className={`icon ${entry.isDirectory ? 'icon-folder' : 'icon-file'}`} aria-hidden="true" />
                                <span className="path-completion-name">{entry.name}</span>
                                <span className="path-completion-parent">{entry.path}</span>
                                {entry.recent && <span className="path-completion-tag">Recent</span>}
                            </div>
                        ))}
                    </div>
                    {!suggestions.length && <div className="path-completion-status" role="status">
                        {completion.input !== editValue ? 'Finding paths…' : completion.error || 'No matching paths'}
                    </div>}
                    <div className="path-completion-help">
                        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                        <span><kbd>Enter</kbd> open</span>
                        <span><kbd>Tab</kbd> expand</span>
                        <span><kbd>Esc</kbd> dismiss</span>
                    </div>
                </div>, document.body
            )}
        </div>
    );
};

export default PathBreadcrumb;
