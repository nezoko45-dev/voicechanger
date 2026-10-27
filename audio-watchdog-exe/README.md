# Audio Watchdog (Windows)

This helper monitors the default Windows microphone and speaker output. If it detects recent microphone activity while system output has stayed quiet for 16 seconds, it attempts to click **Stop** and then **Start dictation** on the Continuous Dictation & Voice Reader webpage.

## Build / download

1. Open the repository's **Actions** tab.
2. Select **Build Audio Watchdog EXE** and open the newest successful run.
3. Under **Artifacts**, download `AudioWatchdog-Windows-x64` and extract `AudioWatchdog.exe`.
4. Run the EXE. It stays in the Windows notification area; right-click its icon to exit.
5. Keep the dictation webpage open in Chrome or Edge. The webpage must expose its **Stop** and **Start dictation** buttons to Windows UI Automation.

The build is self-contained for Windows x64 and does not require Python or a separately installed .NET runtime.

## Important limits

- Audio levels are a heuristic, not speech recognition: this cannot prove the Google voice said the right words.
- If you pause speaking, or the read-aloud is naturally silent for a long time, the watchdog may infer a stall. It uses a 16-second output-silence threshold and a 30-second recovery cooldown to reduce repeated clicks.
- Windows default capture/render devices are monitored. If Chrome uses a different output device, set that device as the Windows default before starting the watchdog.
- UI automation can vary by browser/version. If it cannot find the buttons, keep the dictation page open in a normal browser tab and check the notification-area message.
- Use the tray menu's **Exit** item to stop monitoring.
