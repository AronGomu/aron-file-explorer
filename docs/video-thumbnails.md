# Video thumbnails

Icon and list views display a still-image preview for video files. Video filenames and normal file actions remain available. Thumbnails load as items approach the viewport. Damaged, unreadable or unsupported media retains its file icon.

A1. Runtime dependency: FFmpeg must be available on `PATH`. The Linux installer checks this prerequisite. No browser playback codec is required to display the resulting PNG.

A2. Formats recognized include MP4/M4V, MKV, AVI, MOV/QuickTime, WebM, WMV/ASF, MPEG, FLV/F4V, 3GP/3G2, OGV/OGM, AVCHD (MTS/M2TS/M2T), VOB, MXF, DivX/Xvid, RealMedia, DV, Y4M, MJPEG, H.264, H.265/HEVC and AV1. Decoding depends on the installed FFmpeg build. TypeScript `.ts` files retain their code icon.

A3. Frame extraction seeks one second into the video and falls back to its first frame for very short clips. Images preserve aspect ratio and are bounded by the requested thumbnail size (32–1024 pixels). Folder listings never autoplay video.

A4. The frontend shares the existing lazy thumbnail queue; the backend limits FFmpeg extraction to two concurrent processes and ten seconds per attempt. Cached PNGs live under the OS temporary directory in `file_explorer_thumbnails/`; their keys include source path, file size, modification time and thumbnail size. Cache publication is atomic. Changing the video or requested size generates a new thumbnail.

A5. SFTP videos use the existing local preview download cache before frame extraction. Remote video thumbnails therefore require downloading the source file. No separate external viewer opens during thumbnail loading.

A6. Validation: run `cargo test --locked --manifest-path src-tauri/Cargo.toml commands::video_commands::tests -- --nocapture` with FFmpeg installed. Native UI checks must use the full Tauri application and disposable media/profile fixtures; verify decoded images in icon/list modes, invalid-media fallback, normal image thumbnails, keyboard navigation and changed-file refresh.
