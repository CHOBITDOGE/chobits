const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// Replace ./service-account.json with your Firebase Service Account JSON
let admin;
try {
  admin = require('firebase-admin');
  const saPath = path.join(__dirname, 'service-account.json');
  if (!fs.existsSync(saPath)) {
    console.warn('Warning: Firebase service-account.json not found in server/. Place your Service Account JSON at server/service-account.json');
  } else {
    const serviceAccount = require(saPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) {
  console.warn('firebase-admin not initialized (missing deps or service-account). Push sending will error if attempted.');
}

const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const NOTIFICATIONS_FILE = path.join(__dirname, 'notifications.json');
const readTokens = () => {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8') || '[]'); } catch (e) { return []; }
};
const writeTokens = (arr) => fs.writeFileSync(TOKENS_FILE, JSON.stringify(Array.from(new Set(arr)), null, 2));

const readNotifications = () => {
  try { return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8') || '[]'); } catch (e) { return []; }
};
const writeNotifications = (arr) => fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(arr, null, 2));

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/register-token', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });
  const tokens = readTokens();
  tokens.push(token);
  writeTokens(tokens);
  return res.json({ ok: true, tokens: tokens.length });
});

app.post('/unregister-token', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing token' });
  const tokens = readTokens().filter(t => t !== token);
  writeTokens(tokens);
  return res.json({ ok: true });
});

app.post('/notify', async (req, res) => {
  const { title, body } = req.body || {};
  const tokens = readTokens();
  if (!admin || !admin.messaging) {
    return res.status(500).json({ error: 'firebase-admin not configured on server. Place service-account.json and install deps.' });
  }
  if (!tokens || tokens.length === 0) return res.json({ ok: true, delivered: 0 });
  const message = {
    notification: { title: title || 'Chobits', body: body || '有新的消息' },
    tokens
  };
  try {
    const resp = await admin.messaging().sendMulticast(message);
    return res.json({ ok: true, successCount: resp.successCount, failureCount: resp.failureCount, responses: resp.responses });
  } catch (e) {
    console.error('send error', e);
    return res.status(500).json({ error: e.message || e });
  }
});

app.get('/tokens', (req, res) => {
  return res.json({ tokens: readTokens() });
});

app.get('/pending-notifications', (req, res) => {
  const notifications = readNotifications();
  return res.json({ notifications });
});

app.post('/generate-notification', (req, res) => {
  const { coreMemory = '', messageType = 'greeting' } = req.body || {};
  const templates = {
    greeting: ['早上好！今天也要加油哦 😊', '嘿，早安呢！', '新的一天开始了～', '早起的小主人，早上好～'],
    meal: ['该吃饭了呢～', '主人，记得吃饭哦', '是不是该补充能量了？', '饭点到了，别忘记吃饭～'],
    mood: ['最近心情怎么样？', '在想什么呢？', '今天心情不错吧？', '有什么想和我分享的吗？'],
    activity: ['在忙什么呢？', '现在在做什么？', '最近在忙什么事呢？', '有什么需要帮助的吗？'],
    weather: ['天气不错呢', '记得看看外面呀', '今天天气怎么样？'],
    random: ['嘿，想你了～', '在吗？', '发生什么有趣的事吗？', '最近过得咋样？']
  };
  const typeTemplates = templates[messageType] || templates.random;
  const msg = typeTemplates[Math.floor(Math.random() * typeTemplates.length)];
  const notif = {
    id: Date.now().toString(),
    type: messageType,
    title: 'Chobits',
    body: msg,
    timestamp: Date.now(),
    read: false,
    memory: coreMemory ? `(来自: ${coreMemory.slice(0, 30)}...)` : ''
  };
  const notifications = readNotifications();
  notifications.push(notif);
  writeNotifications(notifications);
  
  // Also send as push if tokens exist
  const tokens = readTokens();
  if (admin && admin.messaging && tokens.length > 0) {
    admin.messaging().sendMulticast({ notification: { title: notif.title, body: notif.body }, tokens }).catch(e => console.warn('FCM send error', e));
  }
  return res.json({ ok: true, notification: notif });
});

app.post('/mark-notification-read', (req, res) => {
  const { notificationId } = req.body || {};
  const notifications = readNotifications().map(n => n.id === notificationId ? { ...n, read: true } : n);
  writeNotifications(notifications);
  return res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Chobits push server listening on ${port}`));

// Scheduled notification generator (trigger notifications every 6 hours for demo)
if (process.env.ENABLE_SCHEDULER === '1') {
  const scheduleNotifications = () => {
    const types = ['greeting', 'meal', 'mood', 'activity', 'weather'];
    const type = types[Math.floor(Math.random() * types.length)];
    console.log(`[Scheduler] Generating ${type} notification`);
    fetch(`http://localhost:${port}/generate-notification`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ messageType: type }) }).catch(()=>{});
  };
  // Uncomment to enable scheduled notifications
  // setInterval(scheduleNotifications, 6 * 60 * 60 * 1000); // every 6 hours
  console.log('Scheduler disabled. To enable, set ENABLE_SCHEDULER=1');
}
