import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useFileSystem } from '../providers/FileSystemProvider';
import { useHistory } from '../providers/HistoryProvider';
import SidebarItem from '../components/sidebar/SidebarItem';
import usePersistedState from '../hooks/usePersistedState';
import useFavoritesDropTarget from '../hooks/useFavoritesDropTarget';
import { formatFileSize } from '../utils/formatters';
import { getDirectoryPath } from '../utils/pathUtils';
import { showConfirm } from '../utils/NotificationSystem';
import '../components/sidebar/sidebar.css';

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const COLLAPSED_WIDTH = 48;
const maximumWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth * 0.6));
const favoritePath = item => typeof item === 'string' ? item : item.path;
const folderFavorite = path => ({ path, name: path.split('/').filter(Boolean).at(-1) || '/', icon: 'folder' });

export default function ChooserSidebar({ startingFolder, onError }) {
    const { currentPath } = useHistory();
    const { volumes, loadVolumes, loadDirectory } = useFileSystem();
    const [collapsed, setCollapsed] = usePersistedState('chooserSidebarCollapsed', false);
    const [width, setWidth] = usePersistedState('chooserSidebarWidth', 240);
    const [favorites, setFavorites] = usePersistedState('chooserFavorites', []);
    const { isDragging, dropTargetProps: favoritesDropProps } = useFavoritesDropTarget(items => {
        setFavorites(previous => {
            const paths = new Set(previous.map(favoritePath));
            const additions = [];
            for (const item of items) {
                if (paths.has(item.path)) continue;
                paths.add(item.path);
                additions.push({ path: item.path, name: item.name, icon: item.isDirectory || 'sub_file_count' in item ? 'folder' : 'file' });
            }
            return additions.length ? [...previous, ...additions] : previous;
        });
    });
    const [sections, setSections] = usePersistedState('chooserSidebarSections', { favorites: false, drives: false });
    const [mounting, setMounting] = useState(null);
    const [resizing, setResizing] = useState(false);
    const drag = useRef(null);
    const toggle = useCallback(() => setCollapsed(value => !value), [setCollapsed]);

    useEffect(() => {
        const constrain = () => setWidth(value => Math.max(MIN_WIDTH, Math.min(value, maximumWidth())));
        const keyboard = event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !document.querySelector('[role="dialog"]')) {
                event.preventDefault(); toggle();
            }
        };
        constrain();
        window.addEventListener('resize', constrain);
        window.addEventListener('keydown', keyboard);
        return () => { window.removeEventListener('resize', constrain); window.removeEventListener('keydown', keyboard); };
    }, [setWidth, toggle]);

    const resize = next => {
        if (next < MIN_WIDTH) setCollapsed(true);
        else { setCollapsed(false); setWidth(Math.min(Math.round(next), maximumWidth())); }
    };
    const startResize = event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { x: event.clientX, width: collapsed ? COLLAPSED_WIDTH : width };
        event.currentTarget.setPointerCapture(event.pointerId); setResizing(true);
    };
    const moveResize = event => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const next = drag.current.width + event.clientX - drag.current.x;
        if (!collapsed && next < MIN_WIDTH && next > MIN_WIDTH - 100) setWidth(MIN_WIDTH);
        else resize(next);
    };
    const endResize = event => {
        drag.current = null; setResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const resizeKey = event => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') resize((collapsed ? COLLAPSED_WIDTH : width) - 10);
        else if (event.key === 'ArrowRight') resize(collapsed ? width : width + 10);
        else if (event.key === 'Home') setCollapsed(true);
        else if (event.key === 'End') resize(maximumWidth());
        else return;
        event.preventDefault(); event.stopPropagation();
    };
    const isCurrentFavorite = favorites.some(item => favoritePath(item) === currentPath);
    const toggleFavorite = async () => {
        if (isCurrentFavorite && !await showConfirm(`Remove "${currentPath}" from Favorites?`, 'Remove favorite')) return;
        setFavorites(previous => isCurrentFavorite
            ? previous.filter(item => favoritePath(item) !== currentPath) : [...previous, currentPath]);
    };
    const openVolume = async volume => {
        if (volume.is_mounted !== false) { loadDirectory(volume.mount_point); return; }
        if (mounting) return;
        setMounting(volume.device);
        try {
            const path = await invoke('mount_volume', { device: volume.device });
            await loadVolumes(); loadDirectory(path);
        } catch (error) { onError(String(error)); }
        finally { setMounting(null); }
    };
    const locations = [...new Map([folderFavorite(startingFolder), ...favorites.map(item =>
        typeof item === 'string' ? folderFavorite(item) : item)].map(item => [item.path, item])).values()];
    const sectionHeader = (id, label, action) => <div className="sidebar-section-header">
        <h3 className="sidebar-section-title">{label}</h3>
        <div className="sidebar-section-actions">{action}<button type="button" className="section-collapse-button"
            aria-label={`${sections[id] ? 'Expand' : 'Collapse'} ${label}`} aria-expanded={!sections[id]}
            onClick={() => setSections(previous => ({ ...previous, [id]: !previous[id] }))}>
            <span className={`icon icon-chevron-${sections[id] ? 'up' : 'down'}`} aria-hidden="true" />
        </button></div>
    </div>;

    return <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}${resizing ? ' sidebar-resizing' : ''}`}
        style={{ '--sidebar-width': `${width}px` }} aria-label="Locations">
        <div className="sidebar-header">
            {!collapsed && <span className="chooser-sidebar-title">Locations</span>}
            <button type="button" className="sidebar-toggle" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed} aria-controls="chooser-locations" title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}>
                <span className={`icon icon-chevron-${collapsed ? 'right' : 'left'}`} aria-hidden="true" />
            </button>
        </div>
        {collapsed && <nav className="sidebar-rail" aria-label="Sidebar sections">
            {[['favorites', 'Favorites', 'star'], ['drives', 'Drives', 'drive']].map(([id, label, icon]) => <button key={id} type="button"
                className="sidebar-toggle"
                aria-label={`Open ${label}`} title={label} onClick={() => {
                    setSections(previous => ({ ...previous, [id]: false })); setCollapsed(false);
                }}><span className={`icon icon-${icon}`} aria-hidden="true" /></button>)}
        </nav>}
        <div id="chooser-locations" className="sidebar-content" hidden={collapsed}>
            <section className="sidebar-section" aria-label="Favorites">
                {sectionHeader('favorites', 'Favorites', <button type="button" className="section-add-button" onClick={toggleFavorite}
                    aria-label={isCurrentFavorite ? 'Remove current folder from favorites' : 'Favorite current folder'}
                    title={isCurrentFavorite ? 'Remove favorite' : 'Favorite current folder'}>
                    <span className={`icon icon-${isCurrentFavorite ? 'minus' : 'plus-small'}`} aria-hidden="true" />
                </button>)}
                {!sections.favorites && <ul className="sidebar-list">{locations.map(item => <SidebarItem key={item.path} icon={item.icon} name={item.name}
                    path={item.path} dropPath={item.icon === 'file' ? null : item.path} isActive={currentPath === item.path}
                    onClick={() => loadDirectory(item.icon === 'file' ? getDirectoryPath(item.path) : item.path)} />)}</ul>}
                {isDragging && !sections.favorites && <div className="favorites-drop-hint" {...favoritesDropProps}>Drop here to add to Favorites</div>}
            </section>
            <section className="sidebar-section">
                {sectionHeader('drives', 'Drives')}
                {!sections.drives && <ul className="sidebar-list">{volumes.map(volume => <SidebarItem key={volume.device || volume.mount_point}
                    icon={volume.is_removable ? 'usb' : 'drive'} name={volume.volume_name || volume.mount_point} path={volume.mount_point}
                    isActive={volume.is_mounted !== false && currentPath === volume.mount_point} onClick={() => openVolume(volume)}
                    info={volume.is_mounted === false ? `${mounting === volume.device ? 'Mounting…' : 'Not mounted'} · ${formatFileSize(volume.drive_size || volume.size)} drive`
                        : `${(volume.available_space / 1024 ** 3).toFixed(1)}GB free of ${(volume.size / 1024 ** 3).toFixed(1)}GB`} />)}</ul>}
            </section>
        </div>
        <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical"
            aria-valuemin={COLLAPSED_WIDTH} aria-valuemax={Math.round(maximumWidth())} aria-valuenow={collapsed ? COLLAPSED_WIDTH : width}
            tabIndex={0} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize}
            onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={resizeKey} />
    </aside>;
}
