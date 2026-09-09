use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const OUTPUT_LIMIT: usize = 256 * 1024;
const CHUNK_SIZE: usize = 8192;

pub enum TerminalEvent {
    Output(Vec<u8>),
    Exit(u32),
    Error(String),
}

#[derive(Default)]
struct Flow {
    state: Mutex<(usize, bool)>,
    ready: Condvar,
}

impl Flow {
    fn reserve(&self, bytes: usize, exited: &AtomicBool) -> bool {
        let mut state = self.state.lock().unwrap();
        let mut exit_deadline = None;
        while !state.1 && state.0 + bytes > OUTPUT_LIMIT {
            if exited.load(Ordering::Acquire) {
                let deadline =
                    exit_deadline.get_or_insert_with(|| Instant::now() + Duration::from_secs(1));
                if Instant::now() >= *deadline {
                    return false;
                }
            }
            state = self
                .ready
                .wait_timeout(state, Duration::from_millis(10))
                .unwrap()
                .0;
        }
        if state.1 {
            return false;
        }
        state.0 += bytes;
        true
    }

    fn ack(&self, bytes: usize) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if bytes > state.0 {
            return Err("Invalid terminal acknowledgement".into());
        }
        state.0 -= bytes;
        self.ready.notify_all();
        Ok(())
    }

    fn is_closed(&self) -> bool {
        self.state.lock().unwrap().1
    }

    fn close(&self) {
        self.state.lock().unwrap().1 = true;
        self.ready.notify_all();
    }
}

pub struct Session {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    #[cfg(unix)]
    child_pid: Option<u32>,
    flow: Flow,
    exited: AtomicBool,
    exit_code: Mutex<Option<u32>>,
    input_generation: AtomicU64,
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err("Terminal dimensions must be between 1 and 1000".into());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

impl Session {
    pub fn spawn(
        command: CommandBuilder,
        cols: u16,
        rows: u16,
        emit: impl Fn(TerminalEvent) -> bool + Send + 'static,
    ) -> Result<Arc<Self>, String> {
        let pair = native_pty_system()
            .openpty(size(cols, rows)?)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            let fd = pair
                .master
                .as_raw_fd()
                .ok_or("PTY has no file descriptor")?;
            // Cloned master handles share O_NONBLOCK: both reads and writes stay cancellable.
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        #[cfg(unix)]
        let poll_source = {
            let fd = unsafe {
                libc::fcntl(
                    pair.master
                        .as_raw_fd()
                        .ok_or("PTY has no file descriptor")?,
                    libc::F_DUPFD_CLOEXEC,
                    0,
                )
            };
            if fd < 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            unsafe { OwnedFd::from_raw_fd(fd) }
        };
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        let session = Arc::new(Self {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            killer: Mutex::new(Some(child.clone_killer())),
            #[cfg(unix)]
            child_pid: child.process_id(),
            flow: Flow::default(),
            exited: AtomicBool::new(false),
            exit_code: Mutex::new(None),
            input_generation: AtomicU64::new(0),
        });
        let emit = Arc::new(Mutex::new(emit));
        let reaping = session.clone();
        #[cfg(not(unix))]
        let exit_emit = emit.clone();
        std::thread::spawn(move || {
            let code = loop {
                // Share signalling lock so a reaped/reused PID can never be signalled.
                let mut killer = reaping.killer.lock().unwrap();
                match child.try_wait() {
                    Ok(Some(status)) => {
                        killer.take();
                        break status.exit_code();
                    }
                    Err(_) => {
                        killer.take();
                        break 1;
                    }
                    Ok(None) => {}
                }
                drop(killer);
                std::thread::sleep(Duration::from_millis(50));
            };
            *reaping.exit_code.lock().unwrap() = Some(code);
            reaping.exited.store(true, Ordering::Release);
            #[cfg(not(unix))]
            {
                reaping.flow.close();
                exit_emit.lock().unwrap()(TerminalEvent::Exit(code));
            }
        });
        let active = session.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; CHUNK_SIZE];
            let mut exit_deadline = None;
            loop {
                if active.flow.is_closed() {
                    break;
                }
                if active.exited.load(Ordering::Acquire) {
                    exit_deadline.get_or_insert_with(|| Instant::now() + Duration::from_secs(1));
                }
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        // Check after reading: EOF/idle is lossless, pending bytes at
                        // the deadline require an explicit truncation notice.
                        if exit_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                            emit.lock().unwrap()(TerminalEvent::Error(
                                "Terminal output drain timed out after shell exit; output truncated".into(),
                            ));
                            break;
                        }
                        if !active.flow.reserve(count, &active.exited) {
                            if !active.flow.is_closed() {
                                emit.lock().unwrap()(TerminalEvent::Error(
                                    "Terminal output drain timed out after shell exit".into(),
                                ));
                            }
                            break;
                        }
                        if !emit.lock().unwrap()(TerminalEvent::Output(buffer[..count].to_vec())) {
                            active.close();
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        if active.exited.load(Ordering::Acquire) {
                            break;
                        }
                        #[cfg(unix)]
                        {
                            let mut fd = libc::pollfd {
                                fd: poll_source.as_raw_fd(),
                                events: libc::POLLIN,
                                revents: 0,
                            };
                            // Readiness wakeups avoid high-frequency idle polling; close
                            // and child-exit cancellation observed within 50 ms.
                            unsafe {
                                libc::poll(&mut fd, 1, 50);
                            }
                        }
                        #[cfg(not(unix))]
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => {
                        // Unix PTYs may report EIO instead of EOF when the slave exits.
                        #[cfg(unix)]
                        if e.raw_os_error() == Some(libc::EIO) {
                            break;
                        }
                        emit.lock().unwrap()(TerminalEvent::Error(e.to_string()));
                        active.close();
                        break;
                    }
                }
            }
            drop(reader);
            // EOF alone is not a reaping strategy: descendants may retain the slave.
            active.close();
            #[cfg(unix)]
            {
                while !active.exited.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(5));
                }
                let code = active.exit_code.lock().unwrap().unwrap_or(1);
                emit.lock().unwrap()(TerminalEvent::Exit(code));
            }
        });
        Ok(session)
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.write_generation(data, self.input_generation.load(Ordering::Acquire))
    }

    pub fn write_generation(&self, data: &[u8], generation: u64) -> Result<(), String> {
        if data.len() > CHUNK_SIZE {
            return Err("Terminal input chunk is too large".into());
        }
        let mut writer = self.writer.lock().unwrap();
        let writer = writer.as_mut().ok_or("Terminal has exited")?;
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut written = 0;
        while written < data.len() {
            if self.flow.is_closed() || self.exited.load(Ordering::Acquire) {
                return Err("Terminal has exited".into());
            }
            if self.input_generation.load(Ordering::Acquire) != generation {
                return Err("Pending terminal input cancelled by interrupt".into());
            }
            match writer.write(&data[written..]) {
                Ok(0) => return Err("Terminal input closed".into()),
                Ok(count) => written += count,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(format!("Terminal input stalled after {written} bytes; remaining input not sent"));
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }

    pub fn interrupt(&self) -> Result<(), String> {
        self.input_generation.fetch_add(1, Ordering::AcqRel);
        let writer = self.writer.lock().unwrap();
        #[cfg(unix)]
        {
            // Inspect slave termios through master. Saturated input can prevent even
            // VINTR bytes reaching line discipline, so signal only when Ctrl+C is VINTR.
            let killer = self.killer.lock().unwrap();
            if killer.is_none() {
                return Err("Terminal has exited".into());
            }
            let master = self.master.lock().unwrap();
            let master = master.as_ref().ok_or("Terminal has exited")?;
            let fd = master.as_raw_fd().ok_or("Terminal has exited")?;
            let mut termios = std::mem::MaybeUninit::<libc::termios>::uninit();
            if unsafe { libc::tcgetattr(fd, termios.as_mut_ptr()) } != 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let termios = unsafe { termios.assume_init() };
            if termios.c_lflag & libc::ISIG != 0 && termios.c_cc[libc::VINTR] == 3 {
                let group = master
                    .process_group_leader()
                    .ok_or("Terminal has no foreground process group")?;
                if termios.c_lflag & libc::NOFLSH == 0 {
                    // Master flush misses input already queued in slave line discipline.
                    // Open only during interrupt: retaining a slave would suppress EOF.
                    let slave = std::fs::OpenOptions::new()
                        .read(true)
                        .write(true)
                        .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK)
                        .open(master.tty_name().ok_or("PTY has no slave path")?)
                        .map_err(|e| e.to_string())?;
                    if unsafe { libc::tcflush(slave.as_raw_fd(), libc::TCIOFLUSH) } != 0 {
                        return Err(std::io::Error::last_os_error().to_string());
                    }
                }
                if unsafe { libc::kill(-group, libc::SIGINT) } != 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                return Ok(());
            }
            // Raw TUIs receive a literal byte, not an unsolicited process signal.
            if unsafe { libc::tcflush(fd, libc::TCOFLUSH) } != 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        drop(writer);
        self.write(b"\x03")
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .unwrap()
            .as_ref()
            .ok_or("Terminal has exited")?
            .resize(size(cols, rows)?)
            .map_err(|e| e.to_string())
    }

    pub fn ack(&self, bytes: usize) -> Result<(), String> {
        self.flow.ack(bytes)
    }

    pub fn close(&self) {
        self.flow.close();
        // Kill before taking the writer lock: a blocked write must be released.
        let mut killer = self.killer.lock().unwrap();
        if let Some(mut child) = killer.take() {
            #[cfg(unix)]
            if let Some(master) = self.master.lock().unwrap().as_ref() {
                if let Some(group) = master.process_group_leader() {
                    // This group belongs to our PTY, never the application's terminal.
                    unsafe {
                        libc::kill(-group, libc::SIGKILL);
                    }
                }
            }
            #[cfg(unix)]
            if let Some(pid) = self.child_pid {
                // Shell may trap SIGHUP, which is portable-pty's Unix kill signal.
                unsafe {
                    libc::kill(pid as libc::pid_t, libc::SIGKILL);
                }
            }
            let _ = child.kill();
        }
        drop(killer);
        self.writer.lock().unwrap().take();
        self.master.lock().unwrap().take();
    }
}

#[cfg(all(test, unix))]
#[path = "terminal_tests.rs"]
mod tests;
