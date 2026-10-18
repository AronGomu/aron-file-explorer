import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { showError } from '../../utils/NotificationSystem';
import './windowControls.css';

export default function WindowControls({ onClose, closeDisabled = false }) {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        const appWindow = getCurrentWindow();
        let alive = true;
        let unlisten;
        const update = async () => {
            try {
                const value = await appWindow.isMaximized();
                if (alive) setMaximized(value);
            } catch (error) { console.error('Could not read window state:', error); }
        };
        update();
        appWindow.onResized(update).then(stop => {
            if (alive) unlisten = stop;
            else stop();
        }).catch(error => console.error('Could not watch window state:', error));
        return () => { alive = false; unlisten?.(); };
    }, []);

    const control = async action => {
        try {
            const appWindow = getCurrentWindow();
            if (action === 'minimize') await appWindow.minimize();
            else if (action === 'maximize') {
                await appWindow.toggleMaximize();
                setMaximized(await appWindow.isMaximized());
            } else if (onClose) await onClose();
            else await appWindow.close();
        } catch (error) {
            console.error(`Could not ${action} window:`, error);
            showError(`Could not ${action === 'maximize' ? 'resize' : action} the window.`);
        }
    };

    return <div className="window-controls" role="group" aria-label="Window controls">
        <button type="button" className="window-control" aria-label="Minimize window" title="Minimize" onClick={() => control('minimize')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 16h16" /></svg>
        </button>
        <button type="button" className="window-control" aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => control('maximize')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {maximized ? <><path d="M8 8V4h12v12h-4" /><rect x="4" y="8" width="12" height="12" /></> : <rect x="4" y="4" width="16" height="16" />}
            </svg>
        </button>
        <button type="button" className="window-control window-control-close" aria-label="Close window" title="Close" disabled={closeDisabled} onClick={() => control('close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
    </div>;
}
