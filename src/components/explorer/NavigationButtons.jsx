import React, { useCallback, useEffect } from 'react';
import { useHistory } from '../../providers/HistoryProvider';
import { useFileSystem } from '../../providers/FileSystemProvider';
import './navigationButtons.css';

/**
 * NavigationButtons component - Provides back, forward, and refresh navigation controls
 * @returns {React.ReactElement} NavigationButtons component
 */
const NavigationButtons = () => {
    const { canGoBack, canGoForward, goBack, goForward, currentPath } = useHistory();
    const { loadDirectory, loadVolumes } = useFileSystem();

    /**
     * Handles directory refresh action
     * Reloads the current directory and displays notification feedback
     * @async
     */
    const handleRefresh = useCallback(async () => {
        if (currentPath) {
            try {
                // Refresh volumes (disks, space, etc.)
                await loadVolumes();
                await loadDirectory(currentPath);
                console.log('Directory and volumes refreshed successfully');

                // Optionally show a brief success indicator
                const notification = document.createElement('div');
                notification.textContent = 'Directory and disks refreshed';
                notification.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: var(--success-surface);
                    color: var(--text-primary);
                    box-shadow: 0 0 0 1px var(--border-strong);
                    padding: 8px 16px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-size: 14px;
                    animation: slideIn 0.3s ease-out;
                `;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.remove();
                }, 2000);
            } catch (error) {
                console.error('Failed to refresh directory or disks:', error);

                // Show error notification
                const notification = document.createElement('div');
                notification.textContent = 'Failed to refresh directory or disks';
                notification.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: var(--error-surface);
                    color: var(--text-primary);
                    box-shadow: 0 0 0 1px var(--border-strong);
                    padding: 8px 16px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-size: 14px;
                    animation: slideIn 0.3s ease-out;
                `;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.remove();
                }, 3000);
            }
        }
        else {
            try {
                // Refresh volumes (disks, space, etc.)
                await loadVolumes();
                console.log('Volumes refreshed successfully');

                // Optionally show a brief success indicator
                const notification = document.createElement('div');
                notification.textContent = 'Volumes refreshed';
                notification.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: var(--success-surface);
                    color: var(--text-primary);
                    box-shadow: 0 0 0 1px var(--border-strong);
                    padding: 8px 16px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-size: 14px;
                    animation: slideIn 0.3s ease-out;
                `;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.remove();
                }, 2000);
            } catch (error) {
                console.error('Failed to refresh volumes:', error);

                // Show error notification
                const notification = document.createElement('div');
                notification.textContent = 'Failed to refresh volumes';
                notification.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: var(--error-surface);
                    color: var(--text-primary);
                    box-shadow: 0 0 0 1px var(--border-strong);
                    padding: 8px 16px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-size: 14px;
                    animation: slideIn 0.3s ease-out;
                `;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.remove();
                }, 3000);
            }
        }
    }, [currentPath, loadDirectory, loadVolumes]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.target.closest?.('.enhanced-terminal')) return;
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r') {
                event.preventDefault();
                if (!event.repeat) handleRefresh();
            }
            if (event.defaultPrevented || event.key !== 'Backspace' || event.ctrlKey || event.metaKey ||
                event.altKey || event.isComposing || event.target.isContentEditable ||
                event.target.closest?.('input, textarea, select, [role="textbox"], [role="dialog"]')) return;

            event.preventDefault();
            if (event.repeat) return;
            if (event.shiftKey) {
                if (canGoForward) goForward();
            } else if (canGoBack) {
                goBack();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleRefresh, canGoBack, goBack, canGoForward, goForward]);

    return (
        <div className="navigation-buttons">
            <button
                className="nav-button"
                onClick={goBack}
                disabled={!canGoBack}
                aria-label="Go back"
                aria-keyshortcuts="Backspace"
                title="Go back (Backspace)"
            >
                <span className="icon icon-arrow-left"></span>
            </button>

            <button
                className="nav-button"
                onClick={goForward}
                disabled={!canGoForward}
                aria-label="Go forward"
                aria-keyshortcuts="Shift+Backspace"
                title="Go forward (Shift+Backspace)"
            >
                <span className="icon icon-arrow-right"></span>
            </button>

            <button
                className="nav-button"
                onClick={handleRefresh}
                aria-label="Refresh"
                aria-keyshortcuts="Control+r Meta+r"
                title="Refresh current directory (Ctrl+R)"
            >
                <span className="icon icon-refresh"></span>
            </button>
        </div>
    );
};

export default NavigationButtons;
