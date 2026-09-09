import React, { useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { useHistory } from '../../providers/HistoryProvider';
import { useFileSystem } from '../../providers/FileSystemProvider';
import { useSettings } from '../../providers/SettingsProvider';
import { createPtyClient, quotePaths, sanitizePaste } from './terminalSession.js';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

const Terminal = ({ isOpen, onToggle }) => {
    const { currentPath } = useHistory();
    const { selectedItems } = useFileSystem();
    const { settings } = useSettings();
    const hostRef = useRef(null);
    const runtimeRef = useRef(null);
    const cleanupRef = useRef(Promise.resolve());
    const pathRef = useRef(currentPath);
    const toggleRef = useRef(onToggle);
    const [started, setStarted] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState('starting');
    const [notice, setNotice] = useState('');
    pathRef.current = currentPath;
    toggleRef.current = onToggle;

    useEffect(() => {
        if (isOpen) setStarted(true);
    }, [isOpen]);

    useEffect(() => {
        if (!started) return;
        let disposed = false;
        let frame = 0;
        const fail = error => { if (!disposed) setNotice(String(error?.message || error)); };
        setStatus('starting');
        setNotice('');
        const term = new Xterm({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "'SF Mono', Monaco, 'DejaVu Sans Mono', monospace",
            scrollback: 5000,
            theme: { background: '#1e1e1e', foreground: '#dddddd' },
            allowProposedApi: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        // Never allow terminal output to access the system clipboard via OSC 52.
        const osc = term.parser.registerOscHandler(52, () => true);
        let webgl;
        let contextLoss;
        try {
            webgl = new WebglAddon();
            contextLoss = webgl.onContextLoss(() => {
                webgl.dispose();
                webgl = null;
                fail('GPU context lost; using default terminal renderer.');
            });
            term.loadAddon(webgl);
        } catch {
            webgl?.dispose();
            webgl = null;
            fail('WebGL unavailable; using default terminal renderer.');
        }
        const channel = new Channel();
        let terminalError = '';
        const client = createPtyClient({
            invoke,
            channel,
            write: (data, done) => term.write(data, done),
            onExit: code => {
                if (!disposed) {
                    setStatus('exited');
                    setNotice(terminalError || `Shell exited (${code}). Start a new shell to continue.`);
                }
            },
            onError: error => {
                terminalError = String(error?.message || error);
                fail(error);
            },
        });
        const runtime = { term, client, shell: 'unknown', fit };
        runtimeRef.current = runtime;
        const input = term.onData(data => { client.input(data).catch(fail); });
        const binaryInput = term.onBinary(data => { client.input(data, true).catch(fail); });
        const resized = term.onResize(({ cols, rows }) => { client.resize(cols, rows).catch(fail); });
        const fitVisible = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (!disposed && hostRef.current?.clientWidth && hostRef.current?.clientHeight) fit.fit();
            });
        };
        const observer = new ResizeObserver(fitVisible);
        observer.observe(hostRef.current);
        if (hostRef.current.clientWidth && hostRef.current.clientHeight) fit.fit();

        const copy = async () => {
            const text = term.getSelection();
            if (text) await navigator.clipboard.writeText(text);
            term.focus();
        };
        runtime.copy = copy;
        runtime.paste = text => {
            const safe = sanitizePaste(text);
            if (safe !== text) fail('Paste sanitized: line breaks/tabs replaced with spaces; control characters removed. Press Enter yourself.');
            term.paste(safe);
            term.focus();
        };
        const paste = event => {
            event.preventDefault();
            event.stopPropagation();
            runtime.paste(event.clipboardData?.getData('text/plain') || '');
        };
        const host = hostRef.current;
        host.addEventListener('paste', paste, true);
        term.attachCustomKeyEventHandler(event => {
            event.stopPropagation();
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === '`') {
                event.preventDefault();
                if (event.type === 'keydown') toggleRef.current();
                return false;
            }
            if ((event.ctrlKey && event.shiftKey || event.metaKey) && key === 'c') {
                event.preventDefault();
                if (event.type === 'keydown') copy().catch(fail);
                return false;
            }
            // Let the browser deliver a real paste event; capture listener sanitizes it.
            if ((event.ctrlKey && event.shiftKey || event.metaKey) && key === 'v') return false;
            return true;
        });
        cleanupRef.current.then(() => {
            if (disposed) return null;
            return client.start(pathRef.current, term.cols, term.rows);
        }).then(session => {
            if (!session || disposed) return;
            runtime.shell = session.shell;
            setStatus(previous => previous === 'exited' ? previous : 'ready');
            client.resize(term.cols, term.rows).catch(fail);
            term.focus();
        }).catch(error => {
            if (!disposed) setStatus('error');
            fail(error);
        });
        return () => {
            disposed = true;
            cancelAnimationFrame(frame);
            observer.disconnect();
            host.removeEventListener('paste', paste, true);
            cleanupRef.current = Promise.all([cleanupRef.current, client.dispose()]).then(() => {});
            // Observe unmount rejection without converting the replacement barrier to success.
            cleanupRef.current.catch(() => {});
            input.dispose();
            binaryInput.dispose();
            resized.dispose();
            osc.dispose();
            contextLoss?.dispose();
            webgl?.dispose();
            term.dispose();
            if (runtimeRef.current === runtime) runtimeRef.current = null;
        };
    }, [started, attempt]);

    useEffect(() => {
        if (!isOpen) return;
        const frame = requestAnimationFrame(() => {
            runtimeRef.current?.fit.fit();
            runtimeRef.current?.term.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [isOpen, settings.terminal_height]);

    const toolbarAction = async action => {
        try { await action(runtimeRef.current); }
        catch (error) { setNotice(String(error?.message || error)); }
    };
    const pastePaths = () => toolbarAction(runtime => {
        const paths = selectedItems.length ? selectedItems.map(item => item.path) : [currentPath];
        if (paths.some(path => !path || path.startsWith('sftp:'))) throw new Error('Select local file paths before pasting.');
        runtime.paste(quotePaths(paths, runtime.shell));
    });

    return (
        <section className="enhanced-terminal" aria-label="Terminal" hidden={!isOpen}
            style={{ height: `${settings.terminal_height || 240}px` }}
            onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
            <div className="terminal-header">
                <span>Terminal <small>{status}</small></span>
                <div className="terminal-controls">
                    <button disabled={!started} onClick={() => toolbarAction(runtime => runtime.copy())} title="Copy selection (Ctrl+Shift+C / Cmd+C)">Copy</button>
                    <button disabled={status !== 'ready'} onClick={() => toolbarAction(async runtime => runtime.paste(await navigator.clipboard.readText()))} title="Paste text safely (Ctrl+Shift+V / Cmd+V)">Paste</button>
                    <button disabled={status !== 'ready'} onClick={pastePaths} title="Paste shell-quoted selected paths, or current directory; never execute">Paste paths</button>
                    <button disabled={!started} onClick={() => runtimeRef.current?.term.clear()} title="Clear scrollback">Clear</button>
                    {(status === 'ready' || status === 'stopping') && <button disabled={status === 'stopping'} onClick={() => toolbarAction(async runtime => {
                        setStatus('stopping');
                        try {
                            await runtime.client.dispose();
                            setStatus('exited');
                            setNotice('Shell stopped. Start a new shell to continue.');
                        } catch (error) {
                            setStatus('error');
                            throw error;
                        }
                    })} title="Stop shell and foreground process; pending input is discarded">{status === 'stopping' ? 'Stopping…' : 'Stop'}</button>}
                    {(status === 'exited' || status === 'error') && <button onClick={() => setAttempt(value => value + 1)}>New shell</button>}
                    <button onClick={onToggle} title="Hide terminal; shell keeps running" aria-label="Hide terminal">×</button>
                </div>
            </div>
            {notice && <div className="terminal-notice" role="status">{notice}</div>}
            <div className="terminal-screen" ref={hostRef} />
        </section>
    );
};

export default Terminal;
