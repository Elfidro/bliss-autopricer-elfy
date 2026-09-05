const fs = require('fs');
const path = require('path');
const renderPage = require('../layout');

const LOG_FILES = ['bptf-autopricer-out.log', 'bptf-autopricer-error.log'];

module.exports = (app) => {
  const pm2LogDir = path.join(process.env.HOME || process.env.USERPROFILE, '.pm2', 'logs');

  app.get('/logs', (req, res) => {
    const file = req.query.file || 'bptf-autopricer-out.log';

    if (!LOG_FILES.includes(file)) {
      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>❌ Invalid Log File</h2>';
      html += '<p>The requested log file is not available or not allowed.</p>';
      html +=
        '<p><a href="/logs" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Logs</a></p>';
      html += '</div>';
      html += '</div>';
      return res.status(400).send(renderPage('Invalid Log File', html));
    }

    const logPath = path.join(pm2LogDir, file);

    fs.readFile(logPath, 'utf8', (err, data) => {
      let html = '<div style="max-width: 1560px; margin: 0 auto;">';

      // Header
      html += `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
              <span>📝</span> Application Runtime Logs
            </h1>
            <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
              Inspect real-time standard output and error telemetry streams emitted by PM2 and the autopricer engine.
            </p>
          </div>
          <div style="display: flex; gap: 8px;">
            ${LOG_FILES.map((f) => {
              const isActive = f === file;
              const icon = f.includes('error') ? '🔴' : '📄';
              return `<a href="/logs?file=${f}" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}"><span>${icon}</span> ${f}</a>`;
            }).join('')}
          </div>
        </div>
      `;

      // Log Content Box
      html += `
        <div class="table-container" style="margin-bottom: 24px;">
          <div class="table-header-bar">
            <div>
              <h3 style="margin: 0;"><span>📋</span> ${file}</h3>
              <p style="margin: 4px 0 0 0; color: var(--text-muted);">Showing recent buffer tail (15KB) • Auto-refreshes every 8 minutes</p>
            </div>
            <button onclick="window.location.reload()" class="btn btn-secondary" style="font-size: 0.84rem; padding: 6px 14px;">
              <span>🔄</span> Refresh Now
            </button>
          </div>
      `;

      if (err) {
        html += `
          <div style="padding: 36px 24px; text-align: center;">
            <div style="font-size: 36px; margin-bottom: 12px;">⚠️</div>
            <h4 style="margin: 0 0 8px 0; font-size: 1.1rem; color: var(--danger-text);">Unable to Read Log File</h4>
            <p style="color: var(--text-muted); margin-bottom: 16px;"><code>${logPath}</code></p>
            <div style="font-size: 0.88rem; color: var(--text-dim); max-width: 500px; margin: 0 auto;">
              Error: ${err.message}. The log file might not have been generated yet or the PM2 process is currently idle.
            </div>
          </div>
        `;
      } else {
        const logContent = data.slice(-15000);
        const escapedContent = logContent.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `
          <div style="padding: 0;">
            <pre id="logbox" style="margin: 0; border: none !important; border-radius: 0 !important; max-height: 72vh; line-height: 1.45; white-space: pre-wrap;">${escapedContent}</pre>
          </div>
        `;
      }

      html += `</div>`;

      // Info Card
      html += `
        <div class="ui-card" style="border-left: 4px solid var(--accent); padding: 18px 24px;">
          <h4 style="margin: 0 0 8px 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <span>💡</span> Real-Time CLI Monitoring
          </h4>
          <p style="margin: 0; font-size: 0.9rem; color: var(--text-muted);">
            For real-time streaming logs with zero delay, connect to your terminal or host shell and run: 
            <code style="margin-left: 6px;">pm2 logs ${file.replace(/-(out|error).log$/, '')}${file.includes('error') ? ' --err' : ' --out'}</code>
          </p>
        </div>
      `;

      html += '</div>';

      // Auto-refresh script (8 minutes = 480,000ms)
      html += `
        <script>
          setTimeout(() => {
            window.location.reload();
          }, 480000);
          
          // Auto-scroll to bottom of log
          window.addEventListener('load', () => {
            const logbox = document.getElementById('logbox');
            if (logbox) {
              logbox.scrollTop = logbox.scrollHeight;
            }
          });
        </script>
      `;

      res.send(renderPage(`Application Logs - ${file}`, html));
    });
  });
};
