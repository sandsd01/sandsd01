# Privacy Notice (draft)

This is a starting draft for the PDPA-facing privacy policy required before
requesting Google OAuth verification (spec section 3 and 10). Have this
reviewed before publishing — it is not legal advice.

## What the relay server stores

- Account identity: Google account id, email, display name, avatar URL.
- An **encrypted** Google OAuth refresh token, used only to obtain short-lived
  access tokens for reading/writing files this app itself created in your
  Google Drive.
- Conversation metadata: which two accounts are in a conversation, a short
  preview of the latest message, and timestamps. This is index data used to
  render your conversation list — it is not a copy of your message content.
- A short-lived sync buffer (`pending_sync_messages`) holding a message just
  long enough to relay it in real time and write it into both participants'
  Drive folders. Rows are not treated as permanent storage.

## What the relay server does NOT store permanently

- Message text and file contents. These are written to a JSON transcript
  file (`conv_<id>.json`) and an `attachments/` folder inside a
  `ChatApp_ChatData` folder created in **your own** Google Drive, using the
  restricted `drive.file` OAuth scope — the app can only see files it
  created itself, never the rest of your Drive.

## Revoking access

You can revoke this app's Google Drive access at any time from
https://myaccount.google.com/permissions. Once revoked, the background sync
worker will fail for your account and you'll be prompted to reconnect the
next time you sign in; the app degrades gracefully rather than losing
already-relayed messages (the recipient's own transcript is unaffected).

## Data sharing

File attachments are shared read-only with the specific recipient's Google
account via Drive's native sharing (`permissions.create`), not made public.
No data is sold or shared with third parties beyond Google Drive/OAuth
infrastructure required to operate the app.
