import React, { useState, useCallback, useEffect, useRef } from 'react';
import usePersistedState from '../hooks/usePersistedState';
import { restoreItemPaneAfterPointer } from '../utils/explorerFocus';
import { useFileSystem } from '../providers/FileSystemProvider';
import { useContextMenu } from '../providers/ContextMenuProvider';
import { useHistory } from '../providers/HistoryProvider';
import { useSettings } from '../providers/SettingsProvider';
import { useAppState } from '../providers/AppStateProvider';
import { useSftp } from '../providers/SftpProvider';
import { invoke } from '@tauri-apps/api/core';
import { showError, showConfirm, showSuccess } from '../utils/NotificationSystem';

// Core Components
import Sidebar from '../components/sidebar/Sidebar';
import PathBreadcrumb from '../components/explorer/PathBreadcrumb';
import NavigationButtons from '../components/explorer/NavigationButtons';
import FileList from '../components/explorer/FileList';
import DetailsPanel from '../components/explorer/DetailsPanel';
import ContextMenu from '../components/contextMenu/ContextMenu';

// Additional Components
import RenameModal from '../components/common/RenameModal';
import TabManager from '../components/tabs/TabManager';
import GlobalSearch from '../components/search/GlobalSearch';
import SettingsPanel from '../components/settings/SettingsPanel';
import ThisPCView from '../components/thisPc/ThisPCView';
import NetworkView from '../components/network/NetworkView';
import TemplateList from '../components/templates/TemplateList';
import WindowControls from '../components/common/WindowControls';

// Hash Modals
import HashFileModal from '../components/common/HashFileModal.jsx';
import HashCompareModal from '../components/common/HashCompareModal.jsx';
import HashDisplayModal from '../components/common/HashDisplayModal.jsx';

// Settings Applier
import SettingsApplier from '../utils/SettingsApplier.js';

import '../styles/layouts/mainLayout.css';
import '../components/explorer/viewModes.css';
import {replaceFileName} from "../utils/pathUtils.js";

/**
 * MainLayout component that serves as the primary layout structure for the application.
 * Manages UI state, event handling, and renders the main application interface.
 *
 * @returns {JSX.Element} The MainLayout component
 */
const MainLayout = () => {
    const { isLoading, currentDirData, selectedItems, loadDirectory, volumes, renameItem: fsRenameItem } = useFileSystem();
    const { isSftpPath, parseSftpPath, createSftpUrl } = useSftp();
    const { 
        isOpen: isContextMenuOpen, 
        position, 
        items, 
        closeContextMenu, 
        renameItem,
    } = useContextMenu();
    const { currentPath, navigateTo } = useHistory();
    const { settings } = useSettings();
    const { toggleSidebar } = useAppState();

    // UI State - Initialize from settings
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = usePersistedState('fileExplorerDetailsPanelOpen', () => settings.show_details_panel || false);
    const previousDetailsPreference = useRef(settings.show_details_panel);
    const [viewMode, setViewMode] = useState(settings.default_view || 'grid');
    const [searchValue, setSearchValue] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [currentView, setCurrentView] = useState('explorer'); // 'explorer', 'this-pc', 'templates'

    // Modal states
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [itemToRename, setItemToRename] = useState(null);

    // Text viewer modal state
    const [isTextViewerOpen, setIsTextViewerOpen] = useState(false);
    const [textViewerContent, setTextViewerContent] = useState('');
    const [textViewerFileName, setTextViewerFileName] = useState('');

    // Hash Modal states
    const [isHashFileModalOpen, setIsHashFileModalOpen] = useState(false);
    const [isHashCompareModalOpen, setIsHashCompareModalOpen] = useState(false);
    const [isHashDisplayModalOpen, setIsHashDisplayModalOpen] = useState(false);
    const [hashModalItem, setHashModalItem] = useState(null);
    const [hashDisplayData, setHashDisplayData] = useState({ hash: '', fileName: '' });

    /**
     * Effect to update UI state when settings change
     */
    useEffect(() => {
        // Restore the last panel state first; apply later changes made in Settings.
        if (settings.show_details_panel !== previousDetailsPreference.current &&
            settings.show_details_panel !== undefined) {
            setIsDetailsPanelOpen(settings.show_details_panel);
        }
        previousDetailsPreference.current = settings.show_details_panel;
    }, [settings.show_details_panel]);

    /**
     * Effect to update view mode when settings change
     */
    useEffect(() => {
        if (settings.default_view) {
            setViewMode(settings.default_view);
        }
    }, [settings.default_view]);


    /**
     * Effect to load default location on first render
     */
    useEffect(() => {
        if (volumes.length > 0 && !currentDirData && !currentPath) {
            // Show This PC view by default
            setCurrentView('this-pc');
        }
    }, [volumes, currentDirData, currentPath]);

    /**
     * Effect to close details panel when switching to This PC view
     */
    useEffect(() => {
        if (currentView === 'this-pc') {
            setIsDetailsPanelOpen(false);
        }
    }, [currentView]);

    /**
     * Effect to auto-start indexing when app loads
     */
    useEffect(() => {
        const initializeSearchEngine = async () => {
            if (volumes.length > 0) {
                try {
                    console.log('MainLayout: Checking search engine status for auto-indexing...');
                    
                    // Check if search engine has indexed files
                    const searchEngineInfo = await invoke('get_search_engine_info');
                    const hasNoIndexedFiles = !searchEngineInfo.stats?.trie_size || searchEngineInfo.stats.trie_size === 0;
                    
                    console.log('MainLayout: Search engine info:', searchEngineInfo);
                    console.log('MainLayout: Has no indexed files:', hasNoIndexedFiles);

                    if (hasNoIndexedFiles) {
                        console.log('MainLayout: Starting auto-indexing of home directory...');
                        
                        // Get system info to get the proper home directory
                        const metaDataJson = await invoke('get_meta_data_as_json');
                        const metaData = JSON.parse(metaDataJson);
                        
                        if (!metaData.user_home_dir) {
                            console.error('MainLayout: User home directory not available');
                            return;
                        }

                        console.log('MainLayout: Using home directory:', metaData.user_home_dir);
                        
                        // Auto-index home directory on app startup
                        const result = await invoke('add_paths_recursive_async', {
                            folder: metaData.user_home_dir
                        });
                        
                        console.log('MainLayout: Auto-indexing initiated:', result);
                        showSuccess('Background indexing started for your home directory');
                    } else {
                        console.log('MainLayout: Search engine already has indexed files, skipping auto-indexing');
                    }
                } catch (error) {
                    console.error('MainLayout: Auto-indexing failed:', error);
                    // Don't show error to user as this is background operation
                }
            }
        };

        // Only run once when volumes are first loaded
        if (volumes.length > 0) {
            initializeSearchEngine();
        }
    }, [volumes.length]); // Only depend on volumes.length to avoid re-running

    /**
     * Effect to listen for custom events
     * Improved with debug information
     */
    useEffect(() => {
        /**
         * Handler for opening templates view
         */
        const handleOpenTemplates = () => {
            setCurrentView('templates');
            setIsTemplatesOpen(true);
            navigateTo(null); // Clear explorer path
        };

        /**
         * Handler for showing properties panel
         */
        const handleShowProperties = (e) => {
            setIsDetailsPanelOpen(true);
        };

        /**
         * Handler for opening This PC view
         */
        const handleOpenThisPC = () => {
            setCurrentView('this-pc');
            navigateTo(null); // Clear explorer path bug fix
        };

        /**
         * Handler for opening Network view
         */
        const handleOpenNetwork = () => {
            setCurrentView('network');
            navigateTo(null); // Clear explorer path
        };

        /**
         * Handler for opening settings panel
         */
        const handleOpenSettings = () => {
            setIsSettingsOpen(true);
        };

        /**
         * Handler for opening rename modal
         * @param {CustomEvent} e - Event with item details
         */
        const handleOpenRenameModal = (e) => {
            if (e.detail && e.detail.item && typeof e.detail.item === 'object') {
                // Close any existing modal first to prevent duplicates
                setIsRenameModalOpen(false);
                setItemToRename(null);
                
                // Small delay to ensure cleanup, then open new modal
                setTimeout(() => {
                    // Double-check the item is still valid before setting it
                    if (e.detail.item && typeof e.detail.item === 'object' && e.detail.item.name) {
                        setItemToRename(e.detail.item);
                        setIsRenameModalOpen(true);
                    }
                }, 10);
            }
        };

        // Improved hash event handlers with debug information
        /**
         * Handler for opening hash file modal
         * @param {CustomEvent} e - Event with item details
         */
        const handleOpenHashFileModal = (e) => {
            console.log('MainLayout: Received open-hash-file-modal event:', e.detail);
            if (e.detail && e.detail.item) {
                console.log('Opening Hash File Modal for:', e.detail.item.name);
                setHashModalItem(e.detail.item);
                setIsHashFileModalOpen(true);
            } else {
                console.log('Invalid event detail:', e.detail);
            }
        };

        /**
         * Handler for opening hash compare modal
         * @param {CustomEvent} e - Event with item details
         */
        const handleOpenHashCompareModal = (e) => {
            console.log('MainLayout: Received open-hash-compare-modal event:', e.detail);
            if (e.detail && e.detail.item) {
                console.log('Opening Hash Compare Modal for:', e.detail.item.name);
                setHashModalItem(e.detail.item);
                setIsHashCompareModalOpen(true);
            } else {
                console.log('Invalid event detail:', e.detail);
            }
        };

        // Hash Display Modal Handler
        const handleOpenHashDisplayModal = (e) => {
            console.log('Opening Hash Display Modal:', e.detail);
            if (e.detail?.hash && e.detail?.fileName) {
                setHashDisplayData({ hash: e.detail.hash, fileName: e.detail.fileName });
                setIsHashDisplayModalOpen(true);
            } else {
                console.log('Invalid hash display event detail:', e.detail);
            }
        };

        // SFTP File Opened Handler
        const handleSftpFileOpened = (e) => {
            console.log('SFTP File Opened:', e.detail);
            if (e.detail?.path && e.detail?.content !== undefined) {
                const fileName = e.detail.path.split('/').pop() || 'Unknown File';
                setTextViewerFileName(fileName);
                setTextViewerContent(e.detail.content);
                setIsTextViewerOpen(true);
            }
        };

        // Register event listeners
    document.addEventListener('open-templates', handleOpenTemplates);
    document.addEventListener('show-properties', handleShowProperties);
    document.addEventListener('open-this-pc', handleOpenThisPC);
    document.addEventListener('open-network', handleOpenNetwork);
    document.addEventListener('open-settings', handleOpenSettings);
    document.addEventListener('open-rename-modal', handleOpenRenameModal);
    document.addEventListener('open-hash-file-modal', handleOpenHashFileModal);
    document.addEventListener('open-hash-compare-modal', handleOpenHashCompareModal);
    document.addEventListener('open-hash-display-modal', handleOpenHashDisplayModal);
    document.addEventListener('sftp-file-opened', handleSftpFileOpened);
    document.addEventListener('force-explorer-view', () => setCurrentView('explorer'));

        console.log('MainLayout: All event listeners registered');

        return () => {
            document.removeEventListener('open-templates', handleOpenTemplates);
            document.removeEventListener('show-properties', handleShowProperties);
            document.removeEventListener('open-this-pc', handleOpenThisPC);
            document.removeEventListener('open-network', handleOpenNetwork);
            document.removeEventListener('open-settings', handleOpenSettings);
            document.removeEventListener('open-rename-modal', handleOpenRenameModal);
            document.removeEventListener('open-hash-file-modal', handleOpenHashFileModal);
            document.removeEventListener('open-hash-compare-modal', handleOpenHashCompareModal);
            document.removeEventListener('open-hash-display-modal', handleOpenHashDisplayModal);
            document.removeEventListener('sftp-file-opened', handleSftpFileOpened);
            document.removeEventListener('force-explorer-view', () => setCurrentView('explorer'));
            console.log('MainLayout: All event listeners removed');
        };
    }, []);

    /**
     * Effect to switch to explorer view when navigating to a directory
     */
    useEffect(() => {
        if (currentPath && currentView !== 'explorer') {
            setCurrentView('explorer');
        }
    }, [currentPath]);

    /**
     * Handles search functionality
     * @param {string} value - The search query
     */
    const handleSearch = useCallback((value) => {
        setSearchValue(value);

        if (!value.trim()) {
            setSearchResults(null);
            return;
        }

        // Simple local search for now
        if (currentDirData) {
            const filteredFiles = currentDirData.files.filter(file =>
                file.name.toLowerCase().includes(value.toLowerCase())
            );

            const filteredDirs = currentDirData.directories.filter(dir =>
                dir.name.toLowerCase().includes(value.toLowerCase())
            );

            setSearchResults({
                directories: filteredDirs,
                files: filteredFiles
            });
        }
    }, [currentDirData]);

    /**
     * Effect to handle keyboard shortcuts
     */
    useEffect(() => {
        /**
         * Keyboard event handler for shortcuts
         * @param {KeyboardEvent} e - The keyboard event
         */
        const handleKeyDown = (e) => {
            // Toggle sidebar: Ctrl+B
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                if (!e.repeat) toggleSidebar();
                return;
            }

            // Global search: Ctrl+Shift+F
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                setIsGlobalSearchOpen(true);
            }

            // Settings: Ctrl+,
            if ((e.ctrlKey || e.metaKey) && e.key === ',') {
                e.preventDefault();
                setIsSettingsOpen(true);
            }

            // New folder: Ctrl+Shift+N
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('create-folder'));
            }

            // New file: Ctrl+N
            if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('create-file'));
            }

            // Rename: F2
            if (e.key === 'F2' && selectedItems.length === 1) {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('open-rename-modal', {
                    detail: { item: selectedItems[0] }
                }));
            }

            // Escape to clear selection
            if (e.key === 'Escape' && !e.target.closest?.('video, audio, object')) {
                document.dispatchEvent(new CustomEvent('clear-selection'));
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectedItems, toggleSidebar]);

    /**
     * Copies current path to clipboard
     * For SFTP paths, copies the standard URL format
     */
    const copyCurrentPath = useCallback(async () => {
        if (!currentPath) return;

        try {
            let pathToCopy = currentPath;
            
            // For SFTP paths, copy the standard URL format instead of internal format
            if (isSftpPath(currentPath)) {
                const parsed = parseSftpPath(currentPath);
                if (parsed && parsed.connection) {
                    const remotePath = parsed.remotePath || '/';
                    // Ensure path starts with forward slash
                    const formattedPath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
                    pathToCopy = `sftp://${parsed.connection.username}@${parsed.connection.host}:${parsed.connection.port}${formattedPath}`;
                }
            }
            
            await navigator.clipboard.writeText(pathToCopy);
            // Show temporary notification
            const notification = document.createElement('div');
            notification.textContent = 'Path copied to clipboard';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--accent);
                color: var(--text-on-accent);
                padding: 12px 20px;
                border-radius: 6px;
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
            `;
            document.body.appendChild(notification);
            setTimeout(() => {
                notification.remove();
            }, 2000);
        } catch (error) {
            console.error('Failed to copy path:', error);
        }
    }, [currentPath, isSftpPath, parseSftpPath]);

    /**
     * Handles renaming a file or directory
     * @param {Object} item - The item to rename
     * @param {string} newName - The new name
     */
    const handleRename = async (item, newName) => {
        console.log('handleRename called with:', { item, newName });
        
        if (!newName || newName === item.name) {
            console.log('handleRename: Early return - newName is empty or same as current name');
            return;
        }

        console.log(`Renaming "${replaceFileName(item.path, newName)}"`);

        try {
            const separator = item.path.includes('\\') ? '\\' : '/';

            console.log("Debug - separator detected:", separator);
            console.log("Debug - original path:", item.path);

            const pathParts = item.path.split(separator);
            pathParts[pathParts.length - 1] = newName;
            const newPath = pathParts.join(separator);

            console.log("Debug - new path:", newPath);

            // Use FileSystemProvider's renameItem which handles both local and SFTP paths
            await fsRenameItem(item.path, newPath);
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

    const handleViewModeChange = useCallback(async (mode) => {
        setViewMode(mode);
        try {
            await invoke('update_settings_field', { key: 'default_view', value: mode });
        } catch (error) {
            console.error('Failed to save view mode setting:', error);
        }
    }, []);

    /**
     * Handles details panel toggle with settings persistence
     */
    const handleDetailsPanelOpenChange = useCallback(async (open) => {
        setIsDetailsPanelOpen(open);

        // Save to settings
        try {
            await invoke('update_settings_field', { key: 'show_details_panel', value: open });
        } catch (error) {
            console.error('Failed to save details panel setting:', error);
        }
    }, [setIsDetailsPanelOpen]);

    const handleDetailsPanelToggle = useCallback(() => handleDetailsPanelOpenChange(!isDetailsPanelOpen),
        [isDetailsPanelOpen, handleDetailsPanelOpenChange]);

    useEffect(() => {
        const handlePreviewToggle = (event) => {
            if (event.target.closest?.('.window-controls')) return;
            if ((event.key !== ' ' && event.code !== 'Space') || event.ctrlKey || event.metaKey ||
                event.altKey || event.shiftKey || event.isComposing) return;
            const field = event.target.closest?.('input, textarea');
            const isTyping = event.target.isContentEditable ||
                event.target.closest?.('[role="textbox"]:not([aria-readonly="true"]), [role="searchbox"]:not([aria-readonly="true"])') ||
                (field && !field.readOnly && !field.disabled &&
                    !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(field.type));
            if (isTyping) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) handleDetailsPanelToggle();
        };

        window.addEventListener('keydown', handlePreviewToggle, true);
        return () => window.removeEventListener('keydown', handlePreviewToggle, true);
    }, [handleDetailsPanelToggle]);

    /**
     * Effect to clear search when changing directory
     */
    useEffect(() => {
        setSearchValue('');
        setSearchResults(null);
    }, [currentDirData]);

    // Get the data to display
    const displayData = searchResults || currentDirData;

    /**
     * Renders the main content based on current view
     * @returns {JSX.Element} The main content component
     */
    const renderMainContent = () => {
        switch (currentView) {
            case 'this-pc':
                return <ThisPCView />;
            case 'network':
                return <NetworkView />;
            case 'templates':
                return <TemplateList onClose={() => {
                    setCurrentView('explorer');
                    setIsTemplatesOpen(false);
                }} />;
            default:
                return (
                    <div className="files-container">
                        <FileList
                            data={displayData}
                            isLoading={isLoading}
                            viewMode={viewMode}
                            isSearching={!!searchValue}
                            searchTerm={searchValue}
                        />
                    </div>
                );
        }
    };

    // Removed SFTP event listener - now handled by SftpProvider

    // Removed renderSftpFileList - now handled seamlessly by the regular explorer view

    return (
        <div className="main-layout" onPointerUpCapture={restoreItemPaneAfterPointer}>
            {/* Settings Applier - applies settings to DOM */}
            <SettingsApplier />

            {/* Full-width tabs at the top */}
            <TabManager>
                {/* Full-width toolbar */}
                <div className="toolbar" data-tauri-drag-region>
                        <div className="toolbar-left">
                            <NavigationButtons />
                            <PathBreadcrumb
                                onCopyPath={copyCurrentPath}
                                isVisible={currentView === 'explorer'}
                                onSearch={handleSearch}
                            />
                        </div>
                        <div className="toolbar-drag-region" data-tauri-drag-region aria-hidden="true" />
                        <div className="toolbar-right">
                            {currentView === 'explorer' && (
                                <div className="view-modes" role="group" aria-label="File view">
                                    {[
                                        { id: 'grid', label: 'Icons view', icon: 'grid' },
                                        { id: 'list', label: 'List view', icon: 'list' },
                                    ].map(mode => (
                                        <button
                                            key={mode.id}
                                            type="button"
                                            className={`view-mode-button ${viewMode === mode.id ? 'active' : ''}`}
                                            onClick={() => handleViewModeChange(mode.id)}
                                            aria-label={mode.label}
                                            aria-pressed={viewMode === mode.id}
                                            title={mode.label}
                                        >
                                            <span className={`icon icon-${mode.icon}`} aria-hidden="true"></span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => setIsSettingsOpen(true)}
                                title="Settings (Ctrl+,)"
                                aria-label="Settings"
                            >
                                <span className="icon icon-settings" aria-hidden="true"></span>
                            </button>
                            <WindowControls />
                        </div>
                </div>

                <div className="layout-content">
                    {/* Sidebar */}
                    <Sidebar
                        currentView={currentView}
                    />

                    {/* Main content area */}
                    <div className="content-area">
                        {/* Main content with file list and optional details panel */}
                        <div className="main-content">
                            {renderMainContent()}

                            {/* Details panel (when selected) */}
                            <DetailsPanel
                                item={selectedItems[0] || null}
                                isMultipleSelection={selectedItems.length > 1}
                                isCollapsed={!isDetailsPanelOpen}
                                onOpenChange={handleDetailsPanelOpenChange}
                                onCollapse={handleDetailsPanelToggle}
                                viewMode={viewMode}
                            />
                        </div>

                    </div>
                </div>
            </TabManager>

            {/* Context menu */}
            {isContextMenuOpen && (
                <ContextMenu
                    position={position}
                    items={items}
                    onClose={closeContextMenu}
                />
            )}

            {/* Modals */}
            <GlobalSearch
                isOpen={isGlobalSearchOpen}
                onClose={() => setIsGlobalSearchOpen(false)}
            />

            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <RenameModal
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                item={itemToRename}
                onRename={handleRename}
            />

            {/* Hash Modals - with debug info */}
            <HashFileModal
                isOpen={isHashFileModalOpen}
                onClose={() => {
                    console.log('Closing Hash File Modal');
                    setIsHashFileModalOpen(false);
                    setHashModalItem(null);
                }}
                item={hashModalItem}
            />

            <HashCompareModal
                isOpen={isHashCompareModalOpen}
                onClose={() => {
                    console.log('Closing Hash Compare Modal');
                    setIsHashCompareModalOpen(false);
                    setHashModalItem(null);
                }}
                item={hashModalItem}
            />

            <HashDisplayModal
                isOpen={isHashDisplayModalOpen}
                onClose={() => {
                    console.log('Closing Hash Display Modal');
                    setIsHashDisplayModalOpen(false);
                    setHashDisplayData({ hash: '', fileName: '' });
                }}
                hash={hashDisplayData.hash}
                fileName={hashDisplayData.fileName}
            />

        </div>
    );
};

export default MainLayout;
