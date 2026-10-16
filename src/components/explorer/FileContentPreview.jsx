import React, { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useSftp } from '../../providers/SftpProvider';
import { getFileIconType } from '../../utils/icons';
import { getPreviewFilePath } from '../../utils/imageThumbnails';
import FileIcon from './FileIcon';
import FolderContentsPreview from './FolderContentsPreview';

const FileContentPreview = ({ item, viewMode }) => {
    const { isSftpPath, parseSftpPath } = useSftp();
    const [result, setResult] = useState(null);
    const [playbackError, setPlaybackError] = useState(false);
    const mediaRef = useRef(null);
    const isDirectory = item.isDirectory || 'sub_file_count' in item;
    const category = isDirectory ? 'folder' : getFileIconType(item.name);
    const revision = `${item.last_modified || ''}:${item.size_in_bytes ?? ''}`;
    const isMedia = category === 'video' || category === 'audio';

    useEffect(() => {
        if (isDirectory || category === 'image') return;
        let cancelled = false;
        setResult(null);
        setPlaybackError(false);
        const load = async () => {
            try {
                const remote = isSftpPath(item.path) ? parseSftpPath(item.path) : null;
                if (isSftpPath(item.path) && !remote?.connection) throw new Error('Connection unavailable');
                let preview;
                if (isMedia || category === 'pdf') {
                    const path = await getPreviewFilePath(item.path, revision, remote);
                    preview = { url: `${convertFileSrc(path)}?v=${encodeURIComponent(revision)}` };
                } else if (remote) {
                    const { connection, remotePath } = remote;
                    preview = await invoke('get_text_preview_sftp', {
                        host: connection.host, port: Number.parseInt(connection.port, 10),
                        username: connection.username, password: connection.password, filePath: remotePath
                    });
                } else {
                    preview = await invoke('get_text_preview', { path: item.path });
                }
                if (!cancelled) setResult(preview);
            } catch {
                if (!cancelled) setResult({ error: 'Could not load this file’s preview.' });
            }
        };
        load();
        return () => { cancelled = true; };
    }, [item.path, revision, isDirectory, category, isMedia, isSftpPath, parseSftpPath]);

    useEffect(() => {
        const media = mediaRef.current;
        return () => { media?.pause(); };
    }, [result?.url]);

    if (isDirectory) return <FolderContentsPreview path={item.path} viewMode={viewMode} />;
    if (category === 'image') {
        return <div className="preview-image">
            <FileIcon filename={item.name} path={item.path} revision={revision}
                isDirectory={false} size="large" thumbnailSize={1024} />
        </div>;
    }
    if (!result) return <p className="preview-status" role="status">Loading preview…</p>;
    if (result.error) return <p className="preview-status" role="alert">{result.error}</p>;

    if (isMedia) {
        const Player = category === 'video' ? 'video' : 'audio';
        return <div className="preview-media">
            <Player ref={mediaRef} src={result.url} controls preload="metadata" playsInline
                aria-label={`Play ${item.name}`} onError={() => setPlaybackError(true)} />
            {playbackError && <p className="preview-status" role="alert">This media format could not be played.</p>}
        </div>;
    }
    const unavailable = <div className="preview-unavailable">
        <FileIcon filename={item.name} isDirectory={false} size="large" />
        <span className="truncate" title={item.name}>{item.name}</span>
        <p>Preview unavailable for this file type.</p>
    </div>;
    if (category === 'pdf') {
        return <object className="preview-document" data={result.url} type="application/pdf"
            aria-label={`Preview of ${item.name}`}>{unavailable}</object>;
    }
    if (result.text === null) return unavailable;
    return <div className="preview-text">
        <pre tabIndex={0} aria-label={`Contents of ${item.name}`}><code>
            {result.highlights?.length ? result.highlights.map((segment, index) => (
                <span key={index} data-highlight={segment.kind || undefined}>{segment.text}</span>
            )) : result.text || 'This file is empty.'}
        </code></pre>
        {result.truncated && <p className="preview-status" role="status">Showing the first 256 KiB.</p>}
    </div>;
};

export default FileContentPreview;
