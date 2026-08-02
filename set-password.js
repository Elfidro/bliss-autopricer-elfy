#!/usr/bin/env node
// Sets the web UI login credentials in config.json.
//
// Stores a scrypt hash, never the plaintext password.
// Usage: npm run set-password

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { hashPassword } = require('./modules/auth');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');

// Wraps readline so password prompts do not echo. Overriding _writeToOutput is
// the standard approach and degrades cleanly when stdin is not a TTY.
function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const write = rl._writeToOutput.bind(rl);
  rl.muted = false;
  rl._writeToOutput = function (str) {
    if (rl.muted) {
      return;
    }
    write(str);
  };
  return rl;
}

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (hidden) {
        rl.muted = false;
        process.stdout.write('\n');
      }
      resolve(answer);
    });
    // Set after question() so the prompt itself still prints.
    rl.muted = hidden;
  });
}

// When stdin is not a terminal (piped input, CI, scripted setup) readline's
// question() chain does not survive the stream ending, so read the three
// values as plain lines instead: username, password, confirmation.
function readPipedLines() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.split(/\r?\n/)));
    process.stdin.on('error', reject);
  });
}

async function main() {
  console.log('🔒 Bliss AutoPricer — web UI credentials');
  console.log('========================================\n');

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ config.json not found. Copy config.example.json to config.json first.');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`❌ Could not parse config.json: ${err.message}`);
    process.exit(1);
  }

  const existing = config.webAuth?.username || 'admin';
  let username;
  let password;
  let confirm;
  let rl = null;

  if (process.stdin.isTTY) {
    rl = createPrompt();
    username = (await ask(rl, `Username [${existing}]: `)).trim() || existing;
    password = await ask(rl, 'Password: ', { hidden: true });
    confirm = await ask(rl, 'Confirm password: ', { hidden: true });
  } else {
    const lines = await readPipedLines();
    username = (lines[0] || '').trim() || existing;
    password = lines[1] || '';
    confirm = lines[2] || '';
  }

  try {
    if (!password) {
      console.error('❌ Password cannot be empty.');
      process.exit(1);
    }
    if (password !== confirm) {
      console.error('❌ Passwords do not match.');
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('❌ Use at least 8 characters.');
      process.exit(1);
    }

    config.webAuth = {
      enabled: true,
      username,
      passwordHash: hashPassword(password),
      sessionHours: config.webAuth?.sessionHours || 12,
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`\n✅ Credentials saved for "${username}".`);
    console.log('   Restart the pricer for it to take effect:');
    console.log('   pm2 restart bptf-autopricer\n');
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
