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
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: #f5f5f5; color: #212529;
    }
    .card {
      background: #fff; padding: 32px; border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      width: 100%; max-width: 360px;
    }
    h1 { margin: 0 0 4px; font-size: 1.4em; }
    p.sub { margin: 0 0 24px; color: #6c757d; font-size: 0.9em; }
    label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 0.9em; }
    input {
      width: 100%; padding: 10px 12px; margin-bottom: 16px;
      border: 1px solid #ced4da; border-radius: 6px;
      font-size: 14px; box-sizing: border-box;
      background: #fff; color: #212529;
    }
    input:focus { outline: none; border-color: #4a90e2; box-shadow: 0 0 0 3px rgba(74,144,226,0.15); }
    button {
      width: 100%; padding: 11px; border: none; border-radius: 6px;
      background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
      color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
    }
    button:hover { filter: brightness(1.08); }
    .error { background: #f8d7da; color: #721c24; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 0.9em; }
    .notice { background: #fff3cd; color: #856404; padding: 12px; border-radius: 6px; font-size: 0.9em; line-height: 1.5; }
    code { background: rgba(0,0,0,0.06); padding: 2px 5px; border-radius: 4px; font-family: Consolas, Monaco, monospace; }
    @media (prefers-color-scheme: dark) {
      body { background: #11161d; color: #e6edf3; }
      .card { background: #1a212b; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
      p.sub { color: #8b949e; }
      input { background: #11161d; border-color: #30363d; color: #e6edf3; }
      .error { background: #4a1f24; color: #f5c2c7; }
      .notice { background: #4a3c1a; color: #ffe08a; }
      code { background: rgba(255,255,255,0.1); }
    }
  </style>
</head>
<body><div class="card">${inner}</div></body>
</html>`;
}

function renderLogin(error) {
  return renderShell(
    'Sign in — Bliss AutoPricer',
    `
    <h1>💰 Bliss AutoPricer</h1>
    <p class="sub">Sign in to continue</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" autofocus required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>`
  );
}

function renderSetupRequired() {
  return renderShell(
    'Setup required — Bliss AutoPricer',
    `
    <h1>🔒 Setup required</h1>
    <p class="sub">The web UI is locked until a password is set.</p>
    <div class="notice">
      This panel exposes your API keys and database password, so it will not
      serve any page without a login configured.<br><br>
      On the server, run:<br>
      <code>npm run set-password</code><br><br>
      Then restart the pricer.
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
