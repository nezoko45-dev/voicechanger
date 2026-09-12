# VoiceChanger Driver third-party notices

The bundled virtual audio driver package is based on the open-source **Virtual Audio Driver** project by MikeTheTech / VirtualDrivers:

- https://github.com/VirtualDrivers/Virtual-Audio-Driver
- License: MIT for the project's original code.
- The project also includes code derived from Microsoft Windows Driver Samples (SysVAD / Simple Audio Sample), which is covered by the Microsoft Public License (MS-PL).

This repository does not claim ownership of the third-party driver binaries. The VoiceChanger app supplies an installation wrapper around the bundled driver package so Windows can expose a virtual speaker and virtual microphone endpoint.

The release used by the build workflow is the signed `25.7.14` package published by VirtualDrivers. Its release page identifies SignPath.io / SignPath Foundation as the signing provider.

Upstream release:
https://github.com/VirtualDrivers/Virtual-Audio-Driver/releases/tag/25.7.14
