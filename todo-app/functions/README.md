# Firebase reminder scheduler (FCM)

This function sends push notifications **15 minutes before** appointments (with a valid date + time) for users who registered at least one notification token.

## What it reads
- `users/{uid}/todo/appointments` (array field: `tasks`)
- `users/{uid}/notificationTokens/{tokenDoc}`

## What it writes
- `users/{uid}/reminderDispatch/{dispatchId}`
  - prevents duplicate sends for the same appointment/time window

## Deploy
1. Install Firebase CLI (once):
   - `npm i -g firebase-tools`
2. Login:
   - `firebase login`
3. From project root (`TODO app`), install function deps:
   - `cd functions`
   - `npm install`
4. Back to root:
   - `cd ..`
5. Deploy function:
   - `firebase deploy --only functions`

## Test-only push function (immediate)
This function sends a push instantly to all tokens under `users/{uid}/notificationTokens`.

- Function name: `sendTestPush`
- Method: `GET` or `POST`
- Required param: `userId`
- Optional params: `title`, `body`, `secret`

Example URL (after deploy):

`https://us-central1-appointment-a11f2.cloudfunctions.net/sendTestPush?userId=YOUR_UID&title=Test%20Alert&body=Push%20works`

If you set `TEST_PUSH_SECRET`, include `&secret=YOUR_SECRET` in the URL.

## Optional environment variable
Set app link in notification click action:
- `APP_URL` defaults to `http://localhost:5500`
- To set a production URL, use runtime config/secrets approach and update `functions/index.js` accordingly.

Optional security for test function:
- `TEST_PUSH_SECRET` (recommended)

## Firestore rules requirement
Allow users to read/write their own token docs:
- `users/{uid}/notificationTokens/{tokenId}`
Allow backend service account access (default for Cloud Functions Admin SDK).
