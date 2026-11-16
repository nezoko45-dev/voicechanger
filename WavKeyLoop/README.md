# WavKeyLoop

A small Windows desktop utility that plays a selected WAV file while any of the global W, A, S, or D keys are held.

## Behavior
- Select a WAV file.
- Select a Windows WaveOut audio output device (including virtual devices exposed by Windows).
- Hold W, A, S, or D to loop the WAV.
- Release all four keys to stop playback.
- The keyboard hook works while another application has focus.

## Download the EXE
Open the repository's **Actions** tab, select **Build WavKeyLoop EXE**, open the latest successful run, and download the **WavKeyLoop-win-x64** artifact. It is a self-contained Windows x64 executable; no .NET installation is required.

The build runs automatically when files under this folder change on main, or can be started manually with **Run workflow**.