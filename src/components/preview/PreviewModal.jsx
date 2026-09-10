import React from 'react';
import Icon from '../common/Icon';
import { convertFileSrc } from '@tauri-apps/api/core';
import Modal from '../common/Modal';
import './PreviewModal.css';

/**
 * PreviewModal component - Displays file/folder previews in a modal
 * @param {Object} props - Component props
 * @param {Object} props.payload - The preview payload data
 * @param {Function} props.onClose - Function to call when closing the modal
 * @param {boolean} props.isLoading - Whether the preview is loading
 * @returns {React.ReactElement|null} PreviewModal component or null
 */
export function PreviewModal({ payload, onClose, isLoading }) {
  if (!payload && !isLoading) return null;

  return (
    <div className="preview-modal-backdrop" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <header className="preview-modal-header" style={{ minHeight: 32, height: 32, padding: '0 0.5rem', background: 'var(--surface)', display: 'flex', alignItems: 'center' }}>
          <button 
            onClick={onClose} 
            className="preview-modal-close"
            aria-label="Close preview"
            style={{ marginRight: 0 }}
          >
            <span className="icon icon-x"></span>
          </button>
          {payload?.name && payload?.kind !== 'Folder' && (
            <div style={{ marginLeft: 12, fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60vw' }}>
              {payload.name}
            </div>
          )}
          <div style={{ flex: 1 }}></div>
        </header>
        <div className="preview-modal-content">
          {isLoading ? (
            <div className="preview-loading">
              <div className="spinner"></div>
              <p>Loading preview...</p>
            </div>
          ) : (
            <PreviewContent payload={payload} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PreviewContent component - Renders the actual preview content based on payload type
 * @param {Object} props - Component props
 * @param {Object} props.payload - The preview payload data
 * @returns {React.ReactElement} Preview content
 */
function PreviewContent({ payload }) {
  if (!payload) return null;

  switch (payload.kind) {
    case 'Folder': {
      // macOS-style folder preview: big icon, name, size, item count, last modified
      // Assume payload has: name, size (bytes), itemCount, modified (ISO string)
      return (
        <div className="preview-folder-container">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2.5rem', minHeight: 180 }}>
            <div style={{ fontSize: '11rem', color: 'var(--folder)', flexShrink: 0, marginRight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '11.5rem', width: '11.5rem' }}>
              <Icon name="folder" size="xlarge" style={{ fontSize: '11rem', color: 'var(--folder)' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: '2rem', color: 'var(--text-primary)', alignSelf: 'flex-start' }}>
                {payload.name || 'Folder'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2.5rem', marginTop: 8 }}>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                  <span style={{ fontWeight: 500 }}>Size:</span> {typeof payload.size === 'number' ? formatFileSize(payload.size) : '—'}
                </div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                  <span style={{ fontWeight: 500 }}>Items:</span> {typeof payload.item_count === 'number' ? payload.item_count : (payload.itemCount ? payload.itemCount : (payload.entries ? payload.entries.length : '—'))}
                </div>
              </div>
              <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginTop: 8 }}>
                <span style={{ fontWeight: 500 }}>Last Modified:</span> {payload.modified ? (new Date(payload.modified)).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>
      );
    }
    case 'Image':
      return (
        <div className="preview-image-container">
          <img 
            src={payload.data_uri} 
            alt={payload.name}
            className="preview-image"
          />
          <div className="preview-image-info">
            <span className="preview-file-size">
              {formatFileSize(payload.bytes)}
            </span>
          </div>
        </div>
      );

    case 'Pdf':
      return (
        <div className="preview-pdf-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <iframe
            title={payload.name}
            src={payload.data_uri}
            style={{ flex: 1, width: '100%', height: 0, minHeight: 0, border: 'none' }}
          />
          <div className="preview-image-info" style={{ alignSelf: 'flex-end', marginTop: 8 }}>
            <span className="preview-file-size">
              {formatFileSize(payload.bytes)}
            </span>
          </div>
        </div>
      );

    case 'Video': {
      const url = convertFileSrc(payload.path);
      console.log('Video preview URL:', url, 'Original path:', payload.path);
      return (
        <div className="preview-video-container">
          <video 
            src={url} 
            controls 
            className="preview-video"
            preload="metadata"
          >
            Your browser does not support video preview.
          </video>
        </div>
      );
    }

    case 'Audio':
      return (
        <div className="preview-audio-container">
          <div className="preview-audio-player">
            <div className="preview-audio-icon">🎵</div>
            <audio 
              src={convertFileSrc(payload.path)} 
              controls 
              className="preview-audio"
              preload="metadata"
            >
              Your browser does not support audio preview.
            </audio>
          </div>
        </div>
      );

    case 'Text': {
      const lines = payload.text ? payload.text.split('\n') : [];
      return (
        <div className="preview-text-container">
          <pre className="preview-text with-line-numbers">
            {lines.map((line, idx) => (
              <div key={idx} className="preview-text-line">
                <span className="preview-line-number">{idx + 1}</span>
                <span className="preview-line-content">{line || '\u00A0'}</span>
              </div>
            ))}
          </pre>
          {payload.truncated && (
            <div className="preview-text-truncated">
              <p>Content truncated for performance. Open file to view complete content.</p>
            </div>
          )}
        </div>
      );
    }

    case 'Unknown':
      return (
        <div className="preview-unknown">
          <div className="preview-unknown-icon">📁</div>
          <p>Preview not available for this item.</p>
          <button 
            onClick={() => {
              // You could implement an "Open in default app" feature here
              console.log('Open in default app:', payload.name);
            }}
            className="btn btn-secondary"
          >
            Open in Default App
          </button>
        </div>
      );

    case 'Error':
      return (
        <div className="preview-error" role="alert">
          <div className="preview-error-icon">⚠️</div>
          <h3>Preview Error</h3>
          <p>{payload.message}</p>
        </div>
      );

    default:
      return (
        <div className="preview-unknown">
          <p>Unknown preview type.</p>
        </div>
      );
  }
}

/**
 * Format file size in human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default PreviewModal;
