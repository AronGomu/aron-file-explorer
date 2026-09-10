import React, { useState } from 'react';
import SettingsProvider from '../../../src/providers/SettingsProvider.jsx';
import ThemeProvider from '../../../src/providers/ThemeProvider.jsx';
import HistoryProvider from '../../../src/providers/HistoryProvider.jsx';
import SftpProvider from '../../../src/providers/SftpProvider.jsx';
import FileSystemProvider, { useFileSystem } from '../../../src/providers/FileSystemProvider.jsx';
import ContextMenuProvider, { useContextMenu } from '../../../src/providers/ContextMenuProvider.jsx';
import FileList from '../../../src/components/explorer/FileList.jsx';
import NavigationButtons from '../../../src/components/explorer/NavigationButtons.jsx';
import PathBreadcrumb from '../../../src/components/explorer/PathBreadcrumb.jsx';
import ViewModes from '../../../src/components/explorer/ViewModes.jsx';
import CreateFileButton from '../../../src/components/explorer/CreateFileButton.jsx';
import Sidebar from '../../../src/components/sidebar/Sidebar.jsx';
import TabManager from '../../../src/components/tabs/TabManager.jsx';
import ContextMenu from '../../../src/components/contextMenu/ContextMenu.jsx';
import ThisPCView from '../../../src/components/thisPc/ThisPCView.jsx';
import SettingsPanel from '../../../src/components/settings/SettingsPanel.jsx';
import Button from '../../../src/components/common/Button.jsx';
import Dropdown from '../../../src/components/common/Dropdown.jsx';
import IconButton from '../../../src/components/common/IconButton.jsx';
import '../../../src/styles/layouts/mainLayout.css';

export const explorerCases = ['explorer-grid', 'explorer-list', 'explorer-details', 'sidebar-tabs', 'breadcrumb', 'context-menu', 'controls', 'this-pc'];
export const fixtureRoot = '/fixture/home/Documents';
const names = ['01-image.png', '02-video.mp4', '03-audio.mp3', '04-code.js', '05-archive.zip', '06-document.pdf', '07-notes.txt'];
export const explorerData = {
    directories: [{ name: 'Projects', path: `${fixtureRoot}/Projects`, sub_file_count: 3, last_modified: '2026-09-09T12:00:00Z' }],
    files: [...names, ...Array.from({ length: 90 }, (_, i) => `sample-${String(i).padStart(3, '0')}.txt`)].map(name => ({
        name, path: `${fixtureRoot}/${name}`, size_in_bytes: 4096, last_modified: '2026-09-09T12:00:00Z',
    })),
};

// Explicit synthetic IPC; never host filesystem, shell, or production entrypoint.
export function explorerIPC(command, args) {
    if (command === 'get_system_volumes_information_as_json') return JSON.stringify([
        { volume_name: 'Fixture disk', mount_point: fixtureRoot, file_system: 'ext4', size: 128000000000, available_space: 64000000000, is_removable: false },
        { volume_name: 'Fixture USB', mount_point: '/fixture/usb', file_system: 'exfat', size: 16000000000, available_space: 4000000000, is_removable: true },
    ]);
    if (command === 'get_meta_data_as_json') return JSON.stringify({ current_running_os: 'linux', current_cpu_architecture: 'x86_64', user_home_dir: '/fixture/home', version: 'fixture' });
    if (command === 'open_directory' && (args.path === '/' || args.path.startsWith('/fixture/'))) return JSON.stringify(explorerData);
    throw new Error(`Unknown theme gallery IPC command: ${command}`);
}

function ExplorerSurface({ caseId }) {
    const [mode, setMode] = useState(caseId.startsWith('explorer-') ? caseId.slice(9) : 'grid');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const { currentDirData, isLoading } = useFileSystem();
    const menu = useContextMenu();
    return <div className="main-layout">
        <TabManager>
            <div className="layout-content">
                <Sidebar currentView={caseId === 'this-pc' ? 'this-pc' : 'explorer'} />
                <div className="content-area">
                    <div className="toolbar">
                        <NavigationButtons />
                        <PathBreadcrumb onCopyPath={() => {}} />
                        <ViewModes currentMode={mode} onChange={setMode} />
                        <IconButton icon="settings" label="Fixture Settings" onClick={() => setSettingsOpen(true)} />
                    </div>
                    <div className="action-bar"><CreateFileButton /></div>
                    {caseId === 'this-pc' ? <ThisPCView /> : <FileList data={currentDirData} isLoading={isLoading} viewMode={mode} />}
                </div>
            </div>
        </TabManager>
        {menu.isOpen && <ContextMenu position={menu.position} items={menu.items} onClose={menu.closeContextMenu} />}
        <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>;
}

function Controls() {
    return <div style={{ padding: 48, display: 'flex', gap: 16, alignItems: 'start' }}>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
        <IconButton icon="copy" label="Copy" tooltip="Copy path" tooltipPosition="bottom" />
        <Dropdown trigger={<Button variant="secondary">Actions</Button>} items={[
            { label: 'Open', icon: 'folder' }, { label: 'Unavailable', disabled: true },
        ]} />
        <CreateFileButton />
    </div>;
}

export function ExplorerCase({ caseId }) {
    return <SettingsProvider><ThemeProvider><HistoryProvider><SftpProvider><FileSystemProvider><ContextMenuProvider>
        {caseId === 'controls' ? <Controls /> : <ExplorerSurface caseId={caseId} />}
    </ContextMenuProvider></FileSystemProvider></SftpProvider></HistoryProvider></ThemeProvider></SettingsProvider>;
}
