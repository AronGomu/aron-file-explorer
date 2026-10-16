import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../../providers/SettingsProvider';
import { useSftp } from '../../providers/SftpProvider';
import FileIcon from './FileIcon';
import { formatFileSize, formatDate, getFileType } from '../../utils/formatters';

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

    if (viewMode !== 'grid') {
        return (
            <table className="folder-preview-table" aria-label="Folder contents">
                <colgroup>
                    <col className="preview-column-name" />
                    <col className="preview-column-size" />
                    <col className="preview-column-type" />
                    <col className="preview-column-modified" />
                </colgroup>
                <thead>
                    <tr><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Type</th><th scope="col">Modified</th></tr>
                </thead>
                <tbody>
                    {items.map(entry => {
                        const size = !entry.isDirectory && Number.isFinite(entry.size_in_bytes)
                            ? formatFileSize(entry.size_in_bytes) : '—';
                        const type = entry.isDirectory ? 'Folder' : getFileType(entry.name);
                        const modified = entry.last_modified ? formatDate(entry.last_modified) : '—';
                        return (
                            <tr key={entry.path}>
                                <td>
                                    <div className="folder-preview-item" title={entry.name}>
                                        <FileIcon filename={entry.name} isDirectory={entry.isDirectory} />
                                        <span className="folder-preview-name truncate">{entry.name}</span>
                                    </div>
                                </td>
                                <td className="folder-preview-size" title={size}>{size}</td>
                                <td title={type}>{type}</td>
                                <td title={modified}>{modified}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }

    return (
        <div className="folder-preview-items view-mode-grid"
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
