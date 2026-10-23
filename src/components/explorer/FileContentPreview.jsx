import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useSftp } from '../../providers/SftpProvider';
import { getFileIconType } from '../../utils/icons';
import { getPreviewFilePath } from '../../utils/imageThumbnails';
import { showConfirm, showError, showSuccess } from '../../utils/NotificationSystem';
import FileIcon from './FileIcon';
import FolderContentsPreview from './FolderContentsPreview';
import VideoPreview from './VideoPreview';

const FileContentPreview = ({ item, viewMode, autoCopy = true, focusRequest, onEditorFocused }) => {
    const { isSftpPath, parseSftpPath } = useSftp();
    const [result, setResult] = useState(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const savePending = useRef(false);
    const dirtyRef = useRef(false);
    const editorRef = useRef(null);
    const [playbackError, setPlaybackError] = useState(false);
    const mediaRef = useRef(null);
    const codeRef = useRef(null);
    const lineNumbers = useMemo(() => {
        if (result?.text == null) return '';
        return Array.from({ length: (dirtyRef.current ? draft : result.text).split(/\r\n|\r|\n/).length }, (_, index) => index + 1).join('\n');
    }, [result?.text, draft]);
    const isDirectory = item.isDirectory || 'sub_file_count' in item;
    const category = isDirectory ? 'folder' : getFileIconType(item.name);
    const revision = `${item.last_modified || ''}:${item.size_in_bytes ?? ''}`;
    const isMedia = category === 'video' || category === 'audio';
    const editable = !isDirectory && /\.txt$/i.test(item.name) && !isSftpPath(item.path) &&
        typeof result?.text === 'string' && !result.truncated;

    useEffect(() => {
        if (!focusRequest || !editable) return;
        const frame = requestAnimationFrame(() => {
            editorRef.current?.focus({ preventScroll: true });
            onEditorFocused?.();
        });
        return () => cancelAnimationFrame(frame);
    }, [focusRequest, editable, onEditorFocused]);

    useEffect(() => {
        if (isDirectory || category === 'image' || dirtyRef.current || savePending.current) return;
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
                    const media = isMedia
                        ? await invoke('get_media_preview_url', { path, video: false })
                        : { url: convertFileSrc(path) };
                    preview = { ...media, path, url: `${media.url}?v=${encodeURIComponent(revision)}` };
                } else if (remote) {
                    const { connection, remotePath } = remote;
                    preview = await invoke('get_text_preview_sftp', {
                        host: connection.host, port: Number.parseInt(connection.port, 10),
                        username: connection.username, password: connection.password, filePath: remotePath
                    });
                } else {
                    preview = await invoke('get_text_preview', { path: item.path });
                }
                if (!cancelled) {
                    setResult(preview);
                    setDraft(preview.text?.replace(/\r\n|\r/g, '\n') || '');
                }
            } catch (error) {
                if (!cancelled) setResult({ error: 'Could not load this file’s preview.' });
            }
        };
        load();
        return () => { cancelled = true; };
    }, [item.path, revision, isDirectory, category, isMedia, isSftpPath, parseSftpPath]);

    const saveText = useCallback(async () => {
        if (!editable || savePending.current) return;
        savePending.current = true;
        setSaving(true);
        try {
            if (!await showConfirm(`Save changes to "${item.name}"?`, 'Save text file')) return;
            const text = await invoke('save_text_preview', { path: item.path, originalText: result.text, text: draft });
            setResult(previous => ({ ...previous, text }));
            dirtyRef.current = false;
            setSaved(true);
        } catch (error) {
            showError(`Could not save text file: ${error}`);
        } finally {
            savePending.current = false;
            setSaving(false);
            editorRef.current?.focus({ preventScroll: true });
        }
    }, [editable, item.path, item.name, result?.text, draft]);

    useEffect(() => {
        if (!editable) return;
        const shortcut = event => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
            if (document.querySelector('[role="dialog"], .modal-overlay') ||
                (event.target.closest?.('input, textarea, select, [contenteditable="true"]') && event.target !== editorRef.current)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) saveText();
        };
        window.addEventListener('keydown', shortcut);
        return () => window.removeEventListener('keydown', shortcut);
    }, [editable, saveText]);

    useEffect(() => {
        const media = mediaRef.current;
        return () => { media?.pause(); };
    }, [result?.url]);

    const handleTextKeyDown = (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'a') return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
        event.preventDefault();
        event.stopPropagation();
    };

    const getSelectedText = useCallback(() => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !codeRef.current) return '';
        const range = selection.getRangeAt(0).cloneRange();
        if (range.collapsed || !range.intersectsNode(codeRef.current)) return '';

        // Restrict copied content to the code, even if selection crosses the gutter or status text.
        const content = document.createRange();
        content.selectNodeContents(codeRef.current);
        if (range.compareBoundaryPoints(Range.START_TO_START, content) < 0) {
            range.setStart(content.startContainer, content.startOffset);
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, content) > 0) {
            range.setEnd(content.endContainer, content.endOffset);
        }
        return range.toString();
    }, []);

    useEffect(() => {
        if (!autoCopy || editable || typeof result?.text !== 'string') return;
        let timer;
        let cancelled = false;
        let copyQueue = Promise.resolve();
        const handleSelectionChange = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const selection = window.getSelection();
                const code = codeRef.current;
                if (!code || (!code.contains(selection?.anchorNode) && !code.contains(selection?.focusNode))) return;
                const text = getSelectedText();
                if (!text) return;
                copyQueue = copyQueue.then(async () => {
                    if (cancelled || getSelectedText() !== text) return;
                    await writeText(text);
                    if (!cancelled) showSuccess('Text copied to clipboard.', 1500);
                }).catch(() => {
                    if (!cancelled) showError('Failed to copy selected text to clipboard.');
                });
            }, 200);
        };
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener('selectionchange', handleSelectionChange);
        };
    }, [result?.text, getSelectedText, autoCopy, editable]);

    const handleTextCopy = (event) => {
        const text = getSelectedText();
        if (!text) return;
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        event.stopPropagation();
    };

    if (isDirectory) return <FolderContentsPreview path={item.path} viewMode={viewMode} />;
    if (category === 'image') {
        return <div className="preview-image">
            <FileIcon filename={item.name} path={item.path} revision={revision}
                isDirectory={false} size="large" thumbnailSize={1024} />
        </div>;
    }
    if (!result) return <p className="preview-status" role="status">
        Loading preview…
    </p>;
    if (result.error) return <p className="preview-status" role="alert">{result.error}</p>;

    if (category === 'video') return <VideoPreview path={result.path} url={result.url} name={item.name} />;
    if (category === 'audio') {
        return <div className="preview-media">
            <audio ref={mediaRef} src={result.url} controls preload="metadata"
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
    if (editable) return <div className="preview-text">
        <div className="preview-editor-layout">
            <div className="preview-line-numbers" aria-hidden="true" ref={codeRef}>{lineNumbers}</div>
            <textarea ref={editorRef} className="preview-text-editor" aria-label={`Edit ${item.name}`}
                value={draft} readOnly={saving} spellCheck={false} wrap="off"
                onScroll={event => { if (codeRef.current) codeRef.current.scrollTop = event.currentTarget.scrollTop; }}
                onChange={event => {
                    setDraft(event.target.value);
                    dirtyRef.current = event.target.value !== result.text.replace(/\r\n|\r/g, '\n');
                    setSaved(false);
                }} />
        </div>
        <div className="preview-text-actions">
            <button type="button" className="icon-button" aria-label="Save text file" title="Save text file (Ctrl+S)"
                aria-keyshortcuts="Control+s Meta+s" disabled={saving} onClick={saveText}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" />
                    <path d="M17 21v-8H7v8M7 3v5h9V3" />
                </svg>
            </button>
            <span role="status">{saving ? 'Saving…' : dirtyRef.current ? 'Unsaved changes' : saved ? 'Saved' : 'Click text to edit'}</span>
        </div>
    </div>;
    return <div className="preview-text">
        <div className="preview-code-scroll" tabIndex={0} role="region" aria-label={`Contents of ${item.name}`}
            onKeyDown={handleTextKeyDown} onCopy={handleTextCopy}
            onPointerDown={(event) => {
                if (event.button === 0) event.currentTarget.focus({ preventScroll: true });
            }}>
            <div className="preview-code-layout">
                <div className="preview-line-numbers" aria-hidden="true">
                    {lineNumbers}
                </div>
                <pre><code ref={codeRef}>
                    {result.highlights?.length ? result.highlights.map((segment, index) => (
                        <span key={index} data-highlight={segment.kind || undefined}>{segment.text}</span>
                    )) : result.text}
                </code></pre>
            </div>
        </div>
        {result.text === '' && <p className="preview-status" role="status">This file is empty.</p>}
        {result.truncated && <p className="preview-status" role="status">Showing the first 256 KiB.</p>}
    </div>;
};

export default FileContentPreview;
