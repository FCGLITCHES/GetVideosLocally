# GetVideosLocally v3.2.9

## Fixed: downloads failing with "incorrect header check"

- A download could fail with "Error -3 while decompressing data: incorrect header check" if the automatic yt-dlp update ran while that download was still going.
- Tool updates now wait until every running download has finished, and new downloads wait until the update is done.
- Pressing Update Tools during a download now tells you to wait, instead of interrupting the download.

## Diagnostics bundle that explains the problem

- Generate Diagnostics Bundle now produces a full report instead of just version numbers.
- It lists every problem it finds, most serious first. Each one comes with the evidence from the logs, the likely cause and what to try.
- Each failed download gets its own section: the error, a timeline of what happened, any tool update that overlapped it, yt-dlp's warnings, and the exact command needed to reproduce it.
- It also checks tools, the YouTube JavaScript runtime, cookies (names and expiry dates only), disk space, folder permissions, network reachability, recurring errors and recent UI errors.
- Cookie values, tokens, signed media links, email addresses and your Windows user folder name are removed from the report.

## Updates no longer get in the way

- While a tool update is waiting or installing, the status pill says so, and a download that is held says "Waiting for the yt-dlp update, starts right after" instead of looking stuck.
- Updates are downloaded and checked in a staging folder first. If the new version fails to start, the previous version is restored automatically.
- If a download still fails because a tool changed underneath it, the error is now marked as retryable, and Retry works straight away.
- FFmpeg 9.0.2 is now a recognised, checksum-verified update.

## Cookie expiry warning

- When the YouTube cookies you imported have expired or are about to expire, the app warns you and offers "Import fresh cookies", so age-restricted and members-only videos keep working.

## Report a problem

- Settings > Diagnostics has a new Report button, and failed downloads offer "Report this problem".
- Describe what happened, optionally add an email address for a reply, and send it from inside the app.
- Diagnostics are only attached if you tick the box, every time. "Save a copy" shows you exactly what would be sent.

## Downloads

Use the Windows installer to update an existing installation, or extract the portable ZIP and run GetVideosLocally.exe.

Completed downloads, history, and settings are preserved when upgrading.
