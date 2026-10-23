# Explorer keyboard controls

Press **F10**, or the keyboard button in the toolbar, to show a key label on every visible toolbar, tab-bar, and side-panel button. Type the letters shown on a control to activate it: **T** labels belong to toolbar/tabs, **L** to the left panel, **R** to the right panel. This also covers dynamic controls such as favorite removal, drive mounting/ejection, breadcrumb segments, section collapse, and SFTP connection actions. Disabled buttons remain disabled. Press Escape or F10 to cancel; Backspace removes a typed letter. Scroll or click to exit, then reopen F10 to label newly visible controls.

Frequent actions also have direct shortcuts. Use Command in place of Ctrl for letter shortcuts on macOS; view switching also accepts the corresponding Command+Shift key combination.

| Action | Shortcut |
| --- | --- |
| Back / Forward | Alt+Left / Alt+Right; Backspace / Shift+Backspace |
| Refresh folder/drives | Ctrl+R or F5 |
| Edit location | Ctrl+L |
| Search current folder | Ctrl+F |
| Global search | Ctrl+Shift+F |
| Copy selected items' paths | Ctrl+Shift+C or Ctrl+Alt+C |
| Copy / Cut / Paste files | Ctrl+C / Ctrl+X / Ctrl+V |
| Select all visible items | Ctrl+A |
| Icons / List view | Ctrl+Shift+1 / Ctrl+Shift+2 |
| New tab / Close active tab | Ctrl+T / Ctrl+W (closing the last tab closes the window) |
| Select an open tab by position | Ctrl+1 through Ctrl+9 |
| Open a sidebar destination by position | Alt+1 through Alt+9, from top to bottom in expanded sections |
| Toggle left panel | Ctrl+B |
| Toggle preview panel | Ctrl+Shift+B |
| Toggle preview information | Ctrl+Alt+I |
| Settings | Ctrl+, |
| New file / New folder | Ctrl+N / Ctrl+Shift+N |
| Rename selected item | F2 |
| Delete / Undo last deletion | Delete / Ctrl+Z |
| Select a range | Shift+Arrow; reverse direction to remove items from the range |
| View zoom | Ctrl+Plus / Ctrl+Minus; Ctrl+mouse wheel |

The file chooser shares Explorer's copy, cut, paste, rename, creation, trash, undo, properties, and drag-and-drop actions. Copy and cut work between Explorer and chooser windows. Creation and rename are available through their dialogs and context menus; file action shortcuts leave text inputs and dialogs to handle editing. Select All includes only visible results and excludes the chooser's `..` navigation entry.

Copy Path works for single and multiple selections in Explorer and the file chooser. It copies quoted paths separated by spaces, for example `"/path/to/file/1" "/path/to/file/2" "/path/to/file/3"`. Quotes, backslashes, and control characters within paths are escaped. With no selected items, the clipboard stays unchanged. The shortcut leaves text inputs and dialogs to handle editing.

The shared location input (Ctrl+L) offers a dropdown of local path completions. The first match is selected; Up/Down chooses another, Tab completes a folder and lists its children, Enter opens the selected result, and Escape dismisses editing. Clicking a suggestion also opens it. Empty input offers recent folders and common locations. Partial names match prefixes, substrings, then fuzzy letter sequences; `~/` expands to the home folder, and relative paths start in the current folder. Hidden paths follow each window's hidden-file setting; explicitly typing a dot prefix also reveals matching hidden entries. Save and folder-only choosers suggest only directories. Existing SFTP path navigation remains available without local autocomplete.

View zoom is shared between icon and list modes and saved across application restarts. Each folder's vertical and horizontal scroll offsets are also saved; the 100 most recently saved folder positions remain available across sessions. Restoring a folder keeps its scroll position even when the focused item is offscreen. Arrow navigation brings that item back into view. These preferences stay in the application's local storage and survive application updates.

Pointer interactions with the toolbar, tabs, side-panel buttons, or resize handles return keyboard focus to the item pane after the action. Clicking an item also focuses the pane, including after column resizing. Text inputs, editable content, dialogs, context menus, and native media controls retain their required keyboard interaction. Normal Tab navigation remains available for controls; plain arrows from toolbar buttons or preview text return to item navigation. Selecting a button through F10 returns focus to the pane unless it opens an input or dialog.

Clicking outside the location bar cancels path editing, clears its text selection, and returns focus to the item pane, including in an empty folder. Clicks and selection drags starting inside the bar preserve path editing. Clicking into another text field or opening a dialog keeps focus with that control.

Resize handles remain keyboard accessible: focus a list column separator and use Left/Right; focus a side-panel separator and use Alt+Shift+Left/Right; focus the preview split and use Alt+Shift+Up/Down. Home/End on panel handles choose their endpoints. Returning to an item restores file navigation.

Shortcut routing lives in `ContextMenuProvider.jsx`, `FileList.jsx`, `MainLayout.jsx`, `NavigationButtons.jsx`, `PathBreadcrumb.jsx`, `DetailsPanel.jsx`, `TabManager.jsx`, and `InterfaceShortcuts.jsx`. Text fields and dialogs suppress file-action shortcuts to protect editing.

Ctrl+W also closes the active tab while a location/search input or another text field has focus. When another tab remains, it becomes active and keyboard focus returns to its items. Closing the final tab closes the native window; reopening Explr restores that folder. Modal dialogs retain their keyboard interaction. Held-key repeats do not close additional tabs. Ctrl+T remains suppressed while typing in a text field.

Double-clicking a local TXT file opens the preview pane and focuses its text editor when the complete text is editable. The editor section and the middle item pane show the same border when focused. Other preview types keep their existing behavior. Ctrl+1–9 and Alt+1–9 also work from the editor; modal dialogs retain focus. Sidebar shortcut badges occupy the action slot on each numbered row and give way to its remove/eject button on hover or keyboard focus. Collapsing a sidebar section renumbers the remaining destinations. Positions beyond nine have no number shortcut.
