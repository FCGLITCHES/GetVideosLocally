# GetVideosLocally

<div align="center">

![GetVideosLocally Logo](assets/Logo%201.png)

**A free, open-source Windows desktop app for downloading, processing, and converting video and audio from 1,000+ supported sites, with quality options up to 8K.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](https://www.microsoft.com/windows)
[![Electron](https://img.shields.io/badge/Electron-42.1.0-47848F.svg)](https://www.electronjs.org/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-red.svg)](https://github.com/yt-dlp/yt-dlp)
[![Latest release](https://img.shields.io/github/v/release/FCGLITCHES/GetVideosLocally)](https://github.com/FCGLITCHES/GetVideosLocally/releases)

[Download](https://github.com/FCGLITCHES/GetVideosLocally/releases) •
[Report a bug](https://github.com/FCGLITCHES/GetVideosLocally/issues) •
[Source](https://github.com/FCGLITCHES/GetVideosLocally)

</div>

---

## Overview

GetVideosLocally is a local-first desktop application built around yt-dlp and FFmpeg. It is designed to provide a straightforward Windows interface for downloading and processing media without requiring an account or cloud-based workflow.

The project is actively maintained, with recent releases focused on reliability, security hardening, Windows integration, download-history persistence, dependency updates, and regression coverage.

## Highlights

- Support for 1,000+ sites through yt-dlp
- Video quality from 360p up to 8K when available
- MP4, MKV, MOV and WEBM video output
- MP3, WAV, M4A, OPUS and FLAC audio extraction
- Download queues with configurable concurrency
- Playlist handling
- Download history with search, filtering and bulk actions
- Metadata, thumbnail and chapter embedding
- Custom download folders
- Desktop notifications and system-tray support
- Automatic yt-dlp updates
- Local-first operation with no account requirement

## Security and reliability

Recent releases include safeguards for local file operations and release maintenance, including:

- Restricting sensitive file actions to trusted download locations
- Sending deletions through the Windows Recycle Bin
- Escaping remote titles, filenames, paths and other dynamic content before rendering
- Verifying FFmpeg updates against shipped SHA-256 data
- Explicit opt-in for Windows Firewall/LAN access
- Updating or pinning vulnerable dependencies
- Regression coverage for history persistence, playback, path traversal rejection and affected UI states

See the [release history](https://github.com/FCGLITCHES/GetVideosLocally/releases) for version-specific details.

## Quick start

1. Open the [latest release](https://github.com/FCGLITCHES/GetVideosLocally/releases).
2. Download either the Windows installer or portable package.
3. Launch GetVideosLocally.
4. Paste a supported media URL.
5. Select the required format and quality, then start the download.

**System requirements:** Windows 10/11 (64-bit), an internet connection, and sufficient local storage for the selected media.

## Screenshots

<div align="center">

![GetVideosLocally Screenshot 1](public/Pic1.png)

![GetVideosLocally Screenshot 2](public/Pic2.png)

![GetVideosLocally Screenshot 3](public/Pic3.png)

![GetVideosLocally Screenshot 4](public/Pic4.png)

</div>

## Usage

### Downloads

1. Paste a supported URL.
2. Choose the output format and quality.
3. Optionally configure advanced download settings.
4. Select **Download Now**.

For playlists, the app can process either the selected item or the full playlist. Concurrent downloads can be limited when connection stability or bandwidth is a concern.

### Authentication

For content you are authorised to access, browser cookies can be imported from **Settings → Import Cookies**.

### History

The History tab supports:

- Singles and playlist views
- Search by title or filename
- Date and type filters
- Sorting by date, name or file size
- Bulk deletion
- Opening completed files or their containing folders

### Updating tools

GetVideosLocally can update yt-dlp from within **Settings → Update Tools**. FFmpeg updates can be installed separately when required.

## Development

### Prerequisites

- Node.js 16+
- npm
- Git

### Setup

```bash
git clone https://github.com/FCGLITCHES/GetVideosLocally.git
cd GetVideosLocally
npm install
```

### Development commands

```bash
# Run in development mode
npm run electron:dev

# Run the backend server
npm start

# Build the portable package
npm run build:portable

# Build the Windows installer
npm run build

# Icon management
npm run icon:generate
npm run icon:verify
npm run icon:verify-exe
```

Build output is written to `dist/`.

### Project structure

```text
GetVideosLocally/
├── assets/              # Images, sounds and UI assets
├── bin/                 # Bundled executables and tools
├── public/              # Static HTML and assets
├── backend/             # Backend modules and services
├── tests/               # Automated tests
├── electron-main.js     # Electron main process
├── server.js            # Express/WebSocket backend
├── script.js            # Frontend logic
├── index.html           # Main UI
├── style.css            # Styles
├── preload.js           # Electron preload
├── package.json
└── README.md
```

### Architecture

- **Electron main process:** application lifecycle, windows and IPC
- **Backend:** Express, WebSocket, media-processing orchestration and local services
- **Frontend:** download workflow, queue, history and settings UI
- **Media tooling:** yt-dlp and FFmpeg

## Contributing

Bug reports, feature requests, documentation improvements, translations and code contributions are welcome.

- [Open an issue](https://github.com/FCGLITCHES/GetVideosLocally/issues)
- Check existing issues before filing a duplicate
- Keep changes focused and consistent with the existing project
- Test behavioural changes before submitting them
- Update documentation where behaviour changes

For larger changes, opening an issue first is recommended so the approach can be discussed before implementation.

## Support

GetVideosLocally is free and open source. The most useful ways to support the project are to report reproducible bugs, suggest improvements, contribute fixes, and share the project with people who may find it useful.

Optional financial support is available through the project's [support link](https://donate.stripe.com/6oU00i73R6eh2yc0oU5AQ00).

## License

GetVideosLocally is licensed under the [MIT License](LICENSE).

### Third-party software

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Unlicense
- [FFmpeg](https://ffmpeg.org/legal.html) — LGPL/GPL depending on build configuration
- [Electron](https://github.com/electron/electron) — MIT
- Other dependencies are listed in `package.json`

If you fork or redistribute GetVideosLocally, retain the licence notices required by the MIT licence. Visible attribution back to the original project is appreciated:

`https://github.com/FCGLITCHES/GetVideosLocally`

## Responsible use

GetVideosLocally is a media-processing tool. Users are responsible for ensuring they have the rights or permission required for the content they process and for complying with applicable copyright law and platform terms.

The software is provided as-is for lawful use.