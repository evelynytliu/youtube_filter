---
name: icon_specialist
description: Specialized knowledge for handling favicons, PWA icons, and Windows app icons (.ico).
---

# Icon Specialist

This skill helps with generating, resizing, and implementing application icons across different platforms.

## Common Workflows

### 1. Web / PWA (manifest.json)
-   Standard sizes needed: 192x192, 512x512 (PNG).
-   Favicon: `favicon.ico` (can contain multiple sizes) or `icon.svg` (for modern browsers).
-   **Action**: When asked to "update logo", check `layout.js` or `index.html` <head> tags.

### 2. Windows Apps (.exe / .ico)
-   Converting PNG to ICO is often required.
-   **Tooling**: Use Python (`Pillow`) or `imagemagick` if available to convert.
-   Command output example: `ffmpeg -i logo.png -define icon:auto-resize=256,128,64,48,32,16 result.ico`

## SVG Handling
-   If the user provides an SVG, check if `fill="currentColor"` is used to allow CSS coloring.
-   Remove unnecessary metadata (`<metadata>`, `<!-- Generator... -->`) to optimize file size.
