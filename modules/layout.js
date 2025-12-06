// layout.js
module.exports = function renderPage(title, bodyContent) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      * {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      body { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
        margin: 0; 
        padding: 0; 
        background-color: #f5f5f5;
        padding-top: 80px; /* Account for fixed header */
      }
      
      /* Modern Navigation Header */
      nav { 
        position: fixed; 
        top: 0; 
        left: 0; 
        right: 0;
        background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
        color: #fff; 
        padding: 15px 0; 
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        border-bottom: 3px solid #2980b9;
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

      /* Main content container */
      .container {
        margin: 20px;
        padding: 20px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
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
        background: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #e9ecef;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      .controls input[type=text] { 
        padding: 10px 12px; 
        width: 200px; 
        margin-right: 10px; 
        border: 1px solid #ced4da;
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.3s ease;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      .controls input[type=text]:focus {
        outline: none;
        border-color: #4a90e2;
        box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
      }
      
      .controls label { 
        margin-right: 15px; 
        font-weight: 500;
        color: #495057;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      #queue-panel {
        position: fixed;
        top: 100px;
        right: 20px;
        width: 280px;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 12px;
        padding: 20px;
        max-height: 80vh;
        overflow: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }

      .chart-fullscreen {
        position: absolute;
        top: 80px; /* Account for new nav height */
        left: 0;
        right: 0;
        bottom: 0;
        padding: 20px;
        background: white;
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
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      th, td {
        border: none;
        border-bottom: 1px solid #e9ecef;
        padding: 12px 16px;
        text-align: left;
        vertical-align: middle;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      th { 
        background: #f8f9fa;
        font-weight: 600;
        color: #495057;
        border-bottom: 2px solid #dee2e6;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      tr:hover {
        background: #f8f9fa;
      }
      
      button {
        cursor: pointer;
        border: 1px solid #ced4da;
        background: white;
        font-size: 14px;
        padding: 6px 12px;
        border-radius: 6px;
        transition: all 0.2s ease;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      button:hover {
        background: #e9ecef;
        border-color: #adb5bd;
      }

      /* Status indicators with modern colors */
      .outdated-2h { background: #fff3cd; border-left: 4px solid #ffc107; }
      .outdated-1d { background: #ffeaa7; border-left: 4px solid #f39c12; }
      .outdated-2d { background: #ffeaea; border-left: 4px solid #e74c3c; }
      .current-row { background: #d4edda; border-left: 4px solid #28a745; }
      
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
        </div>
      </div>
    </nav>
    <div class="container">
      ${bodyContent}
    </div>
  </body>
  </html>
  `;
};
