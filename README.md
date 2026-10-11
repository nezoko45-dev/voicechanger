# Fish Audio Call Again

A lightweight Chrome extension that clicks Fish Audio's **Call again** button for you. No Python, local server, or voice-conversion model required.

## Install

1. Download the repository using **Code → Download ZIP**, then extract the ZIP. Do not select the ZIP file itself.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked**. Select either:
   - the main extracted `voicechanger` folder (the one containing `manifest.json`, `README.md`, and `Recording (10).wav`), or
   - the `extension` folder inside it.
4. If Chrome already has an older broken copy installed, remove that entry first, then load the folder again.
5. Open Fish Audio in a tab and refresh it once after installing.

**Important:** Select a folder, not an individual file. Both supported folders now contain their own valid `manifest.json`.

## Use

- Click the extension icon on a Fish Audio tab.
- Turn on **Auto-click** to click the next available **Call again** button and repeat as new results finish.
- Set a delay if you want the page to settle before the click.
- Use **Click once** for a single manual click.
- Turn Auto-click off to stop the loop.

The extension only runs on Fish Audio pages. It does not access your Fish Audio account, call private APIs, or store page content. It automates the site's visible button. The original `Recording (10).wav` reference file is preserved in the repository but is not needed for this extension.

## Troubleshooting

- If Chrome says the manifest is missing or unreadable, extract the ZIP fully and choose the main `voicechanger` folder or its `extension` subfolder—not the ZIP, `README.md`, or another nested folder.
- After loading the extension, refresh the Fish Audio tab.
- Make sure the button is visibly labeled **Call again** and the page is fully loaded.
- If Fish Audio changes the button label or layout, update the text matcher in `content.js` (main folder version: `extension/content.js`).
