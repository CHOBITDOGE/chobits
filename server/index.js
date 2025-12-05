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
const readTokens = () => {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8') || '[]'); } catch (e) { return []; }
};
const writeTokens = (arr) => fs.writeFileSync(TOKENS_FILE, JSON.stringify(Array.from(new Set(arr)), null, 2));

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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Chobits push server listening on ${port}`));
