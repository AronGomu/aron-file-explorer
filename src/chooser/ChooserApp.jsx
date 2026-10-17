import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import SettingsProvider from '../providers/SettingsProvider';
import ThemeProvider, { useTheme } from '../providers/ThemeProvider';
import { FileSystemContext } from '../providers/FileSystemProvider';
import { HistoryContext } from '../providers/HistoryProvider';
import { ContextMenuContext } from '../providers/ContextMenuProvider';
import FileList from '../components/explorer/FileList';
import DetailsPanel from '../components/explorer/DetailsPanel';
import { getDirectoryPath } from '../utils/pathUtils';
import { constrainSelection, initialChoices, selectionPaths } from './selection';
import './chooser.css';

export default function ChooserApp({ request }) {
    return <SettingsProvider><ThemeProvider><Chooser request={request} /></ThemeProvider></SettingsProvider>;
}

function Chooser({ request }) {
    const [tabs, setTabs] = useState([{ id: 'initial', history: [request.currentFolder], index: 0 }]);
    const [activeTab, setActiveTab] = useState('initial');
    const tab = tabs.find(t => t.id === activeTab) || tabs[0];
    const currentPath = tab.history[tab.index];
    const [pathInput, setPathInput] = useState(currentPath);
    const [data, setData] = useState(null);
    const [selectedItems, setSelectedItems] = useState([]);
    const [focusedItem, setFocusedItem] = useState(null);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [revision, refresh] = useState(0);
    const [viewMode, setViewMode] = useState('list');
    const [preview, setPreview] = useState(true);
    const [hidden, setHidden] = useState(false);
    const [query, setQuery] = useState('');
    const [name, setName] = useState(request.currentName || '');
    const [choices, setChoices] = useState(() => initialChoices(request.choices));
    const availableFilters = request.filters.length ? request.filters : request.currentFilter ? [request.currentFilter] : [];
    const [filterIndex, setFilterIndex] = useState(() => Math.max(0, availableFilters.findIndex(f => JSON.stringify(f) === JSON.stringify(request.currentFilter))));
    const filter = availableFilters[filterIndex] || null;
    const [volumes, setVolumes] = useState([]);
    const [favorites, setFavorites] = useState(() => {
        try { return JSON.parse(localStorage.getItem('chooserFavorites') || '[]').filter(p => typeof p === 'string' && p.startsWith('/')); }
        catch { return []; }
    });
    const [folderDialog, setFolderDialog] = useState(false);
    const [folderName, setFolderName] = useState('');
    const viewStates = useRef(new Map());
    const pathRef = useRef(null);
    const searchRef = useRef(null);
    const { themes, activeThemeId, setTheme } = useTheme();

    const clearSelection = useCallback(() => { setSelectedItems([]); setFocusedItem(null); }, []);
    const loadDirectory = useCallback(path => {
        if (!path?.startsWith('/')) { setError('Choose a local folder or a locally mounted drive.'); return; }
        setTabs(previous => previous.map(t => t.id === activeTab
            ? { ...t, history: [...t.history.slice(0, t.index + 1), path], index: t.index + 1 } : t));
        setQuery('');
    }, [activeTab]);
    const selectMultiple = useCallback(items => setSelectedItems(constrainSelection(items, request)), [request]);
    const selectItem = useCallback((item, multiple = false) => {
        setSelectedItems(previous => constrainSelection(multiple
            ? previous.some(p => p.path === item.path) ? previous.filter(p => p.path !== item.path) : [...previous, item]
            : [item], request));
        if (request.mode === 'SaveFile' && !item.isDirectory) setName(item.name);
    }, [request]);
    const getDirectoryViewState = useCallback(path => viewStates.current.get(`${activeTab}:${path}`), [activeTab]);
    const saveDirectoryViewState = useCallback((path, state) => viewStates.current.set(`${activeTab}:${path}`, state), [activeTab]);

    useEffect(() => {
        let cancelled = false;
        setPathInput(currentPath); clearSelection(); setLoading(true); setError(''); setData(null);
        invoke('chooser_list', { path: currentPath, filter }).then(entries => {
            if (!cancelled) setData({ ...entries, directory: currentPath });
        }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [currentPath, activeTab, filterIndex, revision]);

    useEffect(() => {
        invoke('get_system_volumes_information').then(setVolumes).catch(() => {});
    }, []);

    const cancel = useCallback(() => invoke('chooser_finish', { selection: null, overwriteConfirmed: false }).catch(e => setError(String(e))), []);
    const accept = async (explicitPath) => {
        if (busyRef.current || isLoading) return;
        busyRef.current = true; setBusy(true); setError('');
        const selection = {
            paths: explicitPath ? [explicitPath] : selectionPaths(selectedItems, request, currentPath),
            folder: request.mode === 'SaveFiles' && selectedItems[0]?.isDirectory ? selectedItems[0].path : currentPath, name: explicitPath && request.mode === 'SaveFile' ? explicitPath.split('/').pop() : name,
            choices: Object.entries(choices), currentFilter: filter,
        };
        try {
            const checked = await invoke('chooser_check', { selection });
            let overwriteConfirmed = false;
            if (checked.overwrite.length) {
                overwriteConfirmed = await confirm(`Replace the existing file?\n${checked.overwrite.join('\n')}`, { title: 'Confirm replacement', kind: 'warning' });
                if (!overwriteConfirmed) return;
            }
            await invoke('chooser_finish', { selection, overwriteConfirmed });
        } catch (e) { setError(String(e)); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const openFile = path => {
        if (request.directory || request.mode === 'SaveFiles') return;
        const selected = selectedItems.some(item => item.path === path);
        accept(request.multiple && selected ? undefined : path);
    };

    useEffect(() => {
        const keyboard = event => {
            if (event.defaultPrevented || event.isComposing || busyRef.current) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation();
                if (folderDialog) setFolderDialog(false);
                else if (query) setQuery('');
                else cancel();
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
                event.preventDefault(); pathRef.current?.focus(); pathRef.current?.select();
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault(); searchRef.current?.focus();
            } else if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault(); loadDirectory(getDirectoryPath(currentPath));
            } else if (event.key === 'F5') { event.preventDefault(); refresh(n => n + 1); }
        };
        window.addEventListener('keydown', keyboard, true);
        return () => window.removeEventListener('keydown', keyboard, true);
    }, [folderDialog, query, currentPath, loadDirectory, cancel]);

    const visible = item => (hidden || !item.name.startsWith('.')) && (!query || item.name.toLowerCase().includes(query.toLowerCase()));
    const listing = useMemo(() => data && { ...data, files: request.directory || request.mode === 'SaveFiles' ? [] : data.files.filter(visible), directories: data.directories.filter(visible) }, [data, hidden, query, request.directory, request.mode]);
    const paths = selectionPaths(selectedItems, request, currentPath);
    const canAccept = !busy && !isLoading && !!data && (request.mode === 'OpenFile' ? paths.length > 0 : request.mode === 'SaveFiles' || !!name.trim());
    const backForward = step => setTabs(previous => previous.map(t => t.id === activeTab ? { ...t, index: Math.max(0, Math.min(t.history.length - 1, t.index + step)) } : t));
    const newTab = () => { const id = crypto.randomUUID(); setTabs(t => [...t, { id, history: [currentPath], index: 0 }]); setActiveTab(id); };
    const toggleFavorite = () => {
        const next = favorites.includes(currentPath) ? favorites.filter(p => p !== currentPath) : [...favorites, currentPath];
        setFavorites(next); localStorage.setItem('chooserFavorites', JSON.stringify(next));
    };
    const copyPath = () => writeText(selectedItems.map(item => item.path).join('\n') || currentPath).catch(e => setError(String(e)));
    const createFolder = async event => {
        event.preventDefault();
        try { const path = await invoke('chooser_new_folder', { folder: currentPath, name: folderName }); setFolderDialog(false); setFolderName(''); loadDirectory(path); }
        catch (e) { setError(String(e)); }
    };
    const context = { selectedItems, focusedItem, isLoading, currentDirData: listing, selectItem, selectMultiple, clearSelection, setFocusedItem, loadDirectory, openFile };
    const acceptLabel = (request.acceptLabel || (request.mode === 'OpenFile' ? 'Open' : 'Save')).replace(/_([^_])/g, '$1');

    return <FileSystemContext.Provider value={context}><HistoryContext.Provider value={{ currentPath, getDirectoryViewState, saveDirectoryViewState }}>
        <ContextMenuContext.Provider value={{ openContextMenu: event => event.preventDefault(), clipboard: { items: [], operation: null } }}>
        <main className="chooser-shell">
            <header className="chooser-heading"><strong>{request.title || 'Choose a file'}</strong><span>{request.appId}</span></header>
            <div className="chooser-tabs" role="tablist" aria-label="Folders">
                {tabs.map(t => <span key={t.id} className={t.id === activeTab ? 'active' : ''}>
                    <button role="tab" aria-selected={t.id === activeTab} onClick={() => setActiveTab(t.id)}>{t.history[t.index].split('/').filter(Boolean).at(-1) || '/'}</button>
                    {tabs.length > 1 && <button aria-label="Close tab" onClick={() => { const next = tabs.filter(x => x.id !== t.id); setTabs(next); if (activeTab === t.id) setActiveTab(next[0].id); }}>×</button>}
                </span>)}<button onClick={newTab} aria-label="New tab">＋</button>
            </div>
            <div className="chooser-navigation">
                <button aria-label="Back" disabled={!tab.index} onClick={() => backForward(-1)}>←</button>
                <button aria-label="Forward" disabled={tab.index === tab.history.length - 1} onClick={() => backForward(1)}>→</button>
                <button aria-label="Parent folder" onClick={() => loadDirectory(getDirectoryPath(currentPath))}>↑</button>
                <form onSubmit={event => { event.preventDefault(); loadDirectory(pathInput); }}><input aria-label="Folder path" ref={pathRef} value={pathInput} onChange={e => setPathInput(e.target.value)} /></form>
                <button aria-label="Refresh" onClick={() => refresh(n => n + 1)}>↻</button>
            </div>
            <div className="chooser-tools">
                <input ref={searchRef} aria-label="Search this folder" placeholder="Search this folder" value={query} onChange={e => { setQuery(e.target.value); clearSelection(); }} />
                <select aria-label="View" value={viewMode} onChange={e => setViewMode(e.target.value)}><option value="list">List</option><option value="grid">Grid</option><option value="details">Details</option></select>
                <label><input type="checkbox" checked={hidden} onChange={e => { setHidden(e.target.checked); clearSelection(); }} />Hidden</label>
                <button aria-pressed={preview} onClick={() => setPreview(p => !p)}>Preview</button>
                <button onClick={() => setFolderDialog(true)}>New Folder</button>
                <button onClick={copyPath}>Copy Path</button>
                <select aria-label="Theme" value={activeThemeId} onChange={e => setTheme(e.target.value)}><option value="system">System theme</option>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select>
            </div>
            <div className="chooser-content">
                <aside className="chooser-sidebar" aria-label="Locations">
                    <button onClick={() => loadDirectory(request.currentFolder)}>Starting folder</button>
                    <button onClick={() => loadDirectory('/')}>Filesystem</button>
                    {favorites.map(path => <button key={path} title={path} onClick={() => loadDirectory(path)}>{path.split('/').filter(Boolean).at(-1) || '/'}</button>)}
                    <button onClick={toggleFavorite}>{favorites.includes(currentPath) ? 'Remove favorite' : 'Favorite this folder'}</button>
                    <hr />{volumes.map(volume => <button key={volume.mount_point} title={volume.mount_point} onClick={() => loadDirectory(volume.mount_point)}>{volume.volume_name || volume.mount_point}</button>)}
                </aside>
                <div className="chooser-list"><FileList key={activeTab} data={listing} isLoading={isLoading} viewMode={viewMode} isSearching={!!query} searchTerm={query} /></div>
                <DetailsPanel item={focusedItem || selectedItems[0] || null} isMultipleSelection={selectedItems.length > 1} isCollapsed={!preview} onOpenChange={setPreview} viewMode={viewMode} autoCopy={false} />
            </div>
            {error && <p className="chooser-error" role="alert">{error}</p>}
            <footer className="chooser-footer">
                {request.mode === 'SaveFile' && <label className="chooser-filename">File name<input autoFocus aria-label="File name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); accept(); } }} /></label>}
                {request.mode === 'SaveFiles' && <p>Save {request.files.length} files in this folder. Existing names receive a numbered suffix.</p>}
                <div className="chooser-options">
                    {availableFilters.length > 0 && <label>File type<select aria-label="File type" value={filterIndex} onChange={e => setFilterIndex(Number(e.target.value))}>{availableFilters.map((f, i) => <option key={i} value={i}>{f[0]}</option>)}<option value={-1}>All files</option></select></label>}
                    {request.choices.map(([id, label, options]) => <label key={id}>{label}{options.length ? <select value={choices[id]} onChange={e => setChoices(c => ({ ...c, [id]: e.target.value }))}>{options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select> : <input type="checkbox" checked={choices[id] === 'true'} onChange={e => setChoices(c => ({ ...c, [id]: String(e.target.checked) }))} />}</label>)}
                    <span className="chooser-count">{selectedItems.length} selected</span>
                    <button onClick={cancel} disabled={busy}>Cancel</button>
                    <button className="chooser-accept" onClick={() => accept()} disabled={!canAccept}>{busy ? 'Checking…' : acceptLabel}</button>
                </div>
            </footer>
            {folderDialog && <div className="chooser-overlay"><form role="dialog" aria-modal="true" aria-label="New folder" onSubmit={createFolder}>
                <label>Folder name<input autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} /></label>
                <button type="button" onClick={() => setFolderDialog(false)}>Cancel</button><button type="submit" disabled={!folderName.trim()}>Create</button>
            </form></div>}
        </main>
        </ContextMenuContext.Provider></HistoryContext.Provider></FileSystemContext.Provider>;
}
