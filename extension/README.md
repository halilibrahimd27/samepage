# samepage browser extension

Adds **Translate this PDF with samepage** to the context menu of a PDF tab, and **Translate the
linked PDF with samepage** to links. The extension downloads the PDF in your browser, opens
[samepage](https://halilibrahimd27.github.io/samepage/) in a new tab and hands the file to it.
Nothing is uploaded: the file goes from your browser to the samepage page, which runs locally.

## Permissions

- `contextMenus` — the two menu entries.
- `activeTab` — read the PDF of the tab you clicked in, only when you click.
- `scripting` and the samepage site — hand the file to the samepage tab.
- Optional, per site: when you translate a **linked** PDF on another site, the extension asks
  for that one site at your click. It never asks for all sites.

## Install for development

- Chrome / Edge: `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
- Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `manifest.json`.

`npm run extension` writes `dist-extension/samepage-extension.zip` for the Chrome Web Store and
addons.mozilla.org (publishing needs the maintainer's store accounts).

## Zotero

Drag a PDF attachment from Zotero onto the samepage page: Zotero hands it over as a file.
