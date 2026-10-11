# Fish Audio Call Again

A lightweight Chrome extension that clicks Fish Audio's **Call again** button for you. No Python, local server, or voice-conversion model required.

## Install
1. Open [chrome://extensions](chrome://extensions).
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this repository's `extension` folder.
4. Open Fish Audio in a tab and refresh it once after installing.

## Use
- Click the extension icon on a Fish Audio tab.
- Turn on **Auto-click** to click the next available **Call again** button and repeat as new results finish.
- Set a delay if you want the page to settle before the click.
- Use **Click once** for a single manual click.
- Turn Auto-click off to stop the loop.

The extension only runs on Fish Audio pages. It does not access your Fish Audio account, call private APIs, or store page content. It automates the site's visible button. The original `Recording (10).wav` reference file is preserved in the repository but is not needed for this extension.

## Troubleshooting
- Make sure the button is visibly labeled **Call again** and the page is fully loaded.
- After loading the extension, refresh the Fish Audio tab.
- If Fish Audio changes the button label or layout, update the text matcher in `extension/content.js`.
