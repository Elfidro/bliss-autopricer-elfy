// layout.js
module.exports = function renderPage(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Bliss AutoPricer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    // Applied before first paint so the page never flashes light then dark.
    (function () {
      try {
        var saved = localStorage.getItem('bliss-theme');
        var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
  <style>
    :root {
      /* Base fonts */
      --font-main: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

      /* Light Mode Palette */
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-card: #ffffff;
      --surface-hover: #f1f5f9;
      --surface-alt: #f8fafc;
      --text: #0f172a;
      --text-muted: #64748b;
      --text-dim: #94a3b8;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      
      --accent: #0284c7;
      --accent-strong: #0369a1;
      --accent-subtle: rgba(2, 132, 199, 0.08);
      --accent-glow: rgba(2, 132, 199, 0.2);

      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
      --shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
      --shadow-lg: 0 10px 30px rgba(15, 23, 42, 0.1);

      /* Semantic status colors */
      --ok: #10b981;
      --ok-bg: #ecfdf5;
      --ok-text: #065f46;
      --ok-border: #a7f3d0;
      
      --warn: #f59e0b;
      --warn-bg: #fffbeb;
      --warn-text: #92400e;
      --warn-border: #fde68a;

      --danger: #ef4444;
      --danger-bg: #fef2f2;
      --danger-text: #991b1b;
      --danger-border: #fecaca;

      --info: #0284c7;
      --info-bg: #f0f9ff;
      --info-text: #075985;
      --info-border: #bae6fd;

      --purple: #8b5cf6;
      --purple-bg: #f5f3ff;
      --purple-text: #5b21b6;
      --purple-border: #ddd6fe;

      --nav-bg: rgba(255, 255, 255, 0.88);
      --nav-border: #e2e8f0;
      --nav-link: #475569;
      --nav-link-hover: #0f172a;
      --nav-link-active-bg: rgba(2, 132, 199, 0.1);
      --nav-link-active: #0284c7;

      --radius-sm: 6px;
      --radius: 10px;
      --radius-lg: 14px;
      --radius-xl: 18px;

      --buy-tint: #f0fdf4;
      --buy-tint-head: #dcfce7;
      --buy-text: #15803d;
      --sell-tint: #fef2f2;
      --sell-tint-head: #fee2e2;
      --sell-text: #b91c1c;
    }

    html[data-theme="dark"] {
      color-scheme: dark;

      /* Dark Mode Palette - Deep Obsidian & Sleek Slate */
      --bg: #0b0f17;
      --surface: #111827;
      --surface-card: #151d2e;
      --surface-hover: #1e293b;
      --surface-alt: #1a2234;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --border: #222e42;
      --border-strong: #334155;

      --accent: #38bdf8;
      --accent-strong: #0ea5e9;
      --accent-subtle: rgba(56, 189, 248, 0.12);
      --accent-glow: rgba(56, 189, 248, 0.25);

      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.55);

      --ok: #34d399;
      --ok-bg: rgba(16, 185, 129, 0.14);
      --ok-text: #6ee7b7;
      --ok-border: rgba(16, 185, 129, 0.3);

      --warn: #fbbf24;
      --warn-bg: rgba(245, 158, 11, 0.14);
      --warn-text: #fde68a;
      --warn-border: rgba(245, 158, 11, 0.3);

      --danger: #f87171;
      --danger-bg: rgba(239, 68, 68, 0.14);
      --danger-text: #fca5a5;
      --danger-border: rgba(239, 68, 68, 0.3);

      --info: #38bdf8;
      --info-bg: rgba(14, 165, 233, 0.14);
      --info-text: #7dd3fc;
      --info-border: rgba(14, 165, 233, 0.3);

      --purple: #c084fc;
      --purple-bg: rgba(168, 85, 247, 0.14);
      --purple-text: #e9d5ff;
      --purple-border: rgba(168, 85, 247, 0.3);

      --nav-bg: rgba(15, 21, 34, 0.85);
      --nav-border: #222e42;
      --nav-link: #94a3b8;
      --nav-link-hover: #f1f5f9;
      --nav-link-active-bg: rgba(56, 189, 248, 0.12);
      --nav-link-active: #38bdf8;

      --buy-tint: rgba(16, 185, 129, 0.08);
      --buy-tint-head: rgba(16, 185, 129, 0.15);
      --buy-text: #34d399;
      --sell-tint: rgba(239, 68, 68, 0.08);
      --sell-tint-head: rgba(239, 68, 68, 0.15);
      --sell-text: #f87171;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      font-family: var(--font-main);
    }

    body {
      margin: 0;
      padding: 0;
      background-color: var(--bg);
      color: var(--text);
      padding-top: 76px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    /* Custom Scrollbars */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-dim);
    }

    /* Modern Navigation Header */
    nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 72px;
      background: var(--nav-bg);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--nav-border);
      z-index: 1000;
      display: flex;
      align-items: center;
      transition: all 0.25s ease;
    }

    .nav-container {
      max-width: 1560px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 24px;
      gap: 16px;
    }

    .nav-brand {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--text);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.02em;
      flex-shrink: 0;
    }

    .nav-brand-logo {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 10px rgba(245, 158, 11, 0.25);
    }

    .nav-brand-text {
      background: linear-gradient(135deg, var(--text) 40%, var(--text-muted) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .nav-brand-tag {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 7px;
      border-radius: 12px;
      background: var(--accent-subtle);
      color: var(--accent);
      border: 1px solid var(--accent-glow);
    }

    .nav-links {
      display: flex;
      gap: 4px;
      align-items: center;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding: 4px 0;
    }

    .nav-links::-webkit-scrollbar {
      display: none;
    }

    nav a.nav-item {
      color: var(--nav-link);
      text-decoration: none;
      padding: 8px 13px;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    nav a.nav-item:hover {
      color: var(--nav-link-hover);
      background: var(--surface-hover);
    }

    nav a.nav-item.active {
      color: var(--nav-link-active);
      background: var(--nav-link-active-bg);
      font-weight: 600;
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    #theme-toggle {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 1.05rem;
      width: 38px;
      height: 38px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    #theme-toggle:hover {
      background: var(--surface-hover);
      border-color: var(--border-strong);
      transform: scale(1.05);
    }

    .btn-nav-logout {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      text-decoration: none;
      font-size: 0.88rem;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .btn-nav-logout:hover {
      background: var(--danger-bg);
      color: var(--danger-text);
      border-color: var(--danger-border);
    }

    /* Main Container */
    .container {
      max-width: 1560px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      flex: 1;
    }

    /* Typography & Headings */
    h1, h2, h3, h4, h5, h6 {
      color: var(--text);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-top: 0;
    }

    p {
      color: var(--text-muted);
      line-height: 1.5;
    }

    a {
      color: var(--accent);
      text-decoration: none;
      transition: color 0.15s ease;
    }

    a:hover {
      color: var(--accent-strong);
      text-decoration: underline;
    }

    code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 2px 6px;
      border-radius: 4px;
    }

    /* Common Card Components */
    .ui-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .ui-card:hover {
      box-shadow: var(--shadow);
    }

    .ui-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }

    /* Stat Cards Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow);
      border-color: var(--border-strong);
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: var(--card-accent, var(--accent));
    }

    .stat-card.stat-danger { --card-accent: var(--danger); }
    .stat-card.stat-ok     { --card-accent: var(--ok); }
    .stat-card.stat-warn   { --card-accent: var(--warn); }
    .stat-card.stat-info   { --card-accent: var(--accent); }

    .stat-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .stat-icon-wrapper {
      width: 42px;
      height: 42px;
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      background: var(--icon-bg, var(--accent-subtle));
      color: var(--icon-color, var(--accent));
    }

    .stat-danger .stat-icon-wrapper { background: var(--danger-bg); color: var(--danger-text); }
    .stat-ok .stat-icon-wrapper     { background: var(--ok-bg);     color: var(--ok-text); }
    .stat-warn .stat-icon-wrapper   { background: var(--warn-bg);   color: var(--warn-text); }
    .stat-info .stat-icon-wrapper   { background: var(--info-bg);   color: var(--info-text); }

    .stat-title {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-value {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--text);
      line-height: 1.1;
      margin-bottom: 6px;
      font-feature-settings: "tnum";
    }

    .stat-danger .stat-value { color: var(--danger-text); }
    .stat-ok .stat-value     { color: var(--ok-text); }
    .stat-warn .stat-value   { color: var(--warn-text); }
    .stat-info .stat-value   { color: var(--info-text); }

    .stat-desc {
      font-size: 0.85rem;
      color: var(--text-dim);
      margin: 0;
    }

    /* Modern Table Design */
    .table-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      margin-bottom: 28px;
      box-shadow: var(--shadow-sm);
    }

    .table-header-bar {
      padding: 18px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--surface-alt);
    }

    .table-header-bar h3 {
      margin: 0;
      font-size: 1.15rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .table-header-bar p {
      margin: 4px 0 0 0;
      font-size: 0.88rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      color: var(--text);
      font-size: 0.92rem;
    }

    thead th {
      background: var(--surface-alt);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-strong);
      text-align: left;
    }

    tbody td {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      transition: background-color 0.15s ease;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    tbody tr:hover {
      background: var(--surface-hover) !important;
    }

    /* Table Row Indicators (subtle and high-contrast) */
    .row-outdated-critical {
      border-left: 4px solid var(--danger);
      background: rgba(239, 68, 68, 0.03);
    }
    .row-outdated-warn {
      border-left: 4px solid var(--warn);
      background: rgba(245, 158, 11, 0.03);
    }
    .row-outdated-recent {
      border-left: 4px solid #fdba74;
      background: rgba(253, 186, 116, 0.02);
    }
    .row-current {
      border-left: 4px solid var(--ok);
      background: rgba(16, 185, 129, 0.02);
    }

    /* Price tags */
    .price-tag {
      font-family: var(--font-mono);
      font-size: 0.92rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .price-buy {
      background: var(--ok-bg);
      color: var(--ok-text);
      border: 1px solid var(--ok-border);
    }

    .price-sell {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }

    .badge-ok      { background: var(--ok-bg);     color: var(--ok-text);     border: 1px solid var(--ok-border); }
    .badge-warn    { background: var(--warn-bg);   color: var(--warn-text);   border: 1px solid var(--warn-border); }
    .badge-danger  { background: var(--danger-bg); color: var(--danger-text); border: 1px solid var(--danger-border); }
    .badge-info    { background: var(--info-bg);   color: var(--info-text);   border: 1px solid var(--info-border); }
    .badge-muted   { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }

    .sku-badge {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      background: var(--surface-alt);
      color: var(--text-muted);
      border: 1px solid var(--border);
      padding: 3px 8px;
      border-radius: 6px;
      user-select: all;
    }

    /* Bot Status Pill */
    .bot-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
    }
    .bot-status.in-bot {
      background: var(--ok-bg);
      color: var(--ok-text);
      border: 1px solid var(--ok-border);
    }
    .bot-status.not-in-bot {
      background: var(--surface-alt);
      color: var(--text-dim);
      border: 1px solid var(--border);
    }

    /* Form Controls & Inputs */
    input[type="text"],
    input[type="password"],
    input[type="number"],
    select,
    textarea {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      padding: 9px 13px;
      font-size: 0.92rem;
      transition: all 0.2s ease;
      font-family: var(--font-main);
    }

    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    /* Action Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 9px 18px;
      border-radius: var(--radius-sm);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid transparent;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn:hover {
      transform: translateY(-1px);
      text-decoration: none;
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
      box-shadow: 0 2px 8px var(--accent-glow);
    }
    .btn-primary:hover {
      background: var(--accent-strong);
      color: #fff;
    }

    .btn-success {
      background: var(--ok);
      color: #fff;
    }
    .btn-success:hover {
      filter: brightness(1.08);
      color: #fff;
    }

    .btn-danger {
      background: var(--danger);
      color: #fff;
    }
    .btn-danger:hover {
      filter: brightness(1.08);
      color: #fff;
    }

    .btn-secondary {
      background: var(--surface-alt);
      color: var(--text);
      border-color: var(--border-strong);
    }
    .btn-secondary:hover {
      background: var(--surface-hover);
      color: var(--text);
    }

    /* Compact Mini Action Buttons */
    .btn-icon-action {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.18s ease;
      background: var(--surface);
      color: var(--text);
    }

    .btn-icon-action:hover {
      transform: translateY(-1px);
    }

    .btn-icon-action.act-add {
      background: var(--ok-bg);
      color: var(--ok-text);
      border-color: var(--ok-border);
    }
    .btn-icon-action.act-add:hover {
      background: var(--ok);
      color: #fff;
    }

    .btn-icon-action.act-remove {
      background: var(--danger-bg);
      color: var(--danger-text);
      border-color: var(--danger-border);
    }
    .btn-icon-action.act-remove:hover {
      background: var(--danger);
      color: #fff;
    }

    .btn-icon-action.act-edit {
      background: var(--warn-bg);
      color: var(--warn-text);
      border-color: var(--warn-border);
    }
    .btn-icon-action.act-edit:hover {
      background: var(--warn);
      color: #fff;
    }

    /* Floating Dock Pending Actions Queue Panel */
    #queue-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 360px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      z-index: 1050;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(12px);
    }

    #queue-panel.minimized {
      width: auto;
      max-height: 52px;
      border-radius: 9999px;
      box-shadow: 0 8px 24px var(--accent-glow);
    }

    #queue-panel.minimized .queue-body {
      display: none;
    }

    .queue-header {
      padding: 14px 18px;
      background: var(--surface-alt);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    #queue-panel.minimized .queue-header {
      border-bottom: none;
      padding: 10px 18px;
      background: var(--surface);
    }

    .queue-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .queue-badge-count {
      background: var(--accent);
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
    }

    .queue-body {
      padding: 16px;
      max-height: 380px;
      overflow-y: auto;
    }

    #queue-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    #queue-list li {
      padding: 10px 12px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    #queue-list li:hover {
      background: var(--danger-bg);
      border-color: var(--danger-border);
    }

    /* Filter Chips / Badges */
    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 20px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      color: var(--text-muted);
      font-size: 0.86rem;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }

    .filter-chip:hover {
      background: var(--surface-hover);
      color: var(--text);
    }

    .filter-chip input {
      accent-color: var(--accent);
      cursor: pointer;
    }

    .filter-chip:has(input:checked) {
      background: var(--accent-subtle);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }

    /* Search input group */
    .search-input-wrap {
      position: relative;
      flex: 1;
      min-width: 260px;
    }

    .search-input-wrap input {
      width: 100%;
      padding-left: 38px;
    }

    .search-input-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 15px;
      pointer-events: none;
    }

    /* Flash Messages */
    .flash {
      padding: 14px 18px;
      border-radius: var(--radius);
      margin-bottom: 24px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .flash-error {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
    }

    .flash-ok {
      background: var(--ok-bg);
      color: var(--ok-text);
      border: 1px solid var(--ok-border);
    }

    /* Console pre */
    pre {
      background: #0d1117 !important;
      color: #7ee787 !important;
      padding: 20px;
      font-family: var(--font-mono);
      font-size: 0.9rem;
      overflow-x: auto;
      max-height: 75vh;
      border-radius: var(--radius);
      border: 1px solid #30363d !important;
      box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
    }

    /* Universal Normalization for Legacy Inline Styles */
    html[data-theme="dark"] [style*="background: white"],
    html[data-theme="dark"] [style*="background:white"],
    html[data-theme="dark"] [style*="background-color: white"],
    html[data-theme="dark"] [style*="background:#f8f9fa"],
    html[data-theme="dark"] [style*="background: #f8f9fa"],
    html[data-theme="dark"] [style*="background-color:#f8f9fa"],
    html[data-theme="dark"] [style*="background-color: #f8f9fa"],
    html[data-theme="dark"] [style*="background:#f5f5f5"],
    html[data-theme="dark"] [style*="background: #f5f5f5"],
    html[data-theme="dark"] [style*="background-color:#f5f5f5"],
    html[data-theme="dark"] [style*="background-color: #f5f5f5"],
    html[data-theme="dark"] [style*="background:#e9ecef"],
    html[data-theme="dark"] [style*="background: #e9ecef"],
    html[data-theme="dark"] [style*="background:#fff"],
    html[data-theme="dark"] [style*="background: #fff"] {
      background: var(--surface) !important;
      color: var(--text) !important;
      border-color: var(--border) !important;
    }

    html[data-theme="dark"] [style*="background-color: #f8d7da"],
    html[data-theme="dark"] [style*="background-color:#f8d7da"],
    html[data-theme="dark"] [style*="background:#f8d7da"],
    html[data-theme="dark"] [style*="background: #f8d7da"],
    html[data-theme="dark"] [style*="background-color: #ffe6e6"],
    html[data-theme="dark"] [style*="background-color:#ffe6e6"] {
      background-color: var(--danger-bg) !important;
      color: var(--text) !important;
    }

    html[data-theme="dark"] [style*="background-color: #d4edda"],
    html[data-theme="dark"] [style*="background-color:#d4edda"],
    html[data-theme="dark"] [style*="background:#d4edda"],
    html[data-theme="dark"] [style*="background: #d4edda"],
    html[data-theme="dark"] [style*="background-color: #c3e6cb"],
    html[data-theme="dark"] [style*="background-color: #b8dacc"],
    html[data-theme="dark"] [style*="background-color: #c8e6c9"] {
      background-color: var(--ok-bg) !important;
      color: var(--text) !important;
    }

    html[data-theme="dark"] [style*="background-color: #fff3cd"],
    html[data-theme="dark"] [style*="background-color:#fff3cd"],
    html[data-theme="dark"] [style*="background:#fff3cd"],
    html[data-theme="dark"] [style*="background: #fff3cd"] {
      background-color: var(--warn-bg) !important;
      color: var(--text) !important;
    }

    html[data-theme="dark"] [style*="background-color: #e8f4fd"],
    html[data-theme="dark"] [style*="background-color:#e8f4fd"],
    html[data-theme="dark"] [style*="background:#e8f4fd"],
    html[data-theme="dark"] [style*="background: #e8f4fd"],
    html[data-theme="dark"] [style*="background:#d1ecf1"],
    html[data-theme="dark"] [style*="background: #d1ecf1"] {
      background-color: var(--info-bg) !important;
      color: var(--text) !important;
    }

    html[data-theme="dark"] [style*="color:#333"],
    html[data-theme="dark"] [style*="color: #333"],
    html[data-theme="dark"] [style*="color:#212529"],
    html[data-theme="dark"] [style*="color: #212529"],
    html[data-theme="dark"] [style*="color:#000"],
    html[data-theme="dark"] [style*="color: #000"] {
      color: var(--text) !important;
    }

    html[data-theme="dark"] [style*="color:#666"],
    html[data-theme="dark"] [style*="color: #666"],
    html[data-theme="dark"] [style*="color:#495057"],
    html[data-theme="dark"] [style*="color: #495057"],
    html[data-theme="dark"] [style*="color:#6c757d"],
    html[data-theme="dark"] [style*="color: #6c757d"] {
      color: var(--text-muted) !important;
    }

    html[data-theme="dark"] [style*="color:#721c24"],
    html[data-theme="dark"] [style*="color: #721c24"],
    html[data-theme="dark"] [style*="color:#dc3545"],
    html[data-theme="dark"] [style*="color: #dc3545"] {
      color: var(--danger-text) !important;
    }

    html[data-theme="dark"] [style*="color:#155724"],
    html[data-theme="dark"] [style*="color: #155724"],
    html[data-theme="dark"] [style*="color:#28a745"],
    html[data-theme="dark"] [style*="color: #28a745"] {
      color: var(--ok-text) !important;
    }

    html[data-theme="dark"] [style*="color:#856404"],
    html[data-theme="dark"] [style*="color: #856404"] {
      color: var(--warn-text) !important;
    }

    html[data-theme="dark"] [style*="color:#007cba"],
    html[data-theme="dark"] [style*="color: #007cba"],
    html[data-theme="dark"] [style*="color:#004085"],
    html[data-theme="dark"] [style*="color: #004085"] {
      color: var(--accent) !important;
    }

    html[data-theme="dark"] [style*="border: 1px solid #ddd"],
    html[data-theme="dark"] [style*="border: 1px solid #dee2e6"],
    html[data-theme="dark"] [style*="border-bottom: 1px solid #dee2e6"],
    html[data-theme="dark"] [style*="border-bottom: 1px solid #eee"],
    html[data-theme="dark"] [style*="border-bottom: 1px solid #ddd"],
    html[data-theme="dark"] [style*="border-bottom: 2px solid #dee2e6"] {
      border-color: var(--border) !important;
    }

    /*
      Price bounds table. Buy and sell columns are tinted instead of the rows
      being zebra-striped, so the side being edited stays identifiable once
      the header has scrolled out of view.
    */
    .bounds-table {
      width: 100%;
      border-collapse: collapse;
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
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-strong);
    }

    .bounds-table .bnd-name {
      text-align: left;
      padding: 12px;
      min-width: 200px;
      font-weight: 600;
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
      padding: 4px 6px;
      text-align: center;
      font-size: 0.86rem;
    }

    /* Keep the column tint visible on hover instead of the global row wash. */
    .bounds-table tbody tr:hover { background: transparent !important; }
    .bounds-table tbody tr:hover td {
      box-shadow: inset 0 0 0 9999px rgba(127, 127, 127, 0.09);
    }

    .bnd-link { color: var(--text); text-decoration: none; }
    .bnd-link:hover { text-decoration: underline; }

    /* Responsive adjustments */
    @media (max-width: 1024px) {
      .nav-links {
        gap: 2px;
      }
      nav a.nav-item {
        padding: 6px 10px;
        font-size: 0.82rem;
      }
    }

    @media (max-width: 768px) {
      body {
        padding-top: 130px;
      }
      nav {
        height: auto;
        padding: 10px 0;
      }
      .nav-container {
        flex-direction: column;
        gap: 10px;
        padding: 0 16px;
      }
      .nav-links {
        width: 100%;
        justify-content: flex-start;
      }
      .container {
        padding: 14px;
      }
      #queue-panel {
        right: 12px;
        bottom: 12px;
        left: 12px;
        width: auto;
      }
    }
  </style>
</head>
<body>
  <nav>
    <div class="nav-container">
      <a href="/" class="nav-brand">
        <div class="nav-brand-logo">💰</div>
        <span class="nav-brand-text">Bliss AutoPricer</span>
        <span class="nav-brand-tag">v2.0</span>
      </a>

      <div class="nav-links">
        <a href="/dashboard" class="nav-item"><span>🚀</span> Dashboard</a>
        <a href="/" class="nav-item"><span>📋</span> Price List</a>
        <a href="/bounds" class="nav-item"><span>⚖️</span> Price Bounds</a>
        <a href="/key-prices" class="nav-item"><span>🔑</span> Key Prices</a>
        <a href="/pnl" class="nav-item"><span>📈</span> P&L Analysis</a>
        <a href="/trades" class="nav-item"><span>📊</span> Trade History</a>
        <a href="/logs" class="nav-item"><span>📝</span> Logs</a>
        <a href="/settings" class="nav-item"><span>⚙️</span> Settings</a>
        <a href="/bot-config" class="nav-item"><span>🤖</span> Bot Config</a>
      </div>

      <div class="nav-actions">
        <a href="https://discord.gg/7H2bceTgQK" target="_blank" rel="noopener noreferrer" class="btn-nav-logout" title="Join Discord Community">
          <span>💬</span> Support
        </a>
        <button id="theme-toggle" type="button" title="Toggle theme" aria-label="Toggle dark mode">🌙</button>
        <a href="/logout" class="btn-nav-logout" title="Sign out">
          <span>🚪</span> Logout
        </a>
      </div>
    </div>
  </nav>

  <main class="container">
    ${bodyContent}
  </main>

  <script>
    // Theme toggle & active navigation sync
    (function () {
      // 1. Theme toggle
      var btn = document.getElementById('theme-toggle');
      var root = document.documentElement;
      function syncThemeBtn() {
        if (!btn) return;
        var isDark = root.getAttribute('data-theme') === 'dark';
        btn.textContent = isDark ? '☀️' : '🌙';
        btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      }
      if (btn) {
        btn.addEventListener('click', function () {
          var current = root.getAttribute('data-theme');
          var next = current === 'dark' ? 'light' : 'dark';
          root.setAttribute('data-theme', next);
          try { localStorage.setItem('bliss-theme', next); } catch (e) {}
          syncThemeBtn();
        });
        syncThemeBtn();
      }

      // 2. Active nav link highlighting
      var currentPath = window.location.pathname;
      var links = document.querySelectorAll('nav a.nav-item');
      links.forEach(function (link) {
        var href = link.getAttribute('href');
        if (href === currentPath || (href !== '/' && currentPath.startsWith(href))) {
          link.classList.add('active');
        } else if (href === '/' && currentPath === '/') {
          link.classList.add('active');
        }
      });
    })();
  </script>
</body>
</html>`;
};
