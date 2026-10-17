import React, { useEffect, useRef, useState } from 'react';
import { useSftp } from '../../providers/SftpProvider';
import { getImageThumbnail } from '../../utils/imageThumbnails';
import './imageThumbnail.css';

const ImageThumbnail = ({ path, filename, revision, size, mediaType = 'image', children }) => {
    const { isSftpPath, parseSftpPath } = useSftp();
    const element = useRef(null);
    const [visible, setVisible] = useState(false);
    const [source, setSource] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!window.IntersectionObserver) { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '160px' });
        observer.observe(element.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        const load = async () => {
            try {
                const remote = isSftpPath(path) ? parseSftpPath(path) : null;
                if (isSftpPath(path) && !remote?.connection) throw new Error('Connection unavailable');
                const url = await getImageThumbnail(path, revision, size, remote, mediaType);
                if (!cancelled) { setSource(url); setFailed(false); }
            } catch {
                if (!cancelled) setFailed(true);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [path, revision, size, mediaType, visible, isSftpPath, parseSftpPath]);

    return (
        <span ref={element} className="image-thumbnail">
            {source && !failed ? <img className="file-thumbnail" src={source} alt={filename}
                decoding="async" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : children}
        </span>
    );
};

export default ImageThumbnail;
