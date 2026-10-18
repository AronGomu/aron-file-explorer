import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import SettingsProvider from '../providers/SettingsProvider';
import ThemeProvider, { useTheme } from '../providers/ThemeProvider';
import { FileSystemContext } from '../providers/FileSystemProvider';
import { HistoryContext } from '../providers/HistoryProvider';
import { ContextMenuContext } from '../providers/ContextMenuProvider';
import FileList from '../components/explorer/FileList';
import DetailsPanel from '../components/explorer/DetailsPanel';
import PathBreadcrumb from '../components/explorer/PathBreadcrumb';
import Modal from '../components/common/Modal';
import WindowControls from '../components/common/WindowControls';
import ChooserSidebar from './ChooserSidebar';
import usePersistedState from '../hooks/usePersistedState';
import { getDirectoryPath } from '../utils/pathUtils';
import { focusItemPane, isEditingTarget, restoreItemPaneAfterPointer } from '../utils/explorerFocus';
import { chooserListing, constrainSelection, initialChoices, selectionPaths } from './selection';
import '../styles/layouts/mainLayout.css';
import '../components/explorer/navigationButtons.css';
import '../components/explorer/viewModes.css';
import './chooser.css';

export default function ChooserApp({ request }) {
    return <SettingsProvider><ThemeProvider><Chooser request={request} /></ThemeProvider></SettingsProvider>;
}

function Chooser({ request }) {
    const [navigation, setNavigation] = useState({ history: [request.currentFolder], index: 0 });
    const currentPath = navigation.history[navigation.index];
    const [data, setData] = useState(null);
    const [selectedItems, setSelectedItems] = useState([]);
    const [focusedItem, setFocusedItem] = useState(null);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [revision, refresh] = useState(0);
    const [viewMode, setViewMode] = usePersistedState('chooserViewMode', 'list');
    const [preview, setPreview] = usePersistedState('chooserPreviewOpen', true);
    const [hidden, setHidden] = usePersistedState('chooserShowHidden', false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [name, setName] = useState(request.currentName || '');
    const [choices, setChoices] = useState(() => initialChoices(request.choices));
    const availableFilters = request.filters.length ? request.filters : request.currentFilter ? [request.currentFilter] : [];
    const [filterIndex, setFilterIndex] = useState(() => Math.max(0, availableFilters.findIndex(f => JSON.stringify(f) === JSON.stringify(request.currentFilter))));
    const filter = availableFilters[filterIndex] || null;
    const [volumes, setVolumes] = useState([]);
    const viewStates = useRef(new Map());
    const { themes, activeThemeId, setTheme, isSaving: themeSaving } = useTheme();

    const clearSelection = useCallback(() => { setSelectedItems([]); setFocusedItem(null); }, []);
    const loadDirectory = useCallback(path => {
        if (!path?.startsWith('/')) { setError('Choose a local folder or a locally mounted drive.'); return; }
        setNavigation(previous => previous.history[previous.index] === path ? previous : {
            history: [...previous.history.slice(0, previous.index + 1), path], index: previous.index + 1,
        });
        setQuery('');
        refresh(n => n + 1);
    }, []);
    const selectMultiple = useCallback(items => setSelectedItems(constrainSelection(items, request)), [request]);
    const selectItem = useCallback((item, multiple = false) => {
        setSelectedItems(previous => constrainSelection(multiple
            ? previous.some(p => p.path === item.path) ? previous.filter(p => p.path !== item.path) : [...previous, item]
            : [item], request));
        if (request.mode === 'SaveFile' && !item.isDirectory) setName(item.name);
    }, [request]);
    const getDirectoryViewState = useCallback(path => viewStates.current.get(path), []);
    const saveDirectoryViewState = useCallback((path, state) => viewStates.current.set(path, state), []);
    const loadVolumes = useCallback(async () => {
        try { setVolumes(await invoke('get_system_volumes_information')); }
        catch (failure) { setError(String(failure)); }
    }, []);

    useEffect(() => {
        let cancelled = false;
        clearSelection(); setLoading(true); setError(''); setData(null);
        invoke('chooser_list', { path: currentPath, filter }).then(entries => {
            if (!cancelled) setData({ ...entries, directory: currentPath });
        }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [currentPath, filterIndex, revision, clearSelection]);

    useEffect(() => { loadVolumes(); }, [loadVolumes]);

    const cancel = useCallback(() => invoke('chooser_finish', { selection: null, overwriteConfirmed: false }).catch(e => setError(String(e))), []);
    const accept = async (explicitPath) => {
        if (busyRef.current || isLoading) return;
        busyRef.current = true; setBusy(true); setError('');
        const selection = {
            paths: explicitPath ? [explicitPath] : selectionPaths(selectedItems, request, currentPath),
            folder: request.mode === 'SaveFiles' && selectedItems[0]?.isDirectory ? selectedItems[0].path : currentPath,
            name: explicitPath && request.mode === 'SaveFile' ? explicitPath.split('/').pop() : name,
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
    const backForward = useCallback(step => {
        setNavigation(previous => ({ ...previous, index: Math.max(0, Math.min(previous.history.length - 1, previous.index + step)) }));
        setQuery('');
    }, []);

    useEffect(() => {
        const keyboard = event => {
            if (event.defaultPrevented || event.isComposing || busyRef.current || settingsOpen || document.querySelector('[role="dialog"]')) return;
            if ((event.ctrlKey || event.metaKey) && event.key === ',') {
                event.preventDefault(); setSettingsOpen(true);
            } else if (event.key === 'Escape') {
                if (isEditingTarget(event.target)) return;
                event.preventDefault(); event.stopPropagation();
                if (query) setQuery(''); else cancel();
            } else if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault(); loadDirectory(getDirectoryPath(currentPath));
            } else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault(); backForward(event.key === 'ArrowLeft' ? -1 : 1);
            } else if (event.key === 'Backspace' && !isEditingTarget(event.target)) {
                event.preventDefault(); backForward(event.shiftKey ? 1 : -1);
            } else if (event.key === 'F5') { event.preventDefault(); refresh(n => n + 1); loadVolumes(); }
            else if (event.code === 'Space' && !isEditingTarget(event.target) && !event.target.closest?.('button, [role="button"], [role="separator"]')) {
                event.preventDefault(); if (!event.repeat) setPreview(open => !open);
            }
        };
        const restoreFocus = () => { if (!isEditingTarget(document.activeElement)) focusItemPane(); };
        window.addEventListener('keydown', keyboard, true);
        window.addEventListener('focus', restoreFocus);
        return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('focus', restoreFocus); };
    }, [settingsOpen, query, currentPath, loadDirectory, cancel, backForward, loadVolumes, setPreview]);

    const listing = useMemo(() => chooserListing(data, request, currentPath, hidden, query), [data, request, currentPath, hidden, query]);
    const paths = selectionPaths(selectedItems, request, currentPath);
    const canAccept = !busy && !isLoading && !!data && (request.mode === 'OpenFile' ? paths.length > 0 : request.mode === 'SaveFiles' || !!name.trim());
    const context = { selectedItems, focusedItem, isLoading, currentDirData: listing, volumes, loadVolumes,
        selectItem, selectMultiple, clearSelection, setFocusedItem, loadDirectory, openFile };
    const acceptLabel = (request.acceptLabel || (request.mode === 'OpenFile' ? 'Open' : 'Save')).replace(/_([^_])/g, '$1');
    const closeSettings = useCallback(() => { setSettingsOpen(false); requestAnimationFrame(focusItemPane); }, []);
    const trapSettingsFocus = event => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input, select:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
        }
    };

    return <FileSystemContext.Provider value={context}><HistoryContext.Provider value={{ currentPath, navigateTo: loadDirectory, getDirectoryViewState, saveDirectoryViewState }}>
        <ContextMenuContext.Provider value={{ openContextMenu: event => event.preventDefault(), clipboard: { items: [], operation: null },
            draggedItems: [], beginItemDrag: event => event.preventDefault(), endItemDrag: () => {} }}>
        <main className="chooser-shell" aria-label="File chooser" onPointerUpCapture={restoreItemPaneAfterPointer}
            onBlurCapture={() => requestAnimationFrame(() => { if (document.activeElement === document.body) focusItemPane(); })}>
            <div className="chooser-navigation" data-tauri-drag-region>
                <div className="navigation-buttons">
                    <button className="nav-button" aria-label="Go back" title="Go back (Backspace)" disabled={!navigation.index} onClick={() => backForward(-1)}><span className="icon icon-arrow-left" aria-hidden="true" /></button>
                    <button className="nav-button" aria-label="Go forward" title="Go forward (Shift+Backspace)" disabled={navigation.index === navigation.history.length - 1} onClick={() => backForward(1)}><span className="icon icon-arrow-right" aria-hidden="true" /></button>
                </div>
                <PathBreadcrumb onSearch={setQuery} />
                <div className="toolbar-drag-region" data-tauri-drag-region aria-hidden="true" />
                <div className="view-modes" role="group" aria-label="View mode">
                    {[{ id: 'grid', label: 'Icons view', icon: 'grid' }, { id: 'list', label: 'List view', icon: 'list' }].map(mode => (
                        <button key={mode.id} type="button" className={`view-mode-button ${viewMode === mode.id ? 'active' : ''}`}
                            onClick={() => setViewMode(mode.id)} aria-label={mode.label} aria-pressed={viewMode === mode.id} title={mode.label}>
                            <span className={`icon icon-${mode.icon}`} aria-hidden="true" />
                        </button>
                    ))}
                </div>
                <button type="button" className="icon-button" aria-label="File chooser settings" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
                    <span className="icon icon-settings" aria-hidden="true" />
                </button>
                <WindowControls onClose={cancel} closeDisabled={busy} />
            </div>
            <div className="chooser-content">
                <ChooserSidebar startingFolder={request.currentFolder} onError={setError} />
                <div className="chooser-list"><FileList data={listing} isLoading={isLoading} viewMode={viewMode} isSearching={!!query} searchTerm={query} disableArrowKeys={settingsOpen} /></div>
                <DetailsPanel item={focusedItem?.isParentNavigation ? null : focusedItem || selectedItems[0] || null} isMultipleSelection={selectedItems.length > 1} isCollapsed={!preview} onOpenChange={setPreview} onCollapse={() => setPreview(open => !open)} viewMode={viewMode} autoCopy={false} />
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
            <Modal isOpen={settingsOpen} onClose={closeSettings} title="File chooser settings" size="sm" className="chooser-settings" onKeyDown={trapSettingsFocus}>
                <label className="chooser-settings-field"><input type="checkbox" checked={hidden} onChange={event => { setHidden(event.target.checked); clearSelection(); }} />Show hidden files and folders</label>
                <label className="chooser-settings-field">Theme<select aria-label="File chooser theme" value={activeThemeId} disabled={themeSaving} onChange={event => setTheme(event.target.value)}>
                    <option value="system">System theme</option>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                </select></label>
            </Modal>
        </main>
        </ContextMenuContext.Provider></HistoryContext.Provider></FileSystemContext.Provider>;
}
