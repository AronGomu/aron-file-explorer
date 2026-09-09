use super::*;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

fn shell() -> (Arc<Session>, Receiver<TerminalEvent>) {
    let (tx, rx) = channel();
    let mut command = CommandBuilder::new("bash");
    command.args(["--noprofile", "--norc", "-i"]);
    command.env("PS1", "PTY_READY> ");
    let session = Session::spawn(command, 80, 24, move |event| tx.send(event).is_ok()).unwrap();
    (session, rx)
}

fn until(session: &Session, rx: &Receiver<TerminalEvent>, marker: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut text = String::new();
    while Instant::now() < deadline {
        if let TerminalEvent::Output(data) = rx.recv_timeout(Duration::from_secs(2)).unwrap() {
            session.ack(data.len()).unwrap();
            text.push_str(&String::from_utf8_lossy(&data));
            if text.contains(marker) {
                return text;
            }
        }
    }
    panic!("missing marker {marker}: {text}");
}

#[test]
fn interactive_state_resize_streaming_and_ctrl_c() {
    let (session, rx) = shell();
    until(&session, &rx, "PTY_READY>");
    session.write(b"export PTY_PROBE=retained\r").unwrap();
    until(&session, &rx, "PTY_READY>");
    session
        .write(b"printf 'value=%s\\n' \"$PTY_PROBE\"\r")
        .unwrap();
    assert!(until(&session, &rx, "value=retained").contains("value=retained"));
    session.resize(100, 40).unwrap();
    session.write(b"stty size\r").unwrap();
    assert!(until(&session, &rx, "40 100").contains("40 100"));
    session
        .write(b"printf 'stream-%s\\n' ready; sleep 30\r")
        .unwrap();
    until(&session, &rx, "stream-ready");
    session.write(b"\x03").unwrap();
    until(&session, &rx, "PTY_READY>");
    session.write(b"exit\r").unwrap();
    loop {
        match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            TerminalEvent::Exit(_) => break,
            TerminalEvent::Output(data) => {
                session.ack(data.len()).unwrap();
            }
            _ => {}
        }
    }
    session.close();
}

#[test]
fn flow_control_is_bounded_and_close_wakes_waiter() {
    let flow = Arc::new(Flow::default());
    assert!(flow.reserve(OUTPUT_LIMIT, &AtomicBool::new(false)));
    assert!(flow.ack(OUTPUT_LIMIT + 1).is_err());
    let other = flow.clone();
    let (tx, rx) = channel();
    let waiter = std::thread::spawn(move || {
        tx.send(other.reserve(1, &AtomicBool::new(false))).unwrap();
    });
    assert!(rx.recv_timeout(Duration::from_millis(80)).is_err());
    flow.close();
    assert!(!rx.recv_timeout(Duration::from_secs(1)).unwrap());
    waiter.join().unwrap();
}

#[test]
fn closing_flooding_shell_reaps_child_even_without_acks() {
    let (session, rx) = shell();
    until(&session, &rx, "PTY_READY>");
    session
        .write(b"while :; do printf 'output flood\\n'; done\r")
        .unwrap();
    std::thread::sleep(Duration::from_millis(100));
    session.close();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "child not reaped after close");
        if let TerminalEvent::Exit(_) = rx.recv_timeout(Duration::from_secs(2)).unwrap() {
            break;
        }
    }
}

fn retained_slave(close: bool) {
    let (tx, rx) = channel();
    let mut command = CommandBuilder::new("bash");
    command.args([
        "--noprofile",
        "--norc",
        "-c",
        "set -m; (trap '' HUP; printf 'BG:%s\\n' \"$BASHPID\"; exec sleep 30) & read -r line",
    ]);
    let session = Session::spawn(command, 80, 24, move |event| tx.send(event).is_ok()).unwrap();
    let text = until(&session, &rx, "BG:");
    let pid: i32 = text.split("BG:").nth(1).unwrap().trim().parse().unwrap();
    if close {
        session.close();
    } else {
        session.write(b"\n").unwrap();
    }
    let deadline = Instant::now() + Duration::from_millis(800);
    let mut exited = false;
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(TerminalEvent::Exit(_)) => {
                exited = true;
                break;
            }
            Ok(TerminalEvent::Output(data)) => {
                session.ack(data.len()).unwrap();
            }
            _ => {}
        }
    }
    // Clean only descendant created by this isolated test, including red runs.
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
    session.close();
    assert!(
        exited,
        "shell exit/reap must not wait for descendant retaining slave"
    );
}

#[test]
fn close_reaps_shell_with_background_slave_holder() {
    retained_slave(true);
}

#[test]
fn normal_exit_reaps_shell_with_background_slave_holder() {
    retained_slave(false);
}

#[test]
fn interrupt_cancels_saturated_paste_without_waiting_for_writer() {
    let (session, rx) = shell();
    until(&session, &rx, "PTY_READY>");
    session.write(b"stty -icanon -echo; printf 'saturated-%s\\n' ready; sleep 30; stty sane; printf 'recovered-%s\\n' ready\r").unwrap();
    until(&session, &rx, "saturated-ready");
    let writing = session.clone();
    let (tx, done) = channel();
    let writer = std::thread::spawn(move || {
        let mut result = Ok(());
        for _ in 0..32 {
            result = writing.write(&[b'x'; 8192]);
            if result.is_err() {
                break;
            }
        }
        tx.send(result).unwrap();
    });
    assert!(done.recv_timeout(Duration::from_millis(100)).is_err());
    let began = Instant::now();
    let interrupted = session.interrupt();
    let result = done.recv_timeout(Duration::from_secs(3));
    if interrupted.is_err() || result.is_err() {
        session.close();
    }
    assert!(interrupted.is_ok(), "{interrupted:?}");
    assert!(began.elapsed() < Duration::from_secs(1));
    assert!(result.unwrap().is_err());
    assert!(session.write_generation(b"stale paste", 0).is_err());
    until(&session, &rx, "PTY_READY>");
    session.write(b"printf 'recovered-%s\\n' ready\r").unwrap();
    let output = until(&session, &rx, "PTY_READY>");
    session.close();
    writer.join().unwrap();
    assert!(
        output.contains("recovered-ready"),
        "fresh command contaminated by paste: {output}"
    );
}

#[test]
fn interrupt_delivers_literal_ctrl_c_to_raw_application() {
    let (session, rx) = shell();
    until(&session, &rx, "PTY_READY>");
    session
        .write(b"stty raw -echo; printf 'raw-%s\\n' ready; od -An -tu1 -N1; stty sane\r")
        .unwrap();
    until(&session, &rx, "raw-ready");
    session.interrupt().unwrap();
    let output = until(&session, &rx, "PTY_READY>");
    session.close();
    assert!(output.lines().any(|line| line.trim() == "3"), "{output}");
}

#[test]
fn close_cancels_saturated_raw_writer() {
    let (session, rx) = shell();
    until(&session, &rx, "PTY_READY>");
    session
        .write(b"stty raw -echo; printf 'close-%s\\n' ready; sleep 30\r")
        .unwrap();
    until(&session, &rx, "close-ready");
    let writing = session.clone();
    let (tx, done) = channel();
    let writer = std::thread::spawn(move || {
        for _ in 0..32 {
            if writing.write(&[b'x'; 8192]).is_err() {
                break;
            }
        }
        tx.send(()).unwrap();
    });
    assert!(done.recv_timeout(Duration::from_millis(100)).is_err());
    let began = Instant::now();
    session.close();
    done.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(began.elapsed() < Duration::from_secs(1));
    writer.join().unwrap();
    loop {
        if let TerminalEvent::Exit(_) = rx.recv_timeout(Duration::from_secs(1)).unwrap() {
            break;
        }
    }
}

#[test]
fn finite_exit_output_survives_slow_emit_callbacks() {
    let (tx, rx) = channel();
    let mut command = CommandBuilder::new("bash");
    command.args(["--noprofile", "--norc", "-c", "printf '%050000d' 0"]);
    let session = Session::spawn(command, 80, 24, move |event| {
        if matches!(event, TerminalEvent::Output(_)) {
            std::thread::sleep(Duration::from_millis(150));
        }
        tx.send(event).is_ok()
    })
    .unwrap();
    let mut received = Vec::new();
    let mut errors = Vec::new();
    let mut exited = false;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(3)) {
            Ok(TerminalEvent::Output(data)) => {
                session.ack(data.len()).unwrap();
                received.extend(data);
            }
            Ok(TerminalEvent::Error(error)) => errors.push(error),
            Ok(TerminalEvent::Exit(_)) => {
                exited = true;
                break;
            }
            Err(_) => break,
        }
    }
    session.close();
    assert!(exited, "reader did not finish");
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(received.len(), 50_000, "finite output silently truncated");
    assert!(received.iter().all(|byte| *byte == b'0'));
}

#[test]
fn continuous_post_exit_output_reports_truncation_before_exit() {
    let (tx, rx) = channel();
    let mut command = CommandBuilder::new("bash");
    command.args([
        "--noprofile", "--norc", "-c",
        "set -m; (trap '' HUP; printf 'BG:%s\\n' \"$BASHPID\"; while :; do printf '%08192d' 0; done) & read -r line",
    ]);
    let session = Session::spawn(command, 80, 24, move |event| {
        if matches!(event, TerminalEvent::Output(_)) {
            std::thread::sleep(Duration::from_millis(10));
        }
        tx.send(event).is_ok()
    })
    .unwrap();
    let text = until(&session, &rx, "BG:");
    let pid: i32 = text
        .split("BG:")
        .nth(1)
        .unwrap()
        .lines()
        .next()
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    session.write(b"\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut errors = Vec::new();
    let mut exited = false;
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(TerminalEvent::Output(data)) => session.ack(data.len()).unwrap(),
            Ok(TerminalEvent::Error(error)) => errors.push(error),
            Ok(TerminalEvent::Exit(_)) => {
                exited = true;
                break;
            }
            _ => {}
        }
    }
    // The deliberately detached test descendant is outside Session::close's contract.
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
    session.close();
    assert!(exited, "continuous descendant output retained reader");
    assert_eq!(
        errors,
        ["Terminal output drain timed out after shell exit; output truncated"]
    );
}

#[test]
fn post_exit_flow_stall_is_bounded_without_acks() {
    let flow = Flow::default();
    let exited = AtomicBool::new(true);
    assert!(flow.reserve(OUTPUT_LIMIT, &exited));
    let began = Instant::now();
    assert!(!flow.reserve(1, &exited));
    assert!(began.elapsed() < Duration::from_secs(2));
}
