import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSftp } from '../providers/SftpProvider';
import { getFileIconType } from '../utils/icons';
import { getPreviewFilePath } from '../utils/imageThumbnails';
import { formatDuration } from '../utils/formatters';

const durations = new Map();

export default function useMediaDuration(item, enabled = true) {
    const { isSftpPath, parseSftpPath } = useSftp();
    const [result, setResult] = useState(null);
    const isMedia = item && !item.isDirectory && !('sub_file_count' in item) &&
        ['audio', 'video'].includes(getFileIconType(item.name));
    const revision = `${item?.last_modified || ''}:${item?.size_in_bytes ?? ''}`;
    const key = JSON.stringify([item?.path, revision]);

    useEffect(() => {
        if (!isMedia || !enabled) return;
        let cancelled = false;
        let pending = durations.get(key);
        if (!pending) {
            pending = (async () => {
                const remote = isSftpPath(item.path) ? parseSftpPath(item.path) : null;
                if (isSftpPath(item.path) && !remote?.connection) throw new Error('Connection unavailable');
                const path = await getPreviewFilePath(item.path, revision, remote);
                return invoke('get_media_duration', { path });
            })();
            if (durations.size >= 128) durations.delete(durations.keys().next().value);
            durations.set(key, pending);
        }
        pending.then(seconds => {
            if (!cancelled) setResult({ key, text: formatDuration(seconds) });
        }).catch(() => {
            if (durations.get(key) === pending) durations.delete(key);
            if (!cancelled) setResult({ key, text: 'Unavailable' });
        });
        return () => { cancelled = true; };
    }, [isMedia, enabled, key, item?.path, revision, isSftpPath, parseSftpPath]);

    return isMedia ? (result?.key === key ? result.text : 'Loading…') : null;
}
