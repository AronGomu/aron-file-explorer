# Dragging items to move them

Drag a file or folder in icon or list view onto a folder, an ancestor in the location bar, or a folder location in the sidebar. Dragging an already selected item moves the whole selection. Dragging an unselected item selects and moves that item alone. Dragging empty space still draws a selection rectangle.

Valid destinations receive an accent outline. Dropping moves items without navigating away from the current folder. Cancelling clears the highlight and returns keyboard focus to the item pane. The copy/cut clipboard is independent of dragging.

Existing destination names reject the entire selection before moving. Files are never overwritten. A folder cannot move into itself or its descendants, and a drop back into the same folder does nothing. Selected children travel with their selected parent once. Errors during execution report individual failures; successfully moved items remain at their destination.

Linux moves use GNU coreutils `mv -n -T --`, supporting mounted drives across filesystem boundaries while preserving file contents, metadata and symlinks. Mount a drive before dropping onto its sidebar entry. Unmounted drives and favorite files are not drop destinations.

SFTP moves are supported within one saved connection using server-side renames with overwrite disabled. Absolute remote breadcrumb paths retain their leading slash. Transfers between local storage and SFTP, or between different connections, are not offered by drag-and-drop. Live SFTP validation requires an available disposable server; local native and shared move-planner checks do not establish remote-server health.

## Validation

Run `node --test tests/file-drag.test.mjs` and `cargo test --locked --manifest-path src-tauri/Cargo.toml file_move_commands`. The Linux cross-volume test uses disposable directories on the project filesystem and `/dev/shm`, which must be different filesystems.

Use the full native Tauri application and disposable files for drag checks. In both views, verify a selected pair moves to a visible folder, a breadcrumb ancestor and a sidebar folder; an unselected item moves alone; a conflict preserves both originals; self/current-folder drops are rejected; cancellation clears highlights; rectangle and Shift-arrow selection still work. Repeat against the installed release and compare its checksum with the reviewed build. No browser preview is an acceptable substitute.
