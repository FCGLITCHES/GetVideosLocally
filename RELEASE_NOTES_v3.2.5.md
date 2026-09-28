# GetVideosLocally v3.2.5 Hotfix

## Download recovery and retry controls

- Failed downloads stay visible, including when a retried or resumed download fails again.
- Retry and Retry all start fresh attempts without hiding newly failed items.
- Clicking X or Cancel stops unfinished work and removes its saved queue entry. Removed items stay gone after restarting the app.
- Prevented cancelled queued downloads and late metadata updates from starting or restoring removed items.
- Interrupted downloads return as resumable items. Stale legacy state no longer brings dismissed items back.
- Failed items show a short explanation, expandable error details, and a labelled Retry button. The Retry all toolbar shows the failed count without overlapping cards.
- Fixed failed items being counted as queued and displaying a disabled Done button.
- Automatic retries respect the Smart Retry setting and attempt limit.

Removing a queue item keeps completed media and download history. Some sources still require valid browser cookies or account access; retrying cannot supply those credentials.

## Verification

- Regression tests cover restart recovery, cancelled items, stale legacy state, and overlapping state writes.
- Local runtime checks use the real yt-dlp process: failed download to successful retry, cancellation during transfer, and removal followed by restart.
- Browser checks cover individual Retry, Retry all, persistent X removal, and compact layouts.
