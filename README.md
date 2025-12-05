# chobits

## Mobile (Android) build & push notifications

This project includes a minimal implementation to run as a mobile app (Android) using Capacitor and a simple backend to send FCM push notifications.

Summary of what was added:
- `server/` - minimal Express server that accepts device tokens and can send FCM push messages using `firebase-admin`.
- Frontend: `src/App.tsx` now attempts to register for push notifications via Capacitor when the user enables "主动互动" (Proactive) in the UI. The app will POST the device token to the server at `/register-token`.

Quick local setup (Android)
1. In the repo root, install Capacitor and plugins locally (run on your development machine):

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/push-notifications @capacitor/local-notifications
npm run build
npx cap init chobits com.example.chobits --web-dir=dist
npx cap add android
npx cap sync
npx cap open android
```

2. Configure Firebase on the server:
 - Create a Firebase project in the Firebase Console.
 - Generate a Service Account JSON (Project Settings → Service accounts → Generate new private key).
 - Save the file to `server/service-account.json`.

3. Install server deps and start server:

```bash
cd server
npm install
npm start
```

4. Provide the server URL to the app when building (if not `http://localhost:3000`), set env var `VITE_PUSH_SERVER` when building the web assets.

Exchanging the Firebase credentials (how to replace):
- Put your downloaded Service Account JSON at `server/service-account.json` (replace the example file if present).
- Restart the server (`server/npm start`). The server will use `firebase-admin` to send pushes via FCM.

How proactive pushes work
- The app registers for push and sends its token to `POST /register-token`.
- The server keeps tokens in `server/tokens.json` and will call FCM when `POST /notify` is invoked.
- You can test by calling `POST /notify` with JSON `{ "title": "测试", "body": "这是来自助手的主动提醒" }`.

Security note
- Keep your `service-account.json` secret. Do not commit it to the repository. Use environment-specific secrets in production (host the server on a platform and set credentials there).
