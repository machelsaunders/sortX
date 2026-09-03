# sortX Sync (browser extension)

Keeps sortX in sync with your X bookmarks automatically, using the X session already in your browser. No cookies to copy, no bookmarklet to click.

## Install (Chrome, Edge, Brave, Arc)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension/` folder.
3. Click the sortX Sync icon, confirm the sortX address (default `http://localhost:3000`), pick an interval, **Save**, then **Sync now**.

The extension asks X for your newest bookmarks and stops as soon as it reaches posts sortX already has, so a scheduled check is two or three requests. New posts are sent to sortX, which runs its AI pipeline on them. Tick **Sync likes** to sync likes instead (install a second copy in another folder if you want both).

Safari: the extension uses standard WebExtension APIs and can be packaged with Xcode's `safari-web-extension-converter`; not tested.
