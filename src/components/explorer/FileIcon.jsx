import React from 'react';
import { getFileIconType } from '../../utils/icons';
import { getFileTypeIcon } from '../../utils/fileTypeIcons';
import ImageThumbnail from './ImageThumbnail';

const documentOutline = <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
</>;

const categoryIcons = {
    folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
    image: <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
    </>,
    video: <>
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
    </>,
    audio: <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
    </>,
    code: <>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
    </>,
    archive: <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
    pdf: <>
        {documentOutline}
        <path d="M9 15h6M12 12v6" />
    </>,
};

/** Displays one format-specific icon, with a generic category fallback. */
const FileIcon = ({ filename, path, revision = '', isDirectory, size = 'medium', thumbnailSize = size === 'large' ? 512 : 256 }) => {
    const formatIcon = isDirectory ? null : getFileTypeIcon(filename);
    const category = isDirectory ? 'folder' : getFileIconType(filename);
    const iconType = category === 'default' && formatIcon ? 'code' : category;

    const symbol = (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill={formatIcon?.path ? 'currentColor' : 'none'}
            stroke={formatIcon?.path ? 'none' : 'currentColor'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {formatIcon?.path ? <path d={formatIcon.path} /> : formatIcon?.label ? <>
                {documentOutline}
                <text x="12" y="16.5" textAnchor="middle" fontSize="5.5" fontFamily="sans-serif" fontWeight="700" fill="currentColor" stroke="none">
                    {formatIcon.label}
                </text>
            </> : categoryIcons[iconType] || <>
                {documentOutline}
                <path d="M8 13h8M8 17h8" />
            </>}
        </svg>
    );

    return (
        <div className={`file-icon file-icon-${iconType} file-icon-${size}`}>
            {path && category === 'image' ? (
                <ImageThumbnail key={`${path}:${revision}:${size}`} path={path} filename={filename}
                    revision={revision} size={thumbnailSize}>
                    {symbol}
                </ImageThumbnail>
            ) : symbol}
        </div>
    );
};

export default FileIcon;
