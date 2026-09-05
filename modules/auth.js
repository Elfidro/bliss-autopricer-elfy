// auth.js — session login for the PriceWatcher web UI.
//
// The web UI renders API keys and the database password into /settings, so it
// must never be served unauthenticated. This gates every route behind a login
// and fails closed: if no password is configured, the UI serves a setup notice
// instead of the panel.
//
// No new dependencies — sessions are in-memory, cookies are parsed by hand and
// passwords are hashed with Node's built-in scrypt.

const crypto = require('crypto');

const COOKIE_NAME = 'bliss_session';
const DEFAULT_SESSION_HOURS = 12;

// Failed-login throttling, per IP.
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const sessions = new Map(); // token -> expiresAt (epoch ms)
const attempts = new Map(); // ip -> { count, lockedUntil }

function parseCookies(header) {
  const out = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') {
    return false;
  }
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) {
    return false;
  }
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, 64).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// Compare without leaking length or content through timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function pruneSessions(now) {
  for (const [token, expiresAt] of sessions) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function createSession(sessionHours) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + sessionHours * 3600 * 1000);
  return token;
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function isLockedOut(ip, now) {
  const record = attempts.get(ip);
  return Boolean(record && record.lockedUntil > now);
}

function recordFailure(ip, now) {
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.count = 0;
  }
  attempts.set(ip, record);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function renderShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b0f17;
      --card-bg: #111827;
      --border: #222e42;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --input-bg: #151d2e;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --accent: #0284c7;
        --primary: #0284c7;
        --primary-hover: #0369a1;
        --input-bg: #f1f5f9;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg);
      background-image: radial-gradient(circle at top center, rgba(56, 189, 248, 0.08), transparent 70%);
      color: var(--text);
      padding: 20px;
    }
    .card {
      background: var(--card-bg);
      padding: 36px 32px;
      border-radius: 16px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
      width: 100%; max-width: 400px;
      position: relative;
    }
    .card-brand {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 1.25rem; font-weight: 800; margin-bottom: 6px;
      letter-spacing: -0.02em; color: var(--text);
    }
    .card-badge {
      font-size: 0.72rem; padding: 2px 7px; border-radius: 999px;
      background: rgba(56, 189, 248, 0.15); color: var(--accent);
      font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.3);
    }
    p.sub { margin: 0 0 24px; color: var(--text-muted); font-size: 0.92rem; }
    label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 0.88rem; color: var(--text); }
    input {
      width: 100%; padding: 11px 14px; margin-bottom: 18px;
      border: 1px solid var(--border); border-radius: 8px;
      font-size: 14px; font-family: inherit;
      background: var(--input-bg); color: var(--text);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }
    button {
      width: 100%; padding: 12px; border: none; border-radius: 8px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
      color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      transition: all 0.15s ease;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    button:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(2, 132, 199, 0.45);
    }
    button:active { transform: translateY(0); }
    .error {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 12px 14px; border-radius: 8px; margin-bottom: 18px;
      font-size: 0.88rem; font-weight: 500;
      display: flex; align-items: center; gap: 8px;
    }
    .notice {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fcd34d;
      padding: 14px; border-radius: 8px; font-size: 0.9rem; line-height: 1.55;
    }
    code {
      background: rgba(255, 255, 255, 0.08);
      padding: 3px 6px; border-radius: 5px;
      font-family: var(--font-mono); font-size: 0.88em;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div class="card">
    ${inner}
  </div>
</body>
</html>`;
}

function renderLogin(error) {
  return renderShell(
    'Sign in — Bliss AutoPricer',
    `
    <div class="card-brand">
      <span>💰</span> Bliss AutoPricer <span class="card-badge">v2.0</span>
    </div>
    <p class="sub">Sign in to manage your trading bots</p>
    ${error ? `<div class="error"><span>⚠️</span> ${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" placeholder="e.g. admin" autofocus required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
      <button type="submit"><span>🔐</span> Sign In</button>
    </form>`
  );
}

function renderSetupRequired() {
  return renderShell(
    'Setup Required — Bliss AutoPricer',
    `
    <div class="card-brand">
      <span>🔒</span> Setup Required
    </div>
    <p class="sub">The web UI is locked until a password is set.</p>
    <div class="notice">
      This panel exposes your API keys and database password, so it will not
      serve any page without a login configured.<br><br>
      On the server terminal, run:<br>
      <code>npm run set-password</code><br><br>
      Then restart the pricer process.
    </div>`
  );
}

/**
 * Build the auth middleware.
 *
 * Reads webAuth from the main config:
 *   webAuth: { enabled, username, passwordHash, sessionHours }
 *
 * Returns an Express middleware that must be mounted before any routes.
 */
function createAuthMiddleware(webAuth = {}) {
  const enabled = webAuth.enabled !== false;
  const username = webAuth.username || 'admin';
  const passwordHash = webAuth.passwordHash;
  const sessionHours = Number(webAuth.sessionHours) || DEFAULT_SESSION_HOURS;

  if (!enabled) {
    console.warn(
      '⚠️  webAuth.enabled is false — the web UI is UNAUTHENTICATED. ' +
        'Anyone who can reach this port can read your API keys via /settings.'
    );
    return (req, res, next) => next();
  }

  const configured = Boolean(passwordHash);
  if (!configured) {
    console.error('🔒 No webAuth.passwordHash set — web UI locked. Run: npm run set-password');
  }

  return function authMiddleware(req, res, next) {
    const now = Date.now();

    // Fail closed when no password has been configured.
    if (!configured) {
      return res.status(503).send(renderSetupRequired());
    }

    if (req.path === '/logout') {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (token) {
        sessions.delete(token);
      }
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return res.redirect('/login');
    }

    if (req.path === '/login') {
      if (req.method === 'GET') {
        return res.send(renderLogin(null));
      }
      if (req.method === 'POST') {
        const ip = clientIp(req);
        if (isLockedOut(ip, now)) {
          return res.status(429).send(renderLogin('Too many attempts. Try again in 15 minutes.'));
        }
        const okUser = safeEqual(req.body?.username || '', username);
        const okPass = verifyPassword(req.body?.password || '', passwordHash);
        if (okUser && okPass) {
          attempts.delete(ip);
          pruneSessions(now);
          const token = createSession(sessionHours);
          res.setHeader(
            'Set-Cookie',
            `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionHours * 3600}`
          );
          return res.redirect('/');
        }
        recordFailure(ip, now);
        console.warn(`Failed login attempt from ${ip}`);
        return res.status(401).send(renderLogin('Incorrect username or password.'));
      }
    }

    // Everything else requires a live session.
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const expiresAt = token ? sessions.get(token) : undefined;
    if (expiresAt && expiresAt > now) {
      return next();
    }
    if (token) {
      sessions.delete(token);
    }
    return res.redirect('/login');
  };
}

module.exports = { createAuthMiddleware, hashPassword, verifyPassword };
