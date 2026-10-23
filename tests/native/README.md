# Native regression checks

Reusable native checks live here; screenshots, logs and result receipts are generated under `artifacts/` and stay outside Git. Disposable application profiles live under `.tmp/`. Run from the repository root after building the native release.

```sh
python3 tests/native/drag-move/native-check.py
python3 tests/native/path-input-focus/native-check.py
python3 tests/native/close-tab/native-check.py
python3 tests/native/focus-shortcuts/native-check.py
python3 tests/native/hover-details/native-check.py
python3 tests/native/zoom-scroll/native-check.py
python3 tests/native/video-thumbnails/native-check.py
python3 tests/native/video-playback/native-check.py
```

Set `EXPLR_TEST_BINARY` to test the installed executable instead of `target/release/src-tauri`. Run checks sequentially: they share inspector port 9235. The selection-deletion script supplies the native inspector helper used by the other checks; its standalone deletion scenario requires the historical six-file fixture.

Checks require Python's `websocket-client`, Hyprland, GTK/WebKit and a working Wayland session. Video checks also require FFmpeg with the fixture codecs. Each launches the full Tauri application on an unused workspace without taking focus or using the cursor. A browser preview is not equivalent evidence.

The video playback check exercises 15 common video/container combinations, including H.264, HEVC and AV1, with audio and seeking, plus a silent WebM. Set `EXPLR_VIDEO_SAMPLE` to include a copy of a real video; its original stays untouched. Playback fixtures and their isolated profile are removed after the check.

The scripts stop their fixture processes and preserve scratch profiles for diagnosing failures. Remove only profiles created by the current run after reviewing results; never remove another session's fixtures or private application data.
