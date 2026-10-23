import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const SEGMENT_SECONDS = 5;

const VideoPreview = ({ path, url, name }) => {
    const videoRef = useRef(null);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        let disposed = false;
        let fallback = false;
        let switching = false;
        let wantedPlayback = false;
        let mediaSource;
        let buffer;
        let objectUrl;
        let pumping = false;
        const loaded = new Set();
        const fail = error => {
            if (!disposed) setError(String(error));
        };
        setError('');
        setReady(false);
        // Metadata must not delay mounting the directly playable source.
        const infoPromise = invoke('get_video_preview_info', { path }).catch(() => null);
        const bridgeGap = () => {
            if (!buffer || video.seeking) return;
            for (let index = 0; index < buffer.buffered.length; index++) {
                const start = buffer.buffered.start(index);
                if (start > video.currentTime && start - video.currentTime < 0.25) {
                    video.currentTime = start;
                    break;
                }
            }
        };
        const update = action => new Promise((resolve, reject) => {
            const cleanup = () => {
                buffer.removeEventListener('updateend', done);
                buffer.removeEventListener('error', failed);
            };
            const done = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('Could not decode this video preview.')); };
            buffer.addEventListener('updateend', done);
            buffer.addEventListener('error', failed);
            try { action(); } catch (error) { cleanup(); reject(error); }
        });
        const pump = async () => {
            if (disposed || !buffer || pumping) return;
            pumping = true;
            try {
                const info = await infoPromise;
                while (!disposed) {
                    const current = Math.floor(video.currentTime / SEGMENT_SECONDS) * SEGMENT_SECONDS;
                    const start = !loaded.has(current) ? current
                        : !video.paused && !loaded.has(current + SEGMENT_SECONDS) ? current + SEGMENT_SECONDS : null;
                    if (start === null || start >= info.duration) break;
                    const bytes = await invoke('get_video_preview_segment', { path, start });
                    if (disposed) break;
                    buffer.timestampOffset = start;
                    buffer.appendWindowEnd = info.duration;
                    await update(() => buffer.appendBuffer(bytes));
                    if (disposed) break;
                    loaded.add(start);
                    mediaSource.duration = info.duration;
                    bridgeGap();
                    switching = false;
                    checkMetadata();
                    if (wantedPlayback && video.paused) video.play().catch(() => {});
                    // Keep roughly 30 seconds in memory, including after distant seeks.
                    const position = Math.floor(video.currentTime / SEGMENT_SECONDS) * SEGMENT_SECONDS;
                    for (const previous of loaded) {
                        if (previous >= position - 10 && previous <= position + 15) continue;
                        await update(() => buffer.remove(previous, previous + SEGMENT_SECONDS));
                        loaded.delete(previous);
                    }
                    if (start + SEGMENT_SECONDS >= info.duration && mediaSource.readyState === 'open') {
                        mediaSource.endOfStream();
                    }
                }
            } catch (error) { fail(error); }
            finally { pumping = false; }
        };
        const useFallback = async () => {
            if (fallback || disposed) return;
            fallback = true;
            switching = true;
            clearTimeout(timer);
            try {
                const info = await infoPromise;
                if (disposed) return;
                const mime = `video/webm; codecs="vp8${info?.hasAudio ? ',vorbis' : ''}"`;
                if (!window.MediaSource?.isTypeSupported(mime)) {
                    // Platforms without WebM MSE retain the existing compatibility path.
                    const compatiblePath = await invoke('get_video_preview', { path });
                    const media = await invoke('get_media_preview_url', { path: compatiblePath, video: false });
                    if (disposed) return;
                    video.src = media.url;
                    switching = false;
                    if (wantedPlayback) video.play().catch(() => {});
                    return;
                }
                if (!info?.duration || info.hasAudio == null) throw new Error('Could not read this video’s metadata.');
                video.pause();
                mediaSource = new MediaSource();
                objectUrl = URL.createObjectURL(mediaSource);
                mediaSource.addEventListener('sourceopen', () => {
                    if (disposed) return;
                    try {
                        buffer = mediaSource.addSourceBuffer(mime);
                        mediaSource.duration = info.duration;
                        pump();
                    } catch (error) { fail(error); }
                }, { once: true });
                video.src = objectUrl;
            } catch (error) { fail(error); }
        };
        const checkMetadata = async () => {
            const info = await infoPromise;
            if (disposed || video.readyState < 2) return;
            if (!fallback && (video.videoWidth === 0 ||
                (info?.hasAudio && video.audioTracks?.length === 0))) {
                useFallback();
                return;
            }
            // Reveal only the final decoded source, after the audio probe settles.
            if (!switching && video.videoWidth > 0) {
                clearTimeout(timer);
                setReady(true);
            }
        };
        const onError = () => {
            if (!fallback) useFallback();
            else if (video.error) fail('This media format could not be played.');
        };
        const onPlay = () => { wantedPlayback = true; pump(); };
        const onPause = () => { if (!switching && !video.error) wantedPlayback = false; };
        const onWaiting = () => { bridgeGap(); pump(); };
        const timer = setTimeout(() => { if (video.readyState < 2) useFallback(); }, 750);
        video.addEventListener('loadedmetadata', checkMetadata);
        video.addEventListener('loadeddata', checkMetadata);
        video.addEventListener('error', onError);
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('seeking', pump);
        video.addEventListener('timeupdate', pump);
        video.addEventListener('waiting', onWaiting);
        // The audio probe can finish after loadedmetadata.
        infoPromise.then(() => { if (video.readyState >= 1) checkMetadata(); });
        // Legacy native demuxers can stall or fail to seek; convert only the requested chunk.
        if (!['mp4', 'm4v', 'webm'].includes(name.split('.').pop().toLowerCase())) useFallback();
        else { video.src = url; video.load(); }
        return () => {
            disposed = true;
            clearTimeout(timer);
            video.removeEventListener('loadedmetadata', checkMetadata);
            video.removeEventListener('loadeddata', checkMetadata);
            video.removeEventListener('error', onError);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('seeking', pump);
            video.removeEventListener('timeupdate', pump);
            video.removeEventListener('waiting', onWaiting);
            if (buffer?.updating && mediaSource.readyState === 'open') buffer.abort();
            video.pause();
            video.removeAttribute('src');
            video.load();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [path, url, name]);

    return <div className="preview-media preview-video" aria-busy={!ready && !error}>
        <video ref={videoRef} controls preload="auto" playsInline aria-label={`Play ${name}`}
            style={{ visibility: ready && !error ? 'visible' : 'hidden' }} />
        {!ready && !error && <p className="preview-status" role="status">Loading video…</p>}
        {error && <p className="preview-status" role="alert">{error}</p>}
    </div>;
};

export default VideoPreview;
