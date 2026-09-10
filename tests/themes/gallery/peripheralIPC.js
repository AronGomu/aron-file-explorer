// Fixture-only IPC: no Tauri backend/network/file writes. Unknown commands reject.
export function peripheralIPC(caseId, command, args, themes) {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') || 'normal';
    const theme = params.get('theme') || 'catppuccin-latte';
    window.__peripheralIPC.push({ command, args });
    const pending = () => new Promise(() => {});
    const failure = () => { throw new Error('T5 injected fixture failure'); };
    if (['loading', 'error-fallback'].includes(caseId)) {
        if (command === 'get_settings_snapshot') return caseId === 'loading' && state !== 'theme' ? pending() : { settings: { active_theme_id: theme }, loadError: null };
        if (command === 'get_theme_catalog') return caseId === 'loading' ? pending() : { revision: 1, themes, issues: [], directory: '/fixture/themes' };
    }
    if (caseId === 'search') {
        if (command === 'get_search_engine_info') return {
            status: state === 'loading' ? 'Indexing' : 'Ready',
            stats: { trie_size: 2, total_files: 2, total_directories: 1 },
            progress: { files_indexed: 1, files_discovered: 2, percentage_complete: 50, current_path: '/fixture/reference.txt', start_time: 0 },
        };
        if (command === 'get_meta_data_as_json') return JSON.stringify({ os: 'Fixture', home_dir: '/fixture', root_dir: '/fixture' });
        if (command === 'get_suggestions') return ['reference.txt', 'reference.pdf'];
        if (['search', 'search_with_extension'].includes(command)) return state === 'error' ? failure() : state === 'empty' ? [] : [['/fixture/reference.txt', 1], ['/fixture/reference.pdf', 0.8]];
    }
    if (caseId === 'templates') {
        if (command === 'get_template_paths_as_json') return state === 'loading' ? pending() : state === 'error' ? failure() : JSON.stringify(state === 'empty' ? [] : [{ name: 'Reference template', path: '/fixture/template.txt', type: 'file', size: 128, createdAt: '2026-01-01' }]);
        if (['add_template', 'use_template', 'remove_template'].includes(command)) return null;
    }
    if (['network', 'sftp-form'].includes(caseId) && command === 'load_dir') {
        if (args.host !== 'fixture.invalid' || args.username !== 'fixture' || args.password) throw new Error('Fixture SFTP only; no credentials permitted');
        return state === 'loading' ? pending() : state === 'error' ? failure() : JSON.stringify({ files: ['./reference.txt'], directories: [] });
    }
    if (caseId === 'permissions') {
        if (command === 'check_directory_access') return state === 'loading' ? pending() : state === 'error' ? failure() : state === 'success';
        if (command === 'plugin:dialog|open') return '/fixture/selected';
        if (command === 'request_full_disk_access') return null;
    }
    if (caseId === 'dialogs') {
        if (command === 'compare_file_or_dir_with_hash') return state === 'loading' ? pending() : state === 'error' ? failure() : state !== 'mismatch';
        if (command === 'gen_hash_and_save_to_file') return state === 'loading' ? pending() : state === 'error' ? failure() : 'a'.repeat(64);
    }
    throw new Error(`Unknown theme gallery IPC command: ${command}`);
}

export function preparePeripheral(caseId) {
    window.__peripheralIPC = [];
    const state = new URLSearchParams(window.location.search).get('state');
    sessionStorage.setItem('fileExplorerHistory', JSON.stringify(['/fixture']));
    sessionStorage.setItem('fileExplorerHistoryIndex', '0');
    localStorage.setItem('fileExplorerSftpConnections', JSON.stringify(caseId === 'network' && state !== 'empty'
        ? [{ name: 'Synthetic server', host: 'fixture.invalid', port: '22', username: 'fixture', password: '' }] : []));
    if (caseId === 'error-fallback') {
        window.matchMedia = () => { throw new Error('T5 expected render injection'); };
    }
}
