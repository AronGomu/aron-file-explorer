use std::ffi::OsStr;
use std::fs::File;
#[cfg(windows)]
use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::path::{Component, Path};

// Pin directories before any read/write. A renamed parent must never redirect a config operation.
pub(crate) struct ConfigDirectory {
    #[cfg(unix)]
    directory: File,
    #[cfg(windows)]
    path: std::path::PathBuf,
    #[cfg(windows)]
    _parents: Vec<File>,
}

impl ConfigDirectory {
    pub(crate) fn open(path: &Path, create: bool) -> io::Result<Self> {
        if !path.is_absolute() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Config path must be absolute"));
        }
        #[cfg(unix)]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let mut directory = File::open("/")?;
            for component in path.components() {
                let name = match component {
                    Component::RootDir => continue,
                    Component::Normal(name) => c_name(name)?,
                    _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid config path")),
                };
                let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
                let mut fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
                if fd < 0 && create && io::Error::last_os_error().kind() == io::ErrorKind::NotFound {
                    let result = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o700) };
                    if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists {
                        return Err(io::Error::last_os_error());
                    }
                    fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
                }
                if fd < 0 { return Err(io::Error::last_os_error()); }
                directory = unsafe { File::from_raw_fd(fd) };
            }
            Ok(Self { directory })
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
            let mut current = std::path::PathBuf::new();
            let mut parents = Vec::new();
            for component in path.components() {
                current.push(component.as_os_str());
                if !matches!(component, Component::Normal(_)) { continue; }
                if create && !current.try_exists()? { std::fs::create_dir(&current)?; }
                // BACKUP_SEMANTICS | OPEN_REPARSE_POINT; deny delete sharing to pin each ancestor.
                let file = OpenOptions::new().read(true).share_mode(3)
                    .custom_flags(0x02000000 | 0x00200000).open(&current)?;
                let metadata = file.metadata()?;
                if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid config directory"));
                }
                parents.push(file);
            }
            Ok(Self { path: path.to_path_buf(), _parents: parents })
        }
    }

    fn open_file(&self, name: &OsStr, create: bool) -> io::Result<File> {
        if Path::new(name).components().count() != 1 || !matches!(Path::new(name).components().next(), Some(Component::Normal(_))) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid config basename"));
        }
        #[cfg(unix)]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let name = c_name(name)?;
            let flags = libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK
                | if create { libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL } else { libc::O_RDONLY };
            let fd = unsafe { libc::openat(self.directory.as_raw_fd(), name.as_ptr(), flags, 0o600) };
            if fd < 0 { return Err(io::Error::last_os_error()); }
            Ok(unsafe { File::from_raw_fd(fd) })
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // OPEN_REPARSE_POINT; BACKUP_SEMANTICS on reads allows same-handle directory rejection.
            let flags = 0x00200000 | if create { 0 } else { 0x02000000 };
            OpenOptions::new().read(!create).write(create).create_new(create)
                .custom_flags(flags).open(self.path.join(name))
        }
    }

    pub(crate) fn read_regular(&self, name: &OsStr, limit: Option<usize>) -> io::Result<Vec<u8>> {
        let file = self.open_file(name, false).map_err(|error| {
            #[cfg(unix)]
            if error.raw_os_error() == Some(libc::ELOOP) {
                return io::Error::new(io::ErrorKind::InvalidInput, "file must be a regular file");
            }
            error
        })?;
        let metadata = file.metadata()?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "file must be a regular file"));
            }
        }
        if !metadata.is_file() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "file must be a regular file"));
        }
        let mut bytes = Vec::new();
        file.take(limit.map_or(u64::MAX, |limit| limit as u64 + 1)).read_to_end(&mut bytes)?;
        if limit.is_some_and(|limit| bytes.len() > limit) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "file exceeds byte limit"));
        }
        Ok(bytes)
    }

    pub(crate) fn create_new(&self, name: &OsStr, bytes: &[u8]) -> io::Result<()> {
        let mut file = self.open_file(name, true)?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    pub(crate) fn atomic_write(&self, name: &OsStr, bytes: &[u8]) -> io::Result<()> {
        let temporary = format!(".explr-{:016x}.tmp", rand::random::<u64>());
        // create_new never truncates an existing file, including a colliding temporary name.
        let mut file = self.open_file(OsStr::new(&temporary), true)?;
        let result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            #[cfg(unix)]
            {
                use std::os::fd::AsRawFd;
                let from = c_name(OsStr::new(&temporary))?;
                let to = c_name(name)?;
                let fd = self.directory.as_raw_fd();
                if unsafe { libc::renameat(fd, from.as_ptr(), fd, to.as_ptr()) } != 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            #[cfg(windows)]
            {
                // std uses MoveFileExW with REPLACE_EXISTING; pinned parents prevent path swaps.
                std::fs::rename(self.path.join(&temporary), self.path.join(name))?;
            }
            Ok(())
        })();
        if result.is_err() {
            #[cfg(unix)]
            {
                use std::os::fd::AsRawFd;
                let temporary = c_name(OsStr::new(&temporary))?;
                if unsafe { libc::unlinkat(self.directory.as_raw_fd(), temporary.as_ptr(), 0) } != 0 {
                    eprintln!("Failed to remove config temporary file: {}", io::Error::last_os_error());
                }
            }
            #[cfg(windows)]
            if let Err(error) = std::fs::remove_file(self.path.join(temporary)) {
                eprintln!("Failed to remove config temporary file: {error}");
            }
        }
        result
    }

    pub(crate) fn names(&self) -> io::Result<Vec<std::ffi::OsString>> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::ffi::OsStrExt;
            // fdopendir owns this duplicate. Never reopen the directory by its original path.
            let fd = unsafe { libc::openat(self.directory.as_raw_fd(), c".".as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC) };
            if fd < 0 { return Err(io::Error::last_os_error()); }
            let dir = unsafe { libc::fdopendir(fd) };
            if dir.is_null() {
                let error = io::Error::last_os_error();
                if unsafe { libc::close(fd) } != 0 { eprintln!("Failed to close config directory descriptor"); }
                return Err(error);
            }
            let mut names = Vec::new();
            loop {
                // readdir returns null at EOF; errno distinguishes a failed scan.
                #[cfg(target_os = "linux")]
                unsafe { *libc::__errno_location() = 0; }
                #[cfg(target_os = "macos")]
                unsafe { *libc::__error() = 0; }
                let entry = unsafe { libc::readdir(dir) };
                if entry.is_null() { break; }
                let bytes = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
                if bytes != b"." && bytes != b".." { names.push(OsStr::from_bytes(bytes).to_os_string()); }
            }
            let error = io::Error::last_os_error();
            let closed = unsafe { libc::closedir(dir) };
            if error.raw_os_error() != Some(0) { return Err(error); }
            if closed != 0 { return Err(io::Error::last_os_error()); }
            Ok(names)
        }
        #[cfg(windows)]
        {
            std::fs::read_dir(&self.path)?.map(|entry| entry.map(|entry| entry.file_name())).collect()
        }
    }
}

#[cfg(unix)]
fn c_name(name: &OsStr) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(name.as_bytes()).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}
