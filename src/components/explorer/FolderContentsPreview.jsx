import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../../providers/SettingsProvider';
import { useSftp } from '../../providers/SftpProvider';
import FileIcon from './FileIcon';

const FolderContentsPreview = ({ path, viewMode }) => {
    const { settings } = useSettings();
    const { isSftpPath, parseSftpPath } = useSftp();
    const [result, setResult] = useState({ path: null, items: null, error: null });

    useEffect(() => {
        let cancelled = false;
        setResult({ path, items: null, error: null });

        const loadContents = async () => {
            try {
                let data;
                if (isSftpPath(path)) {
                    const parsed = parseSftpPath(path);
                    if (!parsed?.connection) throw new Error('SFTP connection unavailable');
                    const { connection, remotePath } = parsed;
                    data = JSON.parse(await invoke('load_dir', {
                        host: connection.host,
                        port: Number.parseInt(connection.port, 10),
                        username: connection.username,
                        password: connection.password,
                        directory: remotePath || '.'
                    }));
                } else {
                    data = JSON.parse(await invoke('open_directory', { path }));
                }

                const normalize = (entry, isDirectory) => typeof entry === 'string'
                    ? { path: entry, name: entry.split('/').filter(Boolean).pop(), isDirectory }
                    : { ...entry, isDirectory };
                const items = [
                    ...(data.directories || []).map(entry => normalize(entry, true)),
                    ...(data.files || []).map(entry => normalize(entry, false))
                ].filter(entry => entry.name && entry.name !== '.' && entry.name !== '..')
                    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) ||
                        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

                if (!cancelled) setResult({ path, items, error: null });
            } catch {
                if (!cancelled) setResult({ path, items: null, error: 'Could not load this folder’s contents.' });
            }
        };

        loadContents();
        return () => { cancelled = true; };
    }, [path, isSftpPath, parseSftpPath]);

    if (result.path !== path || (!result.items && !result.error)) {
        return <p role="status">Loading folder contents…</p>;
    }
    if (result.error) return <p role="alert">{result.error}</p>;

    const items = settings.show_hidden_files_and_folders
        ? result.items : result.items.filter(entry => !entry.name.startsWith('.'));
    if (!items.length) return <p role="status">This folder is empty.</p>;

    return (
        <div className={`folder-preview-items view-mode-${viewMode === 'grid' ? 'grid' : 'list'}`}
            role="list" aria-label="Folder contents">
            {items.map(entry => (
                <div key={entry.path} className="folder-preview-item" role="listitem" title={entry.name}>
                    <FileIcon filename={entry.name} isDirectory={entry.isDirectory} />
                    <span className="folder-preview-name truncate">{entry.name}</span>
                </div>
            ))}
        </div>
    );
};

export default FolderContentsPreview;
