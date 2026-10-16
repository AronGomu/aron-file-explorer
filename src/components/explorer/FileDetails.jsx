import React from 'react';
import { formatFileSize, formatDate, getFileType } from '../../utils/formatters';
import { getDirectoryPath } from '../../utils/pathUtils';

const FileDetails = ({ item }) => {
    const isDirectory = item.isDirectory || 'sub_file_count' in item;
    const fileType = isDirectory ? 'Folder' : getFileType(item.name);
    const size = Number.isFinite(item.size_in_bytes) ? formatFileSize(item.size_in_bytes) : 'Unknown';

    return <>
        <div className="details-name" title={item.name}>{item.name}</div>
        <div className="details-type">{fileType}</div>
        <div className="details-section">
            <h4 className="details-section-title">General</h4>
            <div className="details-row">
                <span className="details-label">Location:</span>
                <span className="details-value truncate" title={item.path}>{getDirectoryPath(item.path)}</span>
            </div>
            <div className="details-row">
                <span className="details-label">{isDirectory ? 'Contents:' : 'Size:'}</span>
                <span className="details-value">
                    {isDirectory ? `${item.sub_file_count ?? 'Unknown'} files, ${item.sub_dir_count ?? 'Unknown'} folders` : <>
                        {size}
                        {Number.isFinite(item.size_in_bytes) && (
                            <span className="details-value-secondary"> ({item.size_in_bytes.toLocaleString()} bytes)</span>
                        )}
                    </>}
                </span>
            </div>
            <div className="details-row">
                <span className="details-label">Type:</span>
                <span className="details-value">{fileType}</span>
            </div>
        </div>
        <div className="details-section">
            <h4 className="details-section-title">Dates</h4>
            <div className="details-row">
                <span className="details-label">Created:</span>
                <span className="details-value">{formatDate(item.created, true)}</span>
            </div>
            <div className="details-row">
                <span className="details-label">Modified:</span>
                <span className="details-value">{formatDate(item.last_modified, true)}</span>
            </div>
            <div className="details-row">
                <span className="details-label">Accessed:</span>
                <span className="details-value">{formatDate(item.accessed, true)}</span>
            </div>
        </div>
        <div className="details-section">
            <h4 className="details-section-title">Permissions</h4>
            <div className="details-row">
                <span className="details-label">Access rights:</span>
                <span className="details-value">{item.access_rights_as_string ?? 'Unknown'}</span>
            </div>
            <div className="details-row">
                <span className="details-label">Octal:</span>
                <span className="details-value">{item.access_rights_as_number ?? 'Unknown'}</span>
            </div>
            <div className="details-row">
                <span className="details-label">Symlink:</span>
                <span className="details-value">{item.is_symlink == null ? 'Unknown' : item.is_symlink ? 'Yes' : 'No'}</span>
            </div>
        </div>
    </>;
};

export default FileDetails;
