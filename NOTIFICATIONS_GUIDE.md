# Proactive Notifications Guide

## Overview

The Chobits mobile/web app now supports **contextual proactive notifications** - the assistant can reach out to the user with:
- Daily greetings and reminders
- Meal time prompts ("吃饭了吗？")
- Mood and activity check-ins ("心情咋样？", "在忙什么？")
- Weather updates
- Custom messages based on core memory associations

All notifications are synced between web and mobile clients for a consistent experience.

## Backend Notification Generation

### Endpoints

#### `POST /generate-notification`
Generate a single contextual notification and queue it for delivery.

**Request body:**
```json
{
  "messageType": "greeting|meal|mood|activity|weather|random",
  "coreMemory": "optional core memory context"
}
```

**Response:**
```json
{
  "ok": true,
  "notification": {
    "id": "1733390400000",
    "type": "greeting",
    "title": "Chobits",
    "body": "早上好！今天也要加油哦 😊",
    "timestamp": 1733390400000,
    "read": false
  }
}
```

**Message Templates by Type:**
- `greeting`: ["早上好！今天也要加油哦 😊", "嘿，早安呢！", "新的一天开始了～", "早起的小主人，早上好～"]
- `meal`: ["该吃饭了呢～", "主人，记得吃饭哦", "是不是该补充能量了？", "饭点到了，别忘记吃饭～"]
- `mood`: ["最近心情怎么样？", "在想什么呢？", "今天心情不错吧？", "有什么想和我分享的吗？"]
- `activity`: ["在忙什么呢？", "现在在做什么？", "最近在忙什么事呢？", "有什么需要帮助的吗？"]
- `weather`: ["天气不错呢", "记得看看外面呀", "今天天气怎么样？"]
- `random`: ["嘿，想你了～", "在吗？", "发生什么有趣的事吗？", "最近过得咋样？"]

#### `GET /pending-notifications`
Retrieve all queued notifications (unread and read).

**Response:**
```json
{
  "notifications": [
    {
      "id": "1733390400000",
      "type": "greeting",
      "title": "Chobits",
      "body": "早上好！",
      "timestamp": 1733390400000,
      "read": false,
      "memory": ""
    }
  ]
}
```

#### `POST /mark-notification-read`
Mark a notification as read (prevents re-syncing).

**Request body:**
```json
{
  "notificationId": "1733390400000"
}
```

### Scheduler (Optional)

To enable **automatic scheduled notifications** (every 6 hours), start the server with:
```bash
ENABLE_SCHEDULER=1 npm start
```

The scheduler will randomly select a notification type and call `/generate-notification` at the configured interval.

## Frontend Integration

### User Flow

1. **Enable Proactive Mode**: User toggles "允许助手主动互动" in settings or clicks the header button.
2. **Push Registration**: The app requests permission and registers device token with the server.
3. **Notification Sync**: Every 60 seconds, the frontend fetches pending notifications from `/pending-notifications`.
4. **Display & Persist**: Unread notifications are added to the chat UI and stored in IndexedDB.
5. **Mark Read**: Once displayed, the notification is marked as read on the backend.

### Web-Mobile Sync

- **Server as Source of Truth**: All notifications are persisted on the server (`server/notifications.json`).
- **Client-side Queue**: The frontend maintains a local copy in IndexedDB (`STORES.NOTIFICATIONS`).
- **Periodic Sync**: Both web and mobile clients sync every 60 seconds via `GET /pending-notifications`.
- **Consistent State**: Users see the same notifications on web and mobile, preventing duplicates.

### LocalStorage & IndexedDB

- **`chobits_proactive`**: Flag indicating if proactive mode is enabled.
- **`chobits_push_token`**: Device's FCM push token (mobile only).
- **`STORES.NOTIFICATIONS`**: IndexedDB store for persisted notifications.

## Testing Locally

### 1. Start Server

```bash
cd server
npm install
npm start
```

Server runs on `http://localhost:3000` by default.

### 2. Generate a Test Notification

```bash
curl -X POST http://localhost:3000/generate-notification \
  -H "Content-Type: application/json" \
  -d '{"messageType": "greeting", "coreMemory": "用户喜欢早晨运动"}'
```

### 3. Fetch Pending Notifications

```bash
curl http://localhost:3000/pending-notifications
```

### 4. Mark Notification Read

```bash
curl -X POST http://localhost:3000/mark-notification-read \
  -H "Content-Type: application/json" \
  -d '{"notificationId": "1733390400000"}'
```

### 5. Enable Scheduler (Optional)

```bash
ENABLE_SCHEDULER=1 npm start
```

This will auto-generate a random notification type every 6 hours.

## Production Deployment

### Security & Persistence

1. **Protect `service-account.json`**: Never commit Firebase credentials. Use environment variables:
   ```bash
   export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
   node -e "require('fs').writeFileSync('./server/service-account.json', process.env.FIREBASE_SERVICE_ACCOUNT)"
   npm start
   ```

2. **Use a Real Database**: Replace `server/tokens.json` and `server/notifications.json` with a database (PostgreSQL, MongoDB, etc.) for scalability.

3. **Authentication**: Add user associations to prevent one user's notifications from leaking to others.

4. **Rate Limiting**: Add rate limiting to `/generate-notification` to prevent spam.

### Deployment Steps

1. Deploy server to a cloud platform (Heroku, AWS, GCP, Vercel serverless).
2. Update `VITE_PUSH_SERVER` environment variable during web build to point to your server.
3. Build and deploy mobile app (Android APK to Play Store or internally).
4. Configure FCM in Firebase Console and ensure your server has valid Service Account credentials.

## Advanced: Integrating with Assistant Logic

To make the assistant **actively decide** when to send notifications:

1. Add an endpoint `/should-notify` that queries the chat history and core memory.
2. Use your LLM to generate a contextual notification message.
3. Call `/generate-notification` with the LLM-generated message.

Example backend logic:
```javascript
app.post('/should-notify', async (req, res) => {
  const { chatHistory, coreMemory } = req.body;
  // Query LLM: "Based on this conversation and memory, should I notify the user? What should I say?"
  const shouldNotify = await callLLM(chatHistory, coreMemory);
  if (shouldNotify.message) {
    await fetch('http://localhost:3000/generate-notification', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ messageType: 'random', coreMemory: shouldNotify.reason })
    });
  }
  res.json({ ok: true });
});
```

