# AudioKeyLoop

A Windows desktop utility that loops a selected audio file while any of the global W, A, S, or D keys are held.

## Controls
- Select an audio file and an audio output device.
- Hold W, A, S, or D to loop the audio; release all four keys to stop.
- Hold either Shift key while playing to temporarily double the selected playback speed.
- Use the Playback speed slider to set the normal speed from 0.50x to 2.00x. Shift doubles that setting (up to 4.00x).
- Use Test audio (2 sec) to verify the selected output.

## Audio formats
The player uses NAudio's Windows audio readers and Windows Media Foundation for formats beyond basic WAV/MP3. Common formats include WAV, MP3, AIFF/AIF, FLAC (where the Windows decoder is available), WMA, AAC, M4A/MP4, OGG/Opus and other formats supported by installed Windows codecs. Actual support depends on the codecs available on the Windows installation. The All files option lets you try other extensions.

## Download
Open the repository's Actions tab, select **Build WavKeyLoop EXE**, open the latest successful run, and download **WavKeyLoop-win-x64**. It is a self-contained Windows x64 executable; no .NET installation is required.

The workflow builds automatically when files under this folder change on main, or can be started manually with Run workflow.
