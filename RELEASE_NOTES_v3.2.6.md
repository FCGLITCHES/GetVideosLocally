# GetVideosLocally v3.2.6 Hotfix

## Download recovery and retry controls

- X removes a download card immediately and saves that choice before contacting the server.
- If a removal request fails or its response is lost, the card stays hidden across reloads and restarts. The app retries removing the saved queue entry when connected.
- Retry is now an icon beside X, with a tooltip and accessible label. Removed the separate Retry all row.
- Failed downloads stay visible, including when a retried or resumed download fails again.
- Cancelled queued downloads no longer start later, and late metadata updates cannot restore removed cards.
- Interrupted downloads return as resumable items. Stale saved state no longer brings dismissed items back.
- Failed items show a short explanation and expandable error details, and no longer count as queued or display a disabled Done button.
- Automatic retries follow the Smart Retry setting and attempt limit.

## Downloads

Use the Windows installer to update an existing installation, or extract the portable ZIP and run GetVideosLocally.exe.

Completed downloads, history, and settings are preserved when upgrading. Sources that require a login still need valid browser cookies or account access.
