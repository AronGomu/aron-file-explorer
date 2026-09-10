import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { showError } from '../utils/NotificationSystem';

// Default settings - using exact backend keys and supported values
const defaultSettings = {
    // Core UI settings
    active_theme_id: "system",
    default_folder_path_on_opening: "",
    default_view: "grid", // Grid, List, Details
    font_size: "Medium", // Small, Medium, Large
    show_hidden_files_and_folders: false,
    show_details_panel: false,

    // Behavior settings
    confirm_delete: true,
    auto_refresh_dir: true,
    sort_direction: "Ascending", // Ascending, Descending
    sort_by: "Name", // Name, Size, Modified, Type
    double_click: "OpenFilesAndFolders", // OpenFilesAndFolders, SelectFilesAndFolders
    show_file_extensions: true,

    // Interface settings
    terminal_height: 240,
    enable_animations_and_transitions: true,
    enable_virtual_scroll_for_large_directories: false,

    // Search settings
    enable_suggestions: true,
    highlight_matches: true,

    // Backend settings that are nested but we'll manage them
    search_engine_enabled: true,
    case_sensitive_search: false,
    index_hidden_files: false,
    fuzzy_search_enabled: true,
    default_checksum_hash: "SHA256",
};

const LOAD_ERROR = 'Could not load settings. Defaults are temporary; existing file was not changed.';
const SettingsContext = createContext(null);

function flattenSettings(settings) {
    const search = settings.backend_settings?.search_engine_config ?? {};
    return {
        ...defaultSettings,
        ...settings,
        ...Object.fromEntries([
            'search_engine_enabled', 'case_sensitive_search', 'index_hidden_files', 'fuzzy_search_enabled',
        ].filter(key => Object.hasOwn(search, key)).map(key => [key, search[key]])),
        ...(settings.backend_settings?.default_checksum_hash && {
            default_checksum_hash: settings.backend_settings.default_checksum_hash,
        }),
    };
}

export default function SettingsProvider({ children }) {
    const [settings, setSettings] = useState(defaultSettings);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const queue = useRef(Promise.resolve());
    const loadGeneration = useRef(0);

    // Serialize local writes/reset/snapshots so late responses cannot restore old preferences.
    const enqueue = useCallback(operation => {
        const result = queue.current.then(operation);
        queue.current = result.then(() => undefined, () => undefined);
        return result;
    }, []);

    const loadSettings = useCallback(() => {
        const generation = ++loadGeneration.current;
        return enqueue(async () => {
            if (generation !== loadGeneration.current) return;
            try {
                const snapshot = await invoke('get_settings_snapshot');
                if (generation !== loadGeneration.current) return;
                setSettings(flattenSettings(snapshot.settings));
                setLoadError(snapshot.loadError);
                if (snapshot.loadError) showError(snapshot.loadError, 5000);
            } catch {
                if (generation !== loadGeneration.current) return;
                setLoadError(LOAD_ERROR);
                showError(LOAD_ERROR, 5000);
            } finally {
                if (generation === loadGeneration.current) setIsLoading(false);
            }
        });
    }, [enqueue]);

    useEffect(() => {
        loadSettings();
        return () => { loadGeneration.current++; };
    }, [loadSettings]);

    const updateSetting = useCallback((key, value) => enqueue(async () => {
        if (key === 'active_theme_id') {
            const result = await invoke('set_active_theme_id', { id: value });
            setSettings(previous => ({ ...previous, active_theme_id: result.active_theme_id }));
            return;
        }
        try {
            const json = await invoke('update_settings_field', { key, value });
            setSettings(flattenSettings(JSON.parse(json)));
            setError(null);
        } catch (failure) {
            setError(`Failed to update ${key}: ${failure.message || failure}`);
        }
    }), [enqueue]);

    const updateMultipleSettings = useCallback(updates => enqueue(async () => {
        if (Object.keys(updates).some(key => key.split('.')[0] === 'active_theme_id')) {
            throw new Error('Use set_active_theme_id for theme selection');
        }
        try {
            const json = await invoke('update_multiple_settings_command', { updates });
            setSettings(flattenSettings(JSON.parse(json)));
            setError(null);
        } catch (failure) {
            setError(`Failed to update settings: ${failure.message || failure}`);
        }
    }), [enqueue]);

    const resetSettings = useCallback(() => enqueue(async () => {
        try {
            const json = await invoke('reset_settings_command');
            setSettings(flattenSettings(JSON.parse(json)));
            setError(null);
        } catch (failure) {
            setError(`Failed to reset settings: ${failure.message || failure}`);
            throw failure;
        }
    }), [enqueue]);

    return (
        <SettingsContext.Provider value={{ settings, isLoading, error: loadError || error,
            updateSetting, updateMultipleSettings, resetSettings, reloadSettings: loadSettings }}>
            {isLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center',
                    height: '100vh', flexDirection: 'column', gap: '16px',
                    backgroundColor: 'var(--background)', color: 'var(--text-secondary)' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)',
                        borderTopColor: 'var(--focus-ring)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <div style={{ fontSize: '14px' }}>Loading settings...</div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            ) : children}
        </SettingsContext.Provider>
    );
}

export const useSettings = () => useContext(SettingsContext);
