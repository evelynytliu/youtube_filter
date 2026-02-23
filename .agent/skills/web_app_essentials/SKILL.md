---
name: web_app_essentials
description: Ensures standard modern web app interactions (Drag-n-Drop Upload, Paste, DND Sorting) are included by default.
---

# Web App Essentials

This skill enforces the inclusion of "Standard" interactive features that users expect from modern web applications, even if not explicitly requested.

## Default Interaction Standards

When building forms, lists, or upload areas, **AUTOMATICALLY** suggest or implement:

### 1. File Uploads (Drag & Drop + Paste)
If the user asks for an "upload button" or "image input":
-   **Don't just make `<input type="file">`.**
-   **Structure**: Create a drop zone `div` that listens for `ondragover` and `ondrop`.
-   **Clipboard Support**: Add a global (or focused) `onpaste` listener to capture images from the clipboard (`e.clipboardData.files`).
-   **Visuals**: Dashed border when inactive, solid highlight color when dragging over.

### 2. Lists & Collections (Drag to Sort)
If the user asks for a "list of items" that implies order (e.g., TODOs, Playlist, Steps):
-   **Suggest Sortable**: "Should users be able to reorder these?"
-   **Implementation**: Use a lightweight library like `SortableJS` (Vanilla) instead of writing raw drag logic if complex.
-   **Raw Logic**: If writing raw, remember `draggable="true"`, `onDragStart` (set data index), and `onDragOver` (preventDefault).

### 3. Shortcuts
-   **Submit**: Ctrl+Enter / Cmd+Enter on textareas.
-   **Close**: Escape key on Modals.
