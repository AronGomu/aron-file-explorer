import React, { useEffect, useState } from 'react';
import App from '../../../src/App.jsx';
import SettingsProvider from '../../../src/providers/SettingsProvider.jsx';
import ThemeProvider from '../../../src/providers/ThemeProvider.jsx';
import HistoryProvider from '../../../src/providers/HistoryProvider.jsx';
import SftpProvider from '../../../src/providers/SftpProvider.jsx';
import GlobalSearch from '../../../src/components/search/GlobalSearch.jsx';
import NetworkView from '../../../src/components/network/NetworkView.jsx';
import AddSftpConnectionView from '../../../src/components/sidebar/AddSftpConnectionView.jsx';
import TemplateList from '../../../src/components/templates/TemplateList.jsx';
import PreviewModal from '../../../src/components/preview/PreviewModal.jsx';
import HashCompareModal from '../../../src/components/common/HashCompareModal.jsx';
import HashDisplayModal from '../../../src/components/common/HashDisplayModal.jsx';
import HashFileModal from '../../../src/components/common/HashFileModal.jsx';
import RenameModal from '../../../src/components/common/RenameModal.jsx';
import PermissionHelper from '../../../src/components/common/PermissionHelper.jsx';
import { showNotification, showConfirm } from '../../../src/utils/NotificationSystem.js';

export const PERIPHERAL_CASES = ['search', 'network', 'sftp-form', 'templates', 'preview-image', 'preview-video', 'preview-text', 'preview-error', 'dialogs', 'permissions', 'toasts', 'confirm', 'loading', 'error-fallback'];
export const REFERENCE_TEXT = '<script>not HTML</script>\n  exact whitespace Ω\n';
const item = { name: 'reference.txt', path: '/fixture/reference.txt', isDirectory: false };
const noop = () => {};

function Notifications({ confirm }) {
    const [result, setResult] = useState('pending');
    useEffect(() => {
        if (confirm) {
            showConfirm('Keep exact <message>?').then(value => setResult(String(value)));
        } else {
            for (const type of ['info', 'success', 'warning', 'error']) showNotification(`Fixture ${type} message`, type, 0);
        }
    }, [confirm]);
    return <output aria-label="callback result">{result}</output>;
}

function Dialogs({ variant }) {
    const [open, setOpen] = useState(true);
    const [result, setResult] = useState('pending');
    const props = { isOpen: open, onClose: () => setOpen(false), item };
    return <><output aria-label="callback result">{result}</output>{variant === 'compare' ? <HashCompareModal {...props} />
        : variant === 'hash-file' ? <HashFileModal {...props} />
        : variant === 'hash-display' ? <HashDisplayModal {...props} hash={'a'.repeat(64)} fileName={item.name} />
        : <RenameModal {...props} onRename={(original, name) => setResult(`${original.path} → ${name}`)} />}</>;
}

export function renderPeripheral(caseId) {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') || 'normal';
    const variant = params.get('variant');
    const close = noop;
    switch (caseId) {
        case 'search': return <HistoryProvider><GlobalSearch isOpen onClose={close} /></HistoryProvider>;
        case 'network': return <HistoryProvider><SftpProvider><NetworkView /></SftpProvider></HistoryProvider>;
        case 'sftp-form': return <AddSftpConnectionView isOpen onClose={close} onAdd={connection => { window.__peripheralResult = { ...connection, password: '[fixture omitted]' }; }} />;
        case 'templates': return <HistoryProvider><TemplateList onClose={close} /></HistoryProvider>;
        case 'preview-image': return <PreviewModal onClose={close} payload={variant === 'pdf'
            ? { kind: 'Pdf', name: 'reference.pdf', data_uri: '/fixtures/reference.pdf', bytes: 1 }
            : { kind: 'Image', name: 'reference.png', data_uri: '/fixtures/reference.png', bytes: 1 }} />;
        case 'preview-video': return <PreviewModal onClose={close} payload={{ kind: 'Video', name: 'reference.webm', path: '/fixture/reference.webm' }} />;
        case 'preview-text': return <PreviewModal onClose={close} payload={{ kind: 'Text', name: 'reference.txt', text: REFERENCE_TEXT, truncated: true }} />;
        case 'preview-error': return <PreviewModal onClose={close} isLoading={state === 'loading'} payload={{ kind: 'Error', message: 'Fixture preview failed' }} />;
        case 'dialogs': return <HistoryProvider><Dialogs variant={variant} /></HistoryProvider>;
        case 'permissions': return <PermissionHelper isOpen onClose={close} directoryPath="/fixture/protected" directoryName="Fixture" onDirectorySelected={close} />;
        case 'toasts': return <Notifications />;
        case 'confirm': return <Notifications confirm />;
        case 'loading': return <SettingsProvider><ThemeProvider>Loaded fixture</ThemeProvider></SettingsProvider>;
        case 'error-fallback': return <App />;
        default: throw new Error(`Unknown theme gallery case: ${caseId}`);
    }
}
