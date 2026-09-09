const INPUT_LIMIT = 256 * 1024;

// Clipboard text must never synthesize Enter or terminal control sequences.
export function sanitizePaste(text) {
    return text.replace(/\r\n|[\r\n\t]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

export function quotePaths(paths, shell) {
    return paths.map(path => {
        if (/[\x00-\x1f\x7f-\x9f]/.test(path)) throw new Error('Paths containing control characters cannot be pasted.');
        if (shell === 'posix') return "'" + path.replaceAll("'", "'\\''") + "'";
        if (shell === 'fish') return "'" + path.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
        if (shell === 'powershell') return "'" + path.replaceAll("'", "''") + "'";
        throw new Error('Path quoting is not supported for this shell. Copy the path manually.');
    }).join(' ');
}

export function createPtyClient({ invoke, channel, write, onExit, onError }) {
    let id = null;
    let disposed = false;
    let ended = false;
    let inputTail = Promise.resolve();
    let interruptTail = Promise.resolve();
    let queued = 0;
    let generation = 0;
    let releaseStart;
    let creation;
    let disposal;
    const started = new Promise(resolve => { releaseStart = resolve; });
    const close = sessionId => invoke('terminal_close', { id: sessionId });

    channel.onmessage = message => {
        if (disposed) return;
        if (message.event === 'output') {
            const bytes = new Uint8Array(message.data);
            write(bytes, () => {
                if (!disposed) invoke('terminal_ack', { id: message.id, bytes: bytes.length }).catch(onError);
            });
        } else if (message.event === 'exit') {
            ended = true;
            onExit(message.code);
        } else if (message.event === 'error') {
            onError(message.message);
        }
    };

    return {
        async start(workingDirectory, cols, rows) {
            if (disposed) return null;
            try {
                creation = invoke('terminal_create', { workingDirectory, cols, rows, output: channel });
                const session = await creation;
                if (disposed) {
                    await disposal;
                    return null;
                }
                id = session.id;
                return session;
            } catch (error) {
                ended = true;
                throw error;
            } finally {
                releaseStart();
            }
        },
        input(data, binary = false) {
            if (disposed || ended) return Promise.resolve();
            if (data === '\x03' && !binary) {
                // Interrupt must bypass stalled/full paste queues, including native writes.
                generation++;
                queued = 0;
                const job = interruptTail.then(() => started).then(() => {
                    if (!disposed && !ended && id !== null) return invoke('terminal_interrupt', { id });
                });
                interruptTail = job.catch(() => {});
                inputTail = interruptTail;
                return job;
            }
            const bytes = new TextEncoder().encode(data).length;
            if (queued + bytes > INPUT_LIMIT) return Promise.reject(new Error('Input queue is full. Wait before pasting more text.'));
            queued += bytes;
            const current = generation;
            const job = inputTail.then(async () => {
                await started;
                // Split by code points so UTF-16 surrogate pairs survive chunking.
                const points = Array.from(data);
                for (let offset = 0; offset < points.length; offset += 1024) {
                    if (disposed || ended || id === null || current !== generation) break;
                    await invoke('terminal_write', { id, generation: current, data: points.slice(offset, offset + 1024).join(''), ...(binary ? { binary: true } : {}) });
                }
            }).finally(() => { if (current === generation) queued -= bytes; });
            inputTail = job.catch(() => {});
            return job;
        },
        resize(cols, rows) {
            if (disposed || ended || id === null) return Promise.resolve();
            return invoke('terminal_resize', { id, cols, rows });
        },
        dispose() {
            if (disposed) return disposal;
            disposed = true;
            releaseStart();
            disposal = id !== null ? close(id) : (creation || Promise.resolve(null)).then(
                session => session ? close(session.id) : undefined,
                () => {}, // Failed creation has no session to close.
            );
            return disposal;
        },
    };
}
