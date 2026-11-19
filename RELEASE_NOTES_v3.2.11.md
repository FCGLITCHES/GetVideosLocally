# GetVideosLocally v3.2.11

## Fixed: download choices now stick

- Format, Quality and Concurrent downloads now remember what you last picked. Before, they went back to the choices from first-time setup whenever the window reloaded or the app restarted.
- Both concurrency pickers are remembered: the one under Advanced Options and the one for full playlists.
- Saving Settings no longer drops preferences it doesn't show.
- Settings are written to disk straight away, so they survive the app being closed by an update, a crash or a Windows shutdown.
- New **Remember my last choices** switch, on by default. Pick it in the setup guide or under Settings → Downloads. Turn it off and every launch starts with the same format, quality and concurrent downloads.

## Diagnostics

- The diagnostics report no longer says FFmpeg auto-update is blocked once that FFmpeg version is already installed.

Thanks to the user who reported the reset through Report a problem.

## Downloads

Use the Windows installer to update an existing installation, or extract the portable ZIP and run GetVideosLocally.exe.

Completed downloads, history, and settings are preserved when upgrading.
