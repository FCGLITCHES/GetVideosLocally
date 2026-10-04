# GetVideosLocally v3.2.7

## Settings refresh

- Settings are split into General, Downloads, Network and Advanced sections, with clearer rows and toggle switches.
- The header shows live Queued, Downloading and Downloaded counts.
- Buttons, the History tab, its filters and the clear-history dialog have a cleaner, more consistent look.

## Optional usage statistics

- A new setting under Advanced lets you share anonymous usage statistics: app version, launches, and whether downloads worked.
- It is off unless you turn it on. Links, titles, file names and paths are never sent. See the Privacy page for details.

## Security hardening

- All local API and WebSocket requests now require the app's session token. Requests from other websites or hosts are rejected.
- Downloaded files are no longer served to anything except the app.
- The app windows run sandboxed, block unexpected navigation, and only open safe links externally.
- Pasted links and remote video titles can no longer be read as command-line options or create unsafe file names.
- FFmpeg updates install both binaries together or not at all, and a failed download no longer crashes the app.
- Logs no longer include the session token, and are written to the app's data folder.
- Dependencies updated to clear known security advisories.

## Fixes

- Imported browser cookies are now stored in their own folder and no longer clash with the app's internal cookie store. Cookies imported in earlier versions are recovered automatically, and invalid cookie files are rejected with a clear message.
- Cancelling a playlist now also stops its remaining downloads.
- Direct media links without a known resolution download correctly.
- Playlist items from generic sites keep their original links.
- A new download no longer overwrites an existing file with the same name.
- Scheduled downloads set far in the future no longer start immediately.
- Settings, history and queue files are saved safely when several changes happen at once, and a failed save keeps the previous backup.
- The close confirmation now appears before downloads are interrupted, and quitting saves state before shutting down.
- Forcing an update check now actually checks again.

## Downloads

Use the Windows installer to update an existing installation, or extract the portable ZIP and run GetVideosLocally.exe.

Completed downloads, history, and settings are preserved when upgrading. Sources that require a login still need valid browser cookies or account access.
