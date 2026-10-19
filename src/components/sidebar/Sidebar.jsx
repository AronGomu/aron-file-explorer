import React, {useEffect, useRef, useState} from 'react';
import {useFileSystem} from '../../providers/FileSystemProvider';
import {useHistory} from '../../providers/HistoryProvider';
import {useContextMenu} from '../../providers/ContextMenuProvider';
import {useSftp} from '../../providers/SftpProvider';
import {useAppState} from '../../providers/AppStateProvider';
import usePersistedState from '../../hooks/usePersistedState';
import SidebarItem from './SidebarItem';
import Favorites from './Favorites';
//import QuickAccess from './QuickAccess';
import Modal from '../common/Modal';
import Button from '../common/Button';
import AddSftpConnectionView from './AddSftpConnectionView';
import './sidebar.css';
import {showConfirm, showError, showSuccess} from "../../utils/NotificationSystem.js";
import { formatFileSize } from '../../utils/formatters';
import { invoke } from '@tauri-apps/api/core';
import useFavoritesDropTarget from '../../hooks/useFavoritesDropTarget';

const COLLAPSED_WIDTH = 48;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 480;
const COLLAPSE_RESISTANCE = 100;
const SIDEBAR_SHORTCUTS = [
    { id: 'favorites', label: 'Favorites', path: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z' },
    { id: 'drives', label: 'Drives', path: 'M5 4h14l3 10v6H2v-6zM2 14h20M6 17h.01M10 17h.01' },
    { id: 'network', label: 'Network', path: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0M3 12h18M12 3a16 16 0 0 1 0 18a16 16 0 0 1 0-18' },
];
const getMaximumWidth = () => Math.max(MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.6)));

/**
 * Sidebar component - Provides navigation, favorites, and quick access
 *
 * @param {Object} props - Component props
 * @param {string} props.currentView - Current view being displayed (e.g., 'this-pc')
 * @returns {React.ReactElement} Sidebar component
 */
const Sidebar = ({ currentView }) => {
    const { volumes, loadDirectory, loadVolumes } = useFileSystem();
    const [mountingDevice, setMountingDevice] = useState(null);
    const openVolume = async volume => {
        if (mountingDevice) return;
        try {
            let path = volume.mount_point;
            if (volume.is_mounted === false) {
                setMountingDevice(volume.device);
                path = await invoke('mount_volume', { device: volume.device });
                await loadVolumes();
            }
            handleItemClick(path);
        } catch (error) {
            showError(String(error));
        } finally { setMountingDevice(null); }
    };
    const { currentPath, navigateTo } = useHistory();
    const { removeFromFavorites, addToFavorites: addItemToFavorites } = useContextMenu();
    const { isDragging, dropTargetProps: favoritesDropProps } = useFavoritesDropTarget(items => {
        items.forEach(item => addItemToFavorites(item));
    });
    const { navigateToSftpConnection, createSftpUrl, isSftpPath, parseSftpPath, createSftpPath } = useSftp();
    const { isSidebarCollapsed, setIsSidebarCollapsed, toggleSidebar } = useAppState();
    const [sidebarWidth, setSidebarWidth] = usePersistedState('fileExplorerSidebarWidth', () => Math.min(240, getMaximumWidth()));
    const [isResizing, setIsResizing] = useState(false);
    const resizeStart = useRef(null);
    const sectionRefs = useRef({});
    const [pendingFocus, setPendingFocus] = useState(null);

    useEffect(() => {
        if (isSidebarCollapsed || !pendingFocus) return;
        const target = sectionRefs.current[pendingFocus];
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setPendingFocus(null);
    }, [isSidebarCollapsed, pendingFocus]);

    useEffect(() => {
        const constrainWidth = () => setSidebarWidth(width => Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, getMaximumWidth())));
        constrainWidth();
        window.addEventListener('resize', constrainWidth);
        return () => window.removeEventListener('resize', constrainWidth);
    }, []);

    const resizeSidebar = (width) => {
        if (width < MIN_SIDEBAR_WIDTH) {
            setIsSidebarCollapsed(true);
        } else {
            setSidebarWidth(Math.min(Math.round(width), getMaximumWidth()));
            setIsSidebarCollapsed(false);
        }
    };

    const handleResizeStart = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        resizeStart.current = {
            x: event.clientX,
            width: event.currentTarget.parentElement.getBoundingClientRect().width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizing(true);
    };

    const handleResizeMove = (event) => {
        if (!resizeStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const width = resizeStart.current.width + event.clientX - resizeStart.current.x;
        // Hold at the minimum until the pointer clears the resistance zone.
        if (!isSidebarCollapsed && width < MIN_SIDEBAR_WIDTH &&
            width > MIN_SIDEBAR_WIDTH - COLLAPSE_RESISTANCE) {
            setSidebarWidth(MIN_SIDEBAR_WIDTH);
            return;
        }
        resizeSidebar(width);
    };

    const handleResizeEnd = (event) => {
        resizeStart.current = null;
        setIsResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleResizeKeyDown = (event) => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        switch (event.key) {
            case 'ArrowLeft':
                resizeSidebar((isSidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth) - 10);
                break;
            case 'ArrowRight':
                if (isSidebarCollapsed) setIsSidebarCollapsed(false);
                else resizeSidebar(sidebarWidth + 10);
                break;
            case 'Home':
                setIsSidebarCollapsed(true);
                break;
            case 'End':
                resizeSidebar(getMaximumWidth());
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    const [systemInfo, setSystemInfo] = useState(null);
    const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);
    const [newSourcePath, setNewSourcePath] = useState('');
    const addSourceInputRef = useRef(null);

    // SFTP Connections state
    const [sftpConnections, setSftpConnections] = useState([]);
    const [isAddSftpModalOpen, setIsAddSftpModalOpen] = useState(false);
    
    // Load SFTP connections from localStorage
    const loadSftpConnections = React.useCallback(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('fileExplorerSftpConnections') || '[]');
            setSftpConnections(saved);
        } catch (err) {
            setSftpConnections([]);
        }
    }, []);

    // Load on mount and on custom event
    React.useEffect(() => {
        loadSftpConnections();
        const handler = () => loadSftpConnections();
        window.addEventListener('sftp-connections-updated', handler);
        window.addEventListener('storage', (e) => {
            if (e.key === 'fileExplorerSftpConnections') loadSftpConnections();
        });
        return () => {
            window.removeEventListener('sftp-connections-updated', handler);
        };
    }, [loadSftpConnections]);

    // Add SFTP connection
    const addSftpConnection = (conn) => {
        try {
            const existing = JSON.parse(localStorage.getItem('fileExplorerSftpConnections') || '[]');
            const newConnections = [...existing, conn];
            localStorage.setItem('fileExplorerSftpConnections', JSON.stringify(newConnections));
            window.dispatchEvent(new CustomEvent('sftp-connections-updated'));
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'fileExplorerSftpConnections',
                newValue: JSON.stringify(newConnections)
            }));
        } catch (err) {
            // ignore
        }
        setIsAddSftpModalOpen(false);
    };

    // Remove SFTP connection with confirmation
    const removeSftpConnection = async (name) => {
        const confirmRemove = await showConfirm(`Are you sure you want to remove the SFTP connection "${name}"?`);
        if (!confirmRemove) return;
        try {
            const existing = JSON.parse(localStorage.getItem('fileExplorerSftpConnections') || '[]');
            const newConnections = existing.filter(c => c.name !== name);
            localStorage.setItem('fileExplorerSftpConnections', JSON.stringify(newConnections));
            window.dispatchEvent(new CustomEvent('sftp-connections-updated'));
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'fileExplorerSftpConnections',
                newValue: JSON.stringify(newConnections)
            }));
            showSuccess('SFTP COnnection "${name}" removed successfully.', 'success');
        } catch (err) {
            showError('Failed to remove SFTP connection: ' + err.message, 'error');
        }
    };

    // State for collapsible sections
    const [sectionCollapsed, setSectionCollapsed] = useState(() => {
        const saved = localStorage.getItem('sidebarSectionsCollapsed');
        return {
            quickAccess: true,
            favorites: true,
            drives: true,
            network: true,
            ...(saved ? JSON.parse(saved) : {})
        };
    });

    /**
     * Load system info to identify the current OS
     */
    useEffect(() => {
        const loadSystemInfo = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const metaDataJson = await invoke('get_meta_data_as_json');
                const metaData = JSON.parse(metaDataJson);
                setSystemInfo(metaData);
            } catch (error) {
                console.error('Failed to load system info:', error);
                // Mock data for development
                setSystemInfo({
                    current_running_os: 'windows',
                    user_home_dir: 'C:\\Users\\User'
                });
            }
        };

        loadSystemInfo();
    }, []);



    /**
     * Toggles a specific section's collapse state
     * @param {string} section - Section name to toggle
     */
    const toggleSectionCollapse = (section) => {
        const newSectionCollapsed = {
            ...sectionCollapsed,
            [section]: !sectionCollapsed[section]
        };
        setSectionCollapsed(newSectionCollapsed);
        localStorage.setItem('sidebarSectionsCollapsed', JSON.stringify(newSectionCollapsed));
    };

    const openSidebarSection = (section) => {
        const newSectionCollapsed = { ...sectionCollapsed, [section]: false };
        setSectionCollapsed(newSectionCollapsed);
        localStorage.setItem('sidebarSectionsCollapsed', JSON.stringify(newSectionCollapsed));
        setIsSidebarCollapsed(false);
        setPendingFocus(section);
    };

    /**
     * Handles clicking on a sidebar item with navigation history update
     * @param {string} path - Path to navigate to
     */
    const handleItemClick = async (path) => {
        let targetPath = path;
        
        // Handle SFTP files - navigate to parent directory instead of trying to open as directory
        if (isSftpPath(path)) {
            // Check if this is a favorite item and if it looks like a file
            // For SFTP favorites, check if the path ends with a file extension or doesn't look like a directory
            const favorites = JSON.parse(localStorage.getItem('fileExplorerFavorites') || '[]');
            const favoriteItem = favorites.find(fav => fav.path === path);
            
            if (favoriteItem && favoriteItem.icon === 'file') {
                // This is an SFTP file favorite, navigate to its parent directory
                const parsed = parseSftpPath(path);
                if (parsed && parsed.connection) {
                    const pathParts = parsed.remotePath.split('/').filter(part => part && part !== '.');
                    pathParts.pop(); // Remove the file name
                    const parentPath = pathParts.length > 0 ? pathParts.join('/') : '.';
                    targetPath = createSftpPath(parsed.connection, parentPath);
                    console.log('SFTP file favorite detected, navigating to parent:', targetPath);
                }
            }
        }
        
        // Always update navigation history and reload directory, even if path is the same
        try {
            const existingHistory = JSON.parse(sessionStorage.getItem('fileExplorerHistory') || '[]');
            const updatedHistory = [targetPath, ...existingHistory.filter(p => p !== targetPath)].slice(0, 10);
            sessionStorage.setItem('fileExplorerHistory', JSON.stringify(updatedHistory));

            // Dispatch events to update quick access immediately
            window.dispatchEvent(new CustomEvent('navigation-changed'));
            window.dispatchEvent(new CustomEvent('quick-access-updated'));
        } catch (err) {
            console.error('Failed to update navigation history:', err);
        }

        // Always refresh disks when opening a directory
        await loadVolumes();
        // Always reload the directory, even if it's already selected
        window.dispatchEvent(new CustomEvent('force-explorer-view'));
        
        await loadDirectory(targetPath);
    };
    // Refresh disks when switching to 'this-pc' or 'explorer' view
    React.useEffect(() => {
        if (currentView === 'this-pc' || currentView === 'explorer') {
            loadVolumes();
        }
    }, [currentView, loadVolumes]);

    /**
     * Adds a location to favorites
     * @param {Object} location - Location object to add to favorites
     * @param {string} location.path - Path to the location
     * @param {string} location.name - Display name for the location
     * @param {string} location.icon - Icon to use for the location
     */
    const addToFavorites = (location) => {
        try {
            const existingFavorites = JSON.parse(localStorage.getItem('fileExplorerFavorites') || '[]');
            const newFavorites = [...existingFavorites, location];
            localStorage.setItem('fileExplorerFavorites', JSON.stringify(newFavorites));

            // Dispatch events to update favorites immediately
            window.dispatchEvent(new CustomEvent('favorites-updated'));
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'fileExplorerFavorites',
                newValue: JSON.stringify(newFavorites)
            }));
        } catch (error) {
            console.error('Failed to add to favorites:', error);
        }
    };

    /**
     * Removes a location from favorites using the context menu provider
     * @param {string} path - Path to remove from favorites
     */
    const handleRemoveFromFavorites = (path) => {
        removeFromFavorites(path);
    };

    /**
     * Opens the add source modal
     */
    const handleAddSource = () => {
        setNewSourcePath('');
        setIsAddSourceModalOpen(true);

        // Focus input after modal opens
        setTimeout(() => {
            if (addSourceInputRef.current) {
                addSourceInputRef.current.focus();
            }
        }, 100);
    };

    /**
     * Saves a new source to favorites
     */
    const saveNewSource = () => {
        if (!newSourcePath.trim()) return;

        const sourcePath = newSourcePath.trim();
        addToFavorites({
            name: sourcePath.split(/[/\\]/).pop() || 'New Source',
            path: sourcePath,
            icon: 'folder'
        });

        setIsAddSourceModalOpen(false);
        setNewSourcePath('');
    };

    /**
     * Handles form submission for add source
     * @param {React.FormEvent} e - Form submit event
     */
    const handleAddSourceSubmit = (e) => {
        e.preventDefault();
        saveNewSource();
    };

    /**
     * Handles input change for add source
     * @param {React.ChangeEvent<HTMLInputElement>} e - Input change event
     */
    const handleAddSourceInputChange = (e) => {
        setNewSourcePath(e.target.value);
    };

    /**
     * Handles key down for add source input
     * @param {React.KeyboardEvent} e - Keyboard event
     */
    const handleAddSourceKeyDown = (e) => {
        if (e.key === 'Escape') {
            setIsAddSourceModalOpen(false);
        }
    };

    return (
        <>
            <aside
                id="explorer-sidebar"
                className={`sidebar${isSidebarCollapsed ? ' sidebar-collapsed' : ''}${isResizing ? ' sidebar-resizing' : ''}`}
                style={{ '--sidebar-width': `${sidebarWidth}px` }}
                aria-label="Sidebar"
            >
                <div className="sidebar-header">
                    {!isSidebarCollapsed && (
                        <input
                            type="search"
                            className="input sidebar-search"
                            placeholder="Search…"
                            aria-label="Search sidebar"
                            value=""
                            readOnly
                            aria-disabled="true"
                        />
                    )}
                    <button
                        type="button"
                        className="sidebar-toggle"
                        onClick={toggleSidebar}
                        aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-expanded={!isSidebarCollapsed}
                        aria-controls="explorer-sidebar-content"
                        aria-keyshortcuts="Control+b Meta+b"
                        title={`${isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} (Ctrl+B)`}
                    >
                        <span className={`icon icon-chevron-${isSidebarCollapsed ? 'right' : 'left'}`} aria-hidden="true"></span>
                    </button>
                </div>
                {isSidebarCollapsed && (
                    <nav className="sidebar-rail" aria-label="Sidebar sections">
                        {SIDEBAR_SHORTCUTS.map(shortcut => (
                            <button
                                key={shortcut.id}
                                type="button"
                                className={`sidebar-toggle${shortcut.id === 'favorites' ? ' favorites-drop-target' : ''}`}
                                {...(shortcut.id === 'favorites' ? favoritesDropProps : {})}
                                onClick={() => openSidebarSection(shortcut.id)}
                                aria-label={`Open ${shortcut.label}`}
                                aria-controls="explorer-sidebar-content"
                                title={shortcut.label}
                            >
                                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d={shortcut.path} />
                                </svg>
                            </button>
                        ))}
                    </nav>
                )}
                <div id="explorer-sidebar-content" className="sidebar-content" hidden={isSidebarCollapsed}>
                    {/* Quick Access section */}
                    {/*
                    <section className="sidebar-section">
                        <div className="sidebar-section-header">
                            <h3 className="sidebar-section-title">Quick Access</h3>
                            <button
                                className="section-collapse-button"
                                onClick={() => toggleSectionCollapse('quickAccess')}
                                aria-label={sectionCollapsed.quickAccess ? 'Expand Quick Access' : 'Collapse Quick Access'}
                            >
                                <span className={`icon icon-chevron-${sectionCollapsed.quickAccess ? 'up' : 'down'}`}></span>
                            </button>
                        </div>
                        {!sectionCollapsed.quickAccess && (
                            <QuickAccess
                                onItemClick={handleItemClick}
                                currentView={currentView}
                                currentPath={currentPath}
                            />
                        )}
                    </section>
                    */}

                    {/* Favorites section */}
                    <section className="sidebar-section favorites-drop-target" aria-label="Favorites"
                        {...favoritesDropProps}>
                        <div className="sidebar-section-header">
                            <h3 className="sidebar-section-title" tabIndex={-1} ref={(element) => { sectionRefs.current.favorites = element; }}>Favorites</h3>
                            <div className="sidebar-section-actions">
                                <button
                                    className="section-add-button"
                                    onClick={handleAddSource}
                                    title="Add to Favorites"
                                >
                                    <span className="icon icon-plus-small"></span>
                                </button>
                                <button
                                    className="section-collapse-button"
                                    onClick={() => toggleSectionCollapse('favorites')}
                                    aria-label={sectionCollapsed.favorites ? 'Expand Favorites' : 'Collapse Favorites'}
                                >
                                    <span className={`icon icon-chevron-${sectionCollapsed.favorites ? 'up' : 'down'}`}></span>
                                </button>
                            </div>
                        </div>
                        {!sectionCollapsed.favorites && (
                            <Favorites
                                isCollapsed={isSidebarCollapsed}
                                onItemClick={handleItemClick}
                                onRemove={handleRemoveFromFavorites}
                                onAdd={addToFavorites}
                                currentView={currentView}
                                currentPath={currentPath}
                            />
                        )}
                        {isDragging && !sectionCollapsed.favorites && (
                            <div className="favorites-drop-hint">Drop here to add to Favorites</div>
                        )}
                    </section>

                    {/* Drives/Volumes section */}
                    <section className="sidebar-section">
                        <div className="sidebar-section-header">
                            <h3 className="sidebar-section-title" tabIndex={-1} ref={(element) => { sectionRefs.current.drives = element; }}>Drives</h3>
                            <button
                                className="section-collapse-button"
                                onClick={() => toggleSectionCollapse('drives')}
                                aria-label={sectionCollapsed.drives ? 'Expand Drives' : 'Collapse Drives'}
                            >
                                <span className={`icon icon-chevron-${sectionCollapsed.drives ? 'up' : 'down'}`}></span>
                            </button>
                        </div>
                        {!sectionCollapsed.drives && (
                            <ul className="sidebar-list">
                                {volumes.map((volume) => (
                                    <SidebarItem
                                        key={volume.device || volume.mount_point}
                                        icon={volume.is_removable ? 'usb' : 'drive'}
                                        name={volume.volume_name || volume.mount_point}
                                        path={volume.mount_point}
                                        dropPath={volume.is_mounted === false ? null : volume.mount_point}
                                        isCollapsed={isSidebarCollapsed}
                                        isActive={currentView === 'explorer' && currentPath === volume.mount_point}
                                        onClick={() => openVolume(volume)}
                                        info={volume.is_mounted === false
                                            ? `${mountingDevice === volume.device ? 'Mounting…' : 'Not mounted'} · ${formatFileSize(volume.drive_size || volume.size)} drive`
                                            : `${(volume.available_space / 1024 / 1024 / 1024).toFixed(1)}GB free of ${(volume.size / 1024 / 1024 / 1024).toFixed(1)}GB`}
                                        actions={volume.is_mounted === false ? [{ icon: 'drive', tooltip: 'Mount drive', onClick: () => openVolume(volume) }] : volume.is_removable ? [
                                            {
                                                icon: 'eject',
                                                tooltip: 'Safely eject',
                                                onClick: async () => {
                                                    const confirmEject = await showConfirm(`Are you sure you want to safely eject ${volume.volume_name}?`);
                                                    if (!confirmEject) return;

                                                    try {
                                                        const { invoke } = await import('@tauri-apps/api/core');
                                                        let command;
                                                        const os = systemInfo?.current_running_os?.toLowerCase();
                                                        
                                                        if (os === 'windows') {
                                                            command = `eject ${volume.mount_point}`;
                                                        } else if (os === 'macos' || os === 'darwin') {
                                                            // Use diskutil for proper ejection on macOS
                                                            command = `diskutil eject "${volume.mount_point}"`;
                                                        } else {
                                                            // Linux and other Unix-like systems
                                                            command = `umount "${volume.mount_point}"`;
                                                        }

                                                        const result = await invoke('execute_command', { command });
                                                        
                                                        // Parse the command result to check for success
                                                        const commandResponse = JSON.parse(result);
                                                        
                                                        if (commandResponse.status === 0) {
                                                            showSuccess(`${volume.volume_name} has been safely ejected.`, 'success');
                                                            // Reload volumes to update the UI after ejection
                                                            setTimeout(() => {
                                                                loadVolumes();
                                                            }, 1000);
                                                        } else {
                                                            throw new Error(commandResponse.stderr || commandResponse.stdout || 'Ejection failed');
                                                        }
                                                    } catch (error) {
                                                        console.error('Failed to eject volume:', error);
                                                        let errorMessage = error.message || error;
                                                        
                                                        // Parse error message if it's JSON
                                                        try {
                                                            const parsedError = JSON.parse(errorMessage);
                                                            errorMessage = parsedError.custom_message || parsedError.error_message || errorMessage;
                                                        } catch (e) {
                                                            // If not JSON, use as-is
                                                        }
                                                        
                                                        showError(`Failed to eject ${volume.volume_name}: ${errorMessage}`, 'error');
                                                    }
                                                }
                                            }
                                        ] : []}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>
                    {/* Network section */}
                    <section className="sidebar-section">
                        <div className="sidebar-section-header">
                            <h3 className="sidebar-section-title" tabIndex={-1} ref={(element) => { sectionRefs.current.network = element; }}>Network</h3>
                            <div className="sidebar-section-actions">
                                <button
                                    className="section-add-button"
                                    onClick={() => setIsAddSftpModalOpen(true)}
                                    title="Add SFTP Connection"
                                >
                                    <span className="icon icon-plus-small"></span>
                                </button>
                                <button
                                    className="section-collapse-button"
                                    onClick={() => toggleSectionCollapse('network')}
                                    aria-label={sectionCollapsed.network ? 'Expand Network' : 'Collapse Network'}
                                >
                                    <span className={`icon icon-chevron-${sectionCollapsed.network ? 'up' : 'down'}`}></span>
                                </button>
                            </div>
                        </div>
                        {!sectionCollapsed.network && (
                            <ul className="sidebar-list">
                                {sftpConnections.length === 0 ? (
                                    <div className="sidebar-empty-state">
                                        <div className="empty-state-icon">
                                            <span className="icon icon-network"></span>
                                        </div>
                                        <div className="empty-state-text">
                                            <p>No SFTP connections</p>
                                            <span>Add a connection to get started</span>
                                        </div>
                                    </div>
                                ) : (
                                    sftpConnections.map((conn) => (
                                        <SidebarItem
                                            key={conn.name}
                                            icon="network"
                                            name={conn.name}
                                            path={`sftp://${conn.username}@${conn.host}:${conn.port}`}
                                            dropPath={createSftpPath(conn, '.')}
                                            isCollapsed={isSidebarCollapsed}
                                            isActive={currentView === 'network' && currentPath === conn.name}
                                            onClick={async () => {
                                                // Navigate to SFTP connection using the new provider
                                                try {
                                                    const sftpData = await navigateToSftpConnection(conn);
                                                    if (sftpData) {
                                                        const sftpPath = createSftpUrl(conn, '.');
                                                        await loadDirectory(sftpPath);
                                                        navigateTo(sftpPath);
                                                    }
                                                } catch (error) {
                                                    console.error('Failed to connect to SFTP:', error);
                                                }
                                            }}
                                            actions={[{
                                                icon: 'x',
                                                tooltip: 'Remove SFTP Connection',
                                                onClick: () => removeSftpConnection(conn.name)
                                            }]}
                                        />
                                    ))
                                )}
                            </ul>
                        )}
                    </section>
                </div>

                <div
                    className="sidebar-resize-handle"
                    role="separator"
                    aria-label="Resize sidebar"
                    title="Resize sidebar (Alt+Shift+Left/Right)"
                    aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+Home Alt+Shift+End"
                    aria-orientation="vertical"
                    aria-controls="explorer-sidebar"
                    aria-valuemin={COLLAPSED_WIDTH}
                    aria-valuemax={getMaximumWidth()}
                    aria-valuenow={isSidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth}
                    aria-valuetext={isSidebarCollapsed ? 'Collapsed' : `${sidebarWidth} pixels`}
                    tabIndex={0}
                    onPointerDown={handleResizeStart}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                    onPointerCancel={handleResizeEnd}
                    onLostPointerCapture={handleResizeEnd}
                    onKeyDown={handleResizeKeyDown}
                />
            </aside>

            {/* Modal for adding SFTP connection */}
            <AddSftpConnectionView
                isOpen={isAddSftpModalOpen}
                onClose={() => setIsAddSftpModalOpen(false)}
                onAdd={addSftpConnection}
            />

            {/* Modal for adding data source */}
            <Modal
                isOpen={isAddSourceModalOpen}
                onClose={() => setIsAddSourceModalOpen(false)}
                title="Add Data Source"
                size="sm"
                footer={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setIsAddSourceModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={saveNewSource}
                            disabled={!newSourcePath.trim()}
                        >
                            Add Source
                        </Button>
                    </>
                }
            >
                <form onSubmit={handleAddSourceSubmit}>
                    <div className="form-group">
                        <label htmlFor="source-path">Data Source Path</label>
                        <input
                            ref={addSourceInputRef}
                            type="text"
                            id="source-path"
                            className="input"
                            value={newSourcePath}
                            onChange={handleAddSourceInputChange}
                            onKeyDown={handleAddSourceKeyDown}
                            placeholder="Enter path to folder to add as data source"
                        />
                        <div className="input-hint">
                            Enter the full path to a folder that you want to add as a data source to favorites.
                        </div>
                    </div>
                </form>
            </Modal>
        </>
    );
};

export default Sidebar;

