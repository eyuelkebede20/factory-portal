'use strict';
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {}
}
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ADMIN_PASSWORD, SESSION_SECRET } = process.env;
const FACTORY_NAME = process.env.FACTORY_NAME || 'Homicho Ammunition Engineering Industry';
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'apps.json');
const CONFIRMATIONS_FILE = path.join(DATA_DIR, 'confirmations.json');
const SESSION_HOURS = 8;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Missing ADMIN_PASSWORD or SESSION_SECRET. Copy .env.example to .env and fill both.');
  process.exit(1);
}

// ---------- storage (JSON file, atomic writes) ----------
const SEED = [
  { id: 'seed-1', name: 'Intranet', url: 'http://192.168.1.10', category: 'Company', description: 'News, notices and documents', icon: '', alt: 'IN' },
  { id: 'seed-2', name: 'Clinic', url: 'http://192.168.1.20', category: 'Health', description: 'Clinic records and appointments', icon: '/logo.png', alt: 'CL' },
];
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { save(SEED); return SEED.slice(); }
}
function save(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function loadConfirmations() {
  try { return JSON.parse(fs.readFileSync(CONFIRMATIONS_FILE, 'utf8')); }
  catch { return []; }
}
function saveConfirmations(list) {
  fs.mkdirSync(path.dirname(CONFIRMATIONS_FILE), { recursive: true });
  const tmp = CONFIRMATIONS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, 500), null, 2));
  fs.renameSync(tmp, CONFIRMATIONS_FILE);
}

// ---------- settings storage ----------
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  redirectOnConfirm: true,
  redirectUrl: '',
  redirectAppName: '',
  downloadOnConfirm: false,
  downloadUrl: '/api/download/setup-pc',
  redirectDelay: 1.5
};
function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

// ---------- auth (signed cookie, no extra dependencies) ----------
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}
function isAdmin(req) {
  const m = /(?:^|;\s*)admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  return !!exp && !!sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now();
}
const requireAdmin = (req, res, next) =>
  isAdmin(req) ? next() : res.status(401).json({ error: 'Admin login required' });

// login lockout: 5 wrong tries per IP -> 5 minute wait
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000;
const fails = new Map();
function locked(ip) { const f = fails.get(ip); return f && f.n >= 5 && f.until > Date.now(); }

// Prune old lockout entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails.entries()) {
    if (f.until < now) fails.delete(ip);
  }
}, 3600 * 1000).unref();

// ---------- validation ----------
function clean(body) {
  const b = body || {};
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const app = {
    name: s(b.name, 60),
    url: s(b.url, 300),
    category: s(b.category, 40) || 'General',
    description: s(b.description, 120),
    icon: s(b.icon, 200000),
    alt: s(b.alt, 30)
  };
  if (!app.name) return { error: 'Name is required' };
  if (!/^https?:\/\/[^\s]+$/i.test(app.url)) return { error: 'Address must start with http:// or https://' };
  return { app };
}

// ---------- app ----------
const app = express();
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/session', (req, res) => res.json({ admin: isAdmin(req), factory: FACTORY_NAME }));
app.get('/api/apps', (req, res) => res.json({ apps: load() }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (locked(ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 5 minutes.' });
  if (!safeEq(req.body?.password || '', ADMIN_PASSWORD)) {
    const now = Date.now();
    const f = fails.get(ip);
    if (!f || f.until < now) {
      fails.set(ip, { n: 1, until: now + LOCKOUT_WINDOW_MS });
    } else {
      f.n += 1;
      f.until = now + LOCKOUT_WINDOW_MS;
      fails.set(ip, f);
    }
    return res.status(401).json({ error: 'Wrong password' });
  }
  fails.delete(ip);
  const secureFlag = COOKIE_SECURE ? '; Secure' : '';
  res.set('Set-Cookie', `admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secureFlag}`);
  res.json({ admin: true });
});
app.post('/api/logout', (req, res) => {
  const secureFlag = COOKIE_SECURE ? '; Secure' : '';
  res.set('Set-Cookie', `admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag}`);
  res.json({ admin: false });
});

app.post('/api/apps', requireAdmin, (req, res) => {
  const { app: a, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const list = load();
  a.id = crypto.randomUUID();
  list.push(a); save(list);
  res.status(201).json(a);
});
app.put('/api/apps/:id', requireAdmin, (req, res) => {
  const { app: a, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const list = load();
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'App not found' });
  list[i] = { ...a, id: req.params.id }; save(list);
  res.json(list[i]);
});
app.delete('/api/apps/:id', requireAdmin, (req, res) => {
  const list = load();
  const next = list.filter((x) => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'App not found' });
  save(next);
  res.json({ ok: true });
});

// ---------- startup confirmation audit API ----------
app.post('/api/confirm-startup', (req, res) => {
  const b = req.body || {};
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const entry = {
    id: crypto.randomUUID(),
    host: s(b.host, 100) || 'Unknown Workstation',
    user: s(b.user, 100) || 'Unknown User',
    ip: req.ip || req.socket?.remoteAddress || '',
    userAgent: s(req.headers['user-agent'], 200),
    timestamp: new Date().toISOString()
  };
  const list = loadConfirmations();
  list.unshift(entry);
  saveConfirmations(list);
  res.status(201).json({ ok: true, confirmed: entry });
});

app.get('/api/confirmations', requireAdmin, (req, res) => {
  res.json({ confirmations: loadConfirmations() });
});

// ---------- system update API ----------
const { spawn } = require('child_process');
const RUN_DIR = path.join(__dirname, 'run');
const UPDATE_STATUS_FILE = path.join(RUN_DIR, 'update.status');
let updateInProgress = false;

app.post('/api/system/update', requireAdmin, (req, res) => {
  if (updateInProgress) {
    return res.status(409).json({ error: 'Update is already in progress' });
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(UPDATE_STATUS_FILE, `=== Update started ===\n[${new Date().toLocaleTimeString()}] Triggered by admin\n`);
  updateInProgress = true;

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'bash';
  const args = isWin ? ['/c', 'deploy\\update.bat'] : ['deploy/update.sh'];

  try {
    const proc = spawn(cmd, args, {
      cwd: __dirname,
      detached: true,
      windowsHide: true
    });

    proc.stdout.on('data', (d) => fs.appendFileSync(UPDATE_STATUS_FILE, d));
    proc.stderr.on('data', (d) => fs.appendFileSync(UPDATE_STATUS_FILE, d));
    proc.on('close', (code) => {
      updateInProgress = false;
      fs.appendFileSync(UPDATE_STATUS_FILE, `\n[${new Date().toLocaleTimeString()}] Process exited with code ${code}\n`);
      if (code === 0) {
        fs.appendFileSync(UPDATE_STATUS_FILE, "✓. Update complete\n");
      } else {
        fs.appendFileSync(UPDATE_STATUS_FILE, "!! Update failed\n");
      }
    });
    proc.unref();
    res.json({ ok: true, message: 'Update process started' });
  } catch (err) {
    updateInProgress = false;
    fs.appendFileSync(UPDATE_STATUS_FILE, `\nFailed to start update script: ${err.message}\n!! Update failed\n`);
    res.status(500).json({ error: `Failed to launch update script: ${err.message}` });
  }
});

app.get('/api/system/update-status', requireAdmin, (req, res) => {
  if (!fs.existsSync(UPDATE_STATUS_FILE)) {
    return res.json({ lines: [], done: false, failed: false });
  }
  try {
    const raw = fs.readFileSync(UPDATE_STATUS_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const failed = lines.some(l => l.includes('Update failed') || l.includes('Rollback complete') || (l.includes('Process exited with code') && !l.includes('code 0')));
    const done = lines.some(l => l.includes('Update complete') || l.includes('✓. Update complete')) || failed;
    res.json({ lines, done, failed });
  } catch {
    res.json({ lines: [], done: false, failed: false });
  }
});

// ---------- settings API ----------
app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  const apps = load();
  let effectiveRedirectUrl = settings.redirectUrl;
  let effectiveAppName = settings.redirectAppName;
  if (!effectiveRedirectUrl && apps.length > 0) {
    effectiveRedirectUrl = apps[0].url;
    effectiveAppName = apps[0].name;
  }
  res.json({
    ...settings,
    effectiveRedirectUrl,
    effectiveAppName,
    factory: FACTORY_NAME
  });
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const current = loadSettings();
  const next = {
    ...current,
    redirectOnConfirm: b.redirectOnConfirm !== undefined ? Boolean(b.redirectOnConfirm) : current.redirectOnConfirm,
    redirectUrl: s(b.redirectUrl, 300),
    redirectAppName: s(b.redirectAppName, 100),
    downloadOnConfirm: b.downloadOnConfirm !== undefined ? Boolean(b.downloadOnConfirm) : current.downloadOnConfirm,
    downloadUrl: s(b.downloadUrl, 500) || '/api/download/setup-pc',
    redirectDelay: Math.max(0.5, Math.min(10, Number(b.redirectDelay) || 1.5))
  };
  saveSettings(next);
  res.json(next);
});

// ---------- workstation setup script download ----------
app.get(['/api/download/setup-pc', '/setup.bat', '/startup.bat', '/install.bat'], (req, res) => {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  const portalUrl = `${protocol}://${host}`;

  const batContent = `@echo off
setlocal EnableDelayedExpansion
title Workstation Startup Installer - ${FACTORY_NAME}
echo =====================================================================
echo    ${FACTORY_NAME} - Workstation Setup
echo =====================================================================
echo.
echo Installing automated startup launcher for Factory Portal...
echo Target Server: ${portalUrl}
echo.

set "INSTALL_DIR=C:\\ProgramData\\FactoryPortal"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Write open-portal.ps1
(
echo # Opens the portal in the default browser at every user startup/login with startup confirmation.
echo param([string]$Url = "${portalUrl}"^)
echo.
echo # 1. Wait up to 30 seconds for the network ^& portal to become responsive
echo $maxAttempts = 15
echo $portalReady = $false
echo for ($i = 0; $i -lt $maxAttempts; $i++^) {
echo     try {
echo         $res = Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
echo         if ($res.StatusCode -eq 200^) { $portalReady = $true; break }
echo     } catch {}
echo     Start-Sleep -Seconds 2
echo }
echo.
echo # 2. Append ?startup=1 and workstation identity parameters
echo $hostParam = [System.Uri]::EscapeDataString($env:COMPUTERNAME^)
echo $userParam = [System.Uri]::EscapeDataString($env:USERNAME^)
echo $sep = if ($Url -match "\\?"^) { "^&" } else { "?" }
echo $targetUrl = "\${Url}\${sep}startup=1^&host=\${hostParam}^&user=\${userParam}"
echo.
echo # 3. Launch the portal in the default browser
echo $process = Start-Process $targetUrl -PassThru -ErrorAction SilentlyContinue
echo.
echo # 4. Confirm with the browser: ensure browser process is active
echo Start-Sleep -Seconds 3
echo $browserConfirmed = $false
echo if ($process -and (-not $process.HasExited^)^) {
echo     $browserConfirmed = $true
echo } else {
echo     $activeBrowsers = Get-Process msedge, chrome, firefox, brave, opera -ErrorAction SilentlyContinue
echo     if ($activeBrowsers^) { $browserConfirmed = $true }
echo }
echo.
echo # 5. Record confirmed launch log
echo $logDir = Join-Path $env:LOCALAPPDATA "FactoryPortal"
echo if (-not (Test-Path $logDir^)^) { New-Item -ItemType Directory -Path $logDir -Force ^| Out-Null }
echo $logFile = Join-Path $logDir "startup-launch.log"
echo $timestamp = (Get-Date^).ToString("yyyy-MM-dd HH:mm:ss"^)
echo $status = if ($browserConfirmed^) { "CONFIRMED_OPENED" } else { "LAUNCH_ATTEMPTED" }
echo Add-Content -Path $logFile -Value "[\$timestamp] Portal: \$targetUrl ^| Status: \$status ^| PortalReady: \$portalReady"
) > "%INSTALL_DIR%\\open-portal.ps1"

:: Create Startup Shortcut for All Users
powershell.exe -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; $startup = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp'; $lnk = $sh.CreateShortcut(\\"$startup\\Factory Portal.lnk\\"); $lnk.TargetPath = 'powershell.exe'; $lnk.Arguments = '-WindowStyle Hidden -ExecutionPolicy Bypass -File \\\"C:\\ProgramData\\FactoryPortal\\open-portal.ps1\\\" -Url \\\"${portalUrl}\\\"'; $lnk.WindowStyle = 7; $lnk.Save()" 2>nul

if errorlevel 1 (
    echo [NOTE] Elevated permissions not detected. Creating shortcut for current user...
    powershell.exe -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $lnk = $sh.CreateShortcut(\\"$startup\\Factory Portal.lnk\\"); $lnk.TargetPath = 'powershell.exe'; $lnk.Arguments = '-WindowStyle Hidden -ExecutionPolicy Bypass -File \\\"C:\\ProgramData\\FactoryPortal\\open-portal.ps1\\\" -Url \\\"${portalUrl}\\\"'; $lnk.WindowStyle = 7; $lnk.Save()"
)

echo.
echo =====================================================================
echo    SUCCESS! Workstation setup complete.
echo    Factory Portal will automatically open on every login/startup.
echo =====================================================================
echo.
echo Launching Factory Portal now to test...
start "" "${portalUrl}?startup=1"
timeout /t 5 >nul
`;

  res.set({
    'Content-Type': 'application/x-bat',
    'Content-Disposition': 'attachment; filename="setup-workstation.bat"'
  });
  res.send(batContent);
});

app.get(['/api/download/open-portal', '/open.bat'], (req, res) => {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  const portalUrl = `${protocol}://${host}`;
  const content = `@echo off
setlocal EnableDelayedExpansion
title Launch Factory Portal - ${FACTORY_NAME}
set "PORTAL_URL=${portalUrl}"
set "TARGET_URL=%PORTAL_URL%?startup=1&host=%COMPUTERNAME%&user=%USERNAME%"
echo =====================================================================
echo    ${FACTORY_NAME} Portal Launcher
echo =====================================================================
echo.
echo Opening browser to: %TARGET_URL%
echo.
start "" "%TARGET_URL%"
timeout /t 2 >nul
`;
  res.set({
    'Content-Type': 'application/x-bat',
    'Content-Disposition': 'attachment; filename="open-portal.bat"'
  });
  res.send(content);
});

app.get('/healthz', (req, res) => res.send('ok'));
if (require.main === module) {
  app.listen(PORT, () => console.log(`${FACTORY_NAME} portal listening on :${PORT}`));
}
module.exports = app;
