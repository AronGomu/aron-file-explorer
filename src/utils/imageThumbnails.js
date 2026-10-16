import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const thumbnails = new Map();
const remoteFiles = new Map();
const pending = [];
let active = 0;

function pump() {
    while (active < 4 && pending.length) {
        const { load, resolve, reject } = pending.shift();
        active++;
        Promise.resolve().then(load).then(resolve, reject).finally(() => { active--; pump(); });
    }
}

function cache(map, key, load) {
    if (map.has(key)) return map.get(key);
    if (map.size >= 256) map.delete(map.keys().next().value);
    const promise = load().catch(error => { map.delete(key); throw error; });
    map.set(key, promise);
    return promise;
}

export function getPreviewFilePath(path, revision, remote) {
    if (!remote) return Promise.resolve(path);
    return cache(remoteFiles, JSON.stringify([path, revision]), () => {
        const { connection, remotePath } = remote;
        return invoke('download_and_open_sftp_file', {
            host: connection.host, port: Number.parseInt(connection.port, 10),
            username: connection.username, password: connection.password,
            filePath: remotePath, openFile: false
        });
    });
}

export function getImageThumbnail(path, revision, size, remote) {
    const key = JSON.stringify([path, revision, size]);
    return cache(thumbnails, key, () => new Promise((resolve, reject) => {
        pending.push({ resolve, reject, load: async () => {
            const localPath = await getPreviewFilePath(path, revision, remote);
            const extension = path.split('.').pop().toLowerCase();
            let imagePath = localPath;
            if (!['svg', 'svgz', 'avif'].includes(extension) && !(['gif', 'apng'].includes(extension) && size >= 512)) {
                try {
                    imagePath = await invoke('get_image_thumbnail', { path: localPath, size });
                } catch {
                    // Native image decoding may support formats outside the thumbnail decoder.
                }
            }
            return `${convertFileSrc(imagePath)}?v=${encodeURIComponent(revision)}`;
        } });
        pump();
    }));
}
