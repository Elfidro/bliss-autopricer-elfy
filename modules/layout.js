// layout.js
module.exports = function renderPage(title, bodyContent) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <script>
      // Applied before first paint so the page never flashes light then dark.
      (function () {
        try {
          var saved = localStorage.getItem('bliss-theme');
          var dark = saved
            ? saved === 'dark'
            : window.matchMedia('(prefers-color-scheme: dark)').matches;
          document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        } catch (e) {
          document.documentElement.setAttribute('data-theme', 'light');
        }
      })();
    </script>
    <style>
      :root {
        --bg: #f5f5f5;
        --surface: #ffffff;
        --surface-alt: #f8f9fa;
        --text: #212529;
        --text-muted: #6c757d;
        --border: #e9ecef;
        --border-strong: #ced4da;
        --accent: #4a90e2;
        --accent-strong: #357abd;
        --shadow: rgba(0, 0, 0, 0.1);
        --shadow-strong: rgba(0, 0, 0, 0.15);

        --warn-bg: #fff3cd;      --warn-text: #856404;
        --danger-bg: #f8d7da;    --danger-text: #721c24;
        --ok-bg: #d4edda;        --ok-text: #155724;
        --info-bg: #e8f4fd;      --info-text: #0c5460;
      }

      html[data-theme="dark"] {
        --bg: #11161d;
        --surface: #1a212b;
        --surface-alt: #212a36;
        --text: #e6edf3;
        --text-muted: #8b949e;
        --border: #30363d;
        --border-strong: #3d444d;
        --accent: #58a6ff;
        --accent-strong: #1f6feb;
        --shadow: rgba(0, 0, 0, 0.4);
        --shadow-strong: rgba(0, 0, 0, 0.6);

        --warn-bg: #3d3116;      --warn-text: #ffd970;
        --danger-bg: #45191d;    --danger-text: #ff9ea6;
        --ok-bg: #14301f;        --ok-text: #7ee2a8;
        --info-bg: #12293d;      --info-text: #79c0ff;
      }

      html[data-theme="dark"] {
        color-scheme: dark;
      }

      * {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 0;
        background-color: var(--bg);
        color: var(--text);
        padding-top: 80px; /* Account for fixed header */
        transition: background-color 0.2s ease, color 0.2s ease;
      }

      /* Modern Navigation Header */
      nav {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
        color: #fff;
        padding: 15px 0;
        box-shadow: 0 2px 10px var(--shadow);
        z-index: 1000;
        border-bottom: 3px solid var(--accent-strong);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .nav-container {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .nav-brand {
        font-size: 1.5em;
        font-weight: bold;
        color: #fff;
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .nav-links {
        display: flex;
        gap: 5px;
        align-items: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      nav a {
        color: #fff;
        text-decoration: none;
        padding: 10px 16px;
        border-radius: 8px;
        transition: all 0.3s ease;
        font-weight: 500;
        position: relative;
        overflow: hidden;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      nav a:hover {
        background: rgba(255,255,255,0.15);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }

      nav a:active {
        transform: translateY(0);
      }

      /* Bot config button - no special styling, same as other nav items */
      nav a[href="/bot-config"] {
        margin-left: 10px;
      }

      /* Theme toggle */
      #theme-toggle {
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        color: #fff;
        font-size: 1.05em;
        line-height: 1;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      #theme-toggle:hover {
        background: rgba(255,255,255,0.28);
        transform: translateY(-1px);
      }

      /* Main content container */
      .container {
        margin: 20px;
        padding: 20px;
        background: var(--surface);
        color: var(--text);
        border-radius: 12px;
        box-shadow: 0 4px 6px var(--shadow);
        min-height: calc(100vh - 120px);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      /* Console/Pre styling */
      pre {
        background: #1a202c;
        color: #68d391;
        padding: 20px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        overflow-x: auto;
        max-height: 80vh;
        border-radius: 8px;
        border: 1px solid #2d3748;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
      }

      .controls {
        margin-bottom: 20px;
        padding: 20px;
        background: var(--surface-alt);
        border-radius: 8px;
        border: 1px solid var(--border);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .controls input[type=text] {
        padding: 10px 12px;
        width: 200px;
        margin-right: 10px;
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.3s ease;
        background: var(--surface);
        color: var(--text);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .controls input[type=text]:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.15);
      }

      .controls label {
        margin-right: 15px;
        font-weight: 500;
        color: var(--text-muted);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      /* Form controls elsewhere in the app */
      input, select, textarea {
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: 6px;
      }

      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--accent);
      }

      #queue-panel {
        position: fixed;
        top: 100px;
        right: 20px;
        width: 280px;
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 20px;
        max-height: 80vh;
        overflow: auto;
        box-shadow: 0 4px 12px var(--shadow-strong);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .chart-fullscreen {
        position: absolute;
        top: 80px; /* Account for new nav height */
        left: 0;
        right: 0;
        bottom: 0;
        padding: 20px;
        background: var(--surface);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      canvas#profitOverTime {
        width: 100% !important;
        height: 100% !important;
        display: block;
      }

      /* Enhanced Table Styling */
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 30px;
        background: var(--surface);
        color: var(--text);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 4px var(--shadow);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      th, td {
        border: none;
        border-bottom: 1px solid var(--border);
        padding: 12px 16px;
        text-align: left;
        vertical-align: middle;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      th {
        background: var(--surface-alt);
        font-weight: 600;
        color: var(--text-muted);
        border-bottom: 2px solid var(--border-strong);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      tr:hover {
        background: var(--surface-alt);
      }

      button {
        cursor: pointer;
        border: 1px solid var(--border-strong);
        background: var(--surface);
        color: var(--text);
        font-size: 14px;
        padding: 6px 12px;
        border-radius: 6px;
        transition: all 0.2s ease;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      button:hover {
        background: var(--surface-alt);
        border-color: var(--border-strong);
      }

      a { color: var(--accent); }

      /* Status indicators with modern colors */
      .outdated-2h { background: var(--warn-bg); border-left: 4px solid #ffc107; }
      .outdated-1d { background: var(--warn-bg); border-left: 4px solid #f39c12; }
      .outdated-2d { background: var(--danger-bg); border-left: 4px solid #e74c3c; }
      .current-row { background: var(--ok-bg); border-left: 4px solid #28a745; }

      html[data-theme="dark"] .outdated-2h,
      html[data-theme="dark"] .outdated-1d,
      html[data-theme="dark"] .outdated-2d,
      html[data-theme="dark"] .current-row { color: var(--text); }

      /*
        Route templates hard-code colours in inline style attributes, which CSS
        variables cannot reach. These override the values actually used across
        modules/routes/*.js. Both spacing variants are listed because the source
        mixes "color:#666" and "color: #666".
      */
      html[data-theme="dark"] [style*="color:#666"],
      html[data-theme="dark"] [style*="color: #666"],
      html[data-theme="dark"] [style*="color:#495057"],
      html[data-theme="dark"] [style*="color: #495057"],
      html[data-theme="dark"] [style*="color:#6c757d"],
      html[data-theme="dark"] [style*="color: #6c757d"] { color: var(--text-muted) !important; }

      html[data-theme="dark"] [style*="color:#333"],
      html[data-theme="dark"] [style*="color: #333"],
      html[data-theme="dark"] [style*="color:#000"],
      html[data-theme="dark"] [style*="color: #000"] { color: var(--text) !important; }

      html[data-theme="dark"] [style*="color:#007cba"],
      html[data-theme="dark"] [style*="color: #007cba"] { color: var(--accent) !important; }

      html[data-theme="dark"] [style*="background:#f8f9fa"],
      html[data-theme="dark"] [style*="background: #f8f9fa"],
      html[data-theme="dark"] [style*="background:#f5f5f5"],
      html[data-theme="dark"] [style*="background: #f5f5f5"],
      html[data-theme="dark"] [style*="background:#e9ecef"],
      html[data-theme="dark"] [style*="background: #e9ecef"],
      html[data-theme="dark"] [style*="background:white"],
      html[data-theme="dark"] [style*="background: white"],
      html[data-theme="dark"] [style*="background:#fff;"],
      html[data-theme="dark"] [style*="background: #fff;"],
      html[data-theme="dark"] [style*="background-color:#f8f9fa"],
      html[data-theme="dark"] [style*="background-color: #f8f9fa"] {
        background: var(--surface-alt) !important;
        color: var(--text);
      }

      html[data-theme="dark"] [style*="background:#fff3cd"],
      html[data-theme="dark"] [style*="background: #fff3cd"] {
        background: var(--warn-bg) !important; color: var(--warn-text) !important;
      }

      html[data-theme="dark"] [style*="background:#f8d7da"],
      html[data-theme="dark"] [style*="background: #f8d7da"] {
        background: var(--danger-bg) !important; color: var(--danger-text) !important;
      }

      html[data-theme="dark"] [style*="background:#d4edda"],
      html[data-theme="dark"] [style*="background: #d4edda"] {
        background: var(--ok-bg) !important; color: var(--ok-text) !important;
      }

      html[data-theme="dark"] [style*="background:#e8f4fd"],
      html[data-theme="dark"] [style*="background: #e8f4fd"],
      html[data-theme="dark"] [style*="background:#d1ecf1"],
      html[data-theme="dark"] [style*="background: #d1ecf1"] {
        background: var(--info-bg) !important; color: var(--info-text) !important;
      }

      html[data-theme="dark"] [style*="color:#856404"],
      html[data-theme="dark"] [style*="color: #856404"] { color: var(--warn-text) !important; }

      html[data-theme="dark"] [style*="color:#721c24"],
      html[data-theme="dark"] [style*="color: #721c24"] { color: var(--danger-text) !important; }

      html[data-theme="dark"] [style*="color:#155724"],
      html[data-theme="dark"] [style*="color: #155724"] { color: var(--ok-text) !important; }

      /*
        Price bounds table. Buy and sell columns are tinted instead of the rows
        being zebra-striped, so the side being edited stays identifiable once
        the header has scrolled out of view.
      */
      :root {
        --buy-tint: #f1f8f3;   --buy-tint-head: #e2f1e8;
        --sell-tint: #fdf3f4;  --sell-tint-head: #fae3e5;
        --buy-text: #1e7e34;   --sell-text: #c82333;
      }

      html[data-theme="dark"] {
        --buy-tint: #101d17;   --buy-tint-head: #16291e;
        --sell-tint: #211215;  --sell-tint-head: #2c181c;
        --buy-text: #7ee2a8;   --sell-text: #ff9ea6;
      }

      .bounds-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        background: var(--surface);
      }

      .bounds-table th,
      .bounds-table td {
        border-bottom: 1px solid var(--border);
        text-align: center;
      }

      .bounds-table thead th {
        padding: 12px 8px;
        font-weight: 600;
        border-bottom: 2px solid var(--border-strong);
      }

      .bounds-table .bnd-subhead th {
        padding: 8px;
        font-size: 0.9em;
        font-weight: 500;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border-strong);
      }

      .bounds-table .bnd-name {
        text-align: left;
        padding: 12px;
        min-width: 200px;
        font-weight: bold;
        background: var(--surface);
      }

      .bounds-table td.bnd { padding: 8px; }

      .bounds-table .buy  { background: var(--buy-tint); }
      .bounds-table .sell { background: var(--sell-tint); }
      .bounds-table thead .buy  { background: var(--buy-tint-head); color: var(--buy-text); }
      .bounds-table thead .sell { background: var(--sell-tint-head); color: var(--sell-text); }

      /* Divider between the buy group and the sell group. */
      .bounds-table .grp-end { border-right: 2px solid var(--border-strong); }

      .bounds-table input[type=number] {
        padding: 4px;
        border: 1px solid var(--border-strong);
        border-radius: 3px;
        text-align: center;
        background: var(--surface);
        color: var(--text);
      }

      /* Keep the column tint visible on hover instead of the global row wash. */
      .bounds-table tbody tr:hover { background: transparent; }
      .bounds-table tbody tr:hover td {
        box-shadow: inset 0 0 0 9999px rgba(127, 127, 127, 0.09);
      }

      .bnd-link { color: var(--text); text-decoration: none; }
      .bnd-link:hover { text-decoration: underline; }

      /* Section panels */
      .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 20px;
      }

      .panel-head {
        padding: 15px;
        border-bottom: 1px solid var(--border);
        background: var(--surface-alt);
      }

      .panel-head p { color: var(--text-muted); }
      .wl-head { background: var(--info-bg); }
      .wl-head h3, .wl-head p { color: var(--info-text); }

      /* Watchlist table */
      .wl-table {
        width: 100%;
        border-collapse: collapse;
        background: var(--surface);
        margin-bottom: 0;
        box-shadow: none;
      }

      .wl-table th {
        padding: 14px 12px;
        text-align: center;
        font-weight: 600;
        font-size: 14px;
        color: var(--text-muted);
        background: var(--surface-alt);
        border-bottom: 2px solid var(--border-strong);
      }

      .wl-table td {
        padding: 12px;
        text-align: center;
        border-bottom: 1px solid var(--border);
      }

      .wl-table .wl-name { text-align: left; font-weight: bold; }
      .wl-link { color: var(--text); text-decoration: none; }
      .wl-link:hover { text-decoration: underline; }
      .wl-none { color: var(--text-muted); }
      .wl-buy { color: var(--buy-text); font-weight: bold; }
      .wl-sell { color: var(--sell-text); font-weight: bold; }

      /* Left accent marks status without relying on row background alone. */
      .wl-row { border-left: 4px solid transparent; }
      .wl-unpriced { border-left-color: #6c757d; }
      .wl-outdated { border-left-color: #f39c12; }
      .wl-current  { border-left-color: #28a745; }
      .miss-row    { border-left: 4px solid #17a2b8; }

      .wl-badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }

      .wl-badge.ok     { background: var(--ok-bg);     color: var(--ok-text); }
      .wl-badge.warn   { background: var(--warn-bg);   color: var(--warn-text); }
      .wl-badge.muted  { background: var(--surface-alt); color: var(--text-muted); }

      .empty-note {
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
      }

      /* Responsive design */
      @media (max-width: 768px) {
        .nav-container {
          flex-direction: column;
          gap: 10px;
        }

        .nav-links {
          flex-wrap: wrap;
          justify-content: center;
        }

        body {
          padding-top: 120px;
        }

        .container {
          margin: 10px;
          padding: 15px;
        }

        #queue-panel {
          position: relative;
          width: 100%;
          right: auto;
          top: auto;
          margin-bottom: 20px;
        }
      }
    </style>
  </head>
  <body>
    <nav>
      <div class="nav-container">
        <a href="/" class="nav-brand">
          💰 Bliss AutoPricer
        </a>
        <div class="nav-links">
          <a href="/dashboard">🚀 Dashboard</a>
          <a href="/">📋 Price List</a>
          <a href="/bounds">⚖️ Price Bounds</a>
          <a href="/key-prices">🔑 Key Prices</a>
          <a href="/pnl">💰 P&L Analysis</a>
          <a href="/trades">📊 Trade History</a>
          <a href="/logs">📝 Logs</a>
          <a href="/settings">⚙️ Settings</a>
          <a href="/bot-config">🤖 Bot Config</a>
          <a href="https://discord.gg/7H2bceTgQK" target="_blank" rel="noopener noreferrer">💬 Get Support</a>
          <button id="theme-toggle" type="button" title="Toggle dark mode" aria-label="Toggle dark mode">🌙</button>
          <a href="/logout" title="Sign out">🚪 Logout</a>
        </div>
      </div>
    </nav>
    <div class="container">
      ${bodyContent}
    </div>
    <script>
      (function () {
        var btn = document.getElementById('theme-toggle');
        if (!btn) { return; }
        var root = document.documentElement;
        function sync() {
          btn.textContent = root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
        }
        btn.addEventListener('click', function () {
          var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          root.setAttribute('data-theme', next);
          try { localStorage.setItem('bliss-theme', next); } catch (e) { /* private mode */ }
          sync();
        });
        sync();
      })();
    </script>
  </body>
  </html>
  `;
};
