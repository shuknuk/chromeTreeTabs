# ZenTree Tabs

<div align="center">
  <img src="icons/logo.svg" alt="ZenTree Tabs Logo" width="128" />
  <h3>Vertical Tab Manager for Chrome</h3>
  <p>Minimalist. Tree-Style. Native.</p>
</div>

<br />

**ZenTree Tabs** is a modern Chrome Extension that organizes your tabs into a vertical tree structure appearing in the Chrome Side Panel. Inspired by the "Arc" browser aesthetic, it brings order to your browsing chaos with automatic nesting, native group support, and a fluid, glassmorphic UI.

## 🎥 Demo

<div align="center">
  <img src="demo.gif" alt="ZenTree Tabs Demo" width="100%" />
</div>

*Experience ZenTree Tabs in action - see the vertical tree layout, drag & drop, theming, and more!*

## ✨ Key Features

- **🌳 Vertical Tree Layout**: Tabs automatically nest under their "opener", keeping your research context organized.
- **📂 Native Group Integration**: Existing Chrome Tab Groups are visualized as folders. Click headers to collapse/expand both the sidebar and the top group strip.
- **🔖 Bookmarks Manager**: integrated sidebar to view, open, and manage your bookmarks hierarchy.
- **📥 Downloads Manager**: Track recent downloads, view their status, and open files directly from the panel.
- **✏️ Tab Renaming**: Double-click any tab title to rename it locally (`Enter` to save, `Esc` to cancel).
- **🎯 Multi-Select Tabs**: Select multiple tabs with `Ctrl/Cmd + Click` or `Shift + Click` for batch operations. Close, group, or manage multiple tabs at once with the selection toolbar.
- **✋ Drag & Drop**: Reorder tabs or change their nesting hierarchy with smooth HTML5 drag-and-drop. You can also drag tabs directly into Group Headers to group them.
- **🎨 Modern Aesthetic**: Features a "Vibe Coding" inspired UI with glassmorphism, hover effects, and full Dark Mode support.
- **🎭 Theming Support**:
  - **5 Themes**: Ocean (Default), Sunset, Forest, Berry, and Monochrome.
  - **Customization**: Toggle "Background Mesh" and "Glassy Tabs" for a personal feel.
- **🖼️ Smart Icons**: 
  - Correctly fetches icons for Extension pages (New Tab, etc.).
  - Displays clean SVG system icons for `chrome://` pages (Settings, Extensions, History, etc.).
- **⚡ Smart Logic**: "New Tabs" always start at the root level, preventing accidental nesting chain fatigue.

## 🚀 Installation

1.  Clone or download this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** (toggle in the top right).
4.  Click **Load unpacked**.
5.  Select the directory containing the extension files (`manifest.json`, etc.).
6.  Open the Chrome Side Panel (via the Toolbar icon) and select **ZenTree Tabs**.

## 🛠️ Usage Tips

- **Collapsing**: Click the arrow or title of a "Folder" (Group) to collapse it. This syncs with Chrome's native collapse state.
- **Renaming**: Double-click a tab's text to assign a custom alias. This is stored locally and won't affect the actual page title.
- **Multi-Select**: Hold `Ctrl/Cmd` and click tabs to select multiple. Use `Shift + Click` for range selection. Press `Ctrl/Cmd + A` to select all. See [Multi-Select Guide](guides/multi-select-guide.md) for details.
- **New Branches**: Press `Cmd/Ctrl + T` to start a fresh branch at the root level.
- **Context Search**: Links opened from a parent tab will automatically nest as children.

## 🏗️ Technical Details

Built with **Vanilla JavaScript**, **CSS3**, and **HTML5**. Zero external frameworks or heavy dependencies.
- **Manifest V3**: Fully compliant with modern Chrome Extension standards.
- **Permissions**:
  - `sidePanel`: For the main UI.
  - `tabs` & `tabGroups`: For management and syncing.
  - `storage`: For persisting collapsed states and custom names.
  - `favicon`: For fetching high-quality icons.

## License

[MIT](LICENSE)
