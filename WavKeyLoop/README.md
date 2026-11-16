# AudioKeyLoop

A small Windows desktop utility that loops a selected audio file while any of the global W, A, S, or D keys are held.

## Behavior
- Select an audio file from the supported-format picker (or choose **All files**).
- Select a Windows WaveOut audio output device, including virtual devices exposed by Windows.
- Hold W, A, S, or D to loop the selected audio.
- Release all four keys to stop playback.
- The global keyboard hook works while another application has focus.
- Use **Test audio (2 sec)** to check the selected output device.

## Audio formats
The player uses NAudio's Windows audio readers and Windows Media Foundation for formats beyond basic WAV/MP3. Common formats include:
- WAV, MP3, AIFF/AIF
- FLAC (where the Windows FLAC decoder is available)
- WMA, AAC, M4A/MP4
- OGG/Opus and other formats supported by the installed Windows Media Foundation codecs

Actual support depends on the codecs available in your Windows installation. If a file cannot be decoded, the app displays the decoder error. The **All files** option lets you try other file extensions.

## Download the EXE
Open the repository's **Actions** tab, select **Build WavKeyLoop EXE**, open the latest successful run, and download the **WavKeyLoop-win-x64** artifact. It is a self-contained Windows x64 executable; no .NET installation is required.

The build runs automatically when files under this folder change on main, or can be started manually with **Run workflow**.

Playback uses a continuous stream loop until all W/A/S/D keys are released.
