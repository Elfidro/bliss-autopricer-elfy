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

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, resolve);
      return;
    }
    // Mute echo so the password is not printed as it is typed.
    process.stdout.write(question);
    const onData = (char) => {
      if (['\n', '\r', ''].includes(char.toString())) {
        process.stdin.removeListener('data', onData);
      } else {
        readline.moveCursor(process.stdout, -1000, 0);
        readline.clearLine(process.stdout, 1);
        process.stdout.write(question);
      }
    };
    process.stdin.on('data', onData);
    rl.question('', (value) => {
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(value);
    });
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const existing = config.webAuth?.username || 'admin';
    const username = (await ask(rl, `Username [${existing}]: `)).trim() || existing;
    const password = await ask(rl, 'Password: ', { hidden: true });
    const confirm = await ask(rl, 'Confirm password: ', { hidden: true });

    if (!password) {
      console.error('\n❌ Password cannot be empty.');
      process.exit(1);
    }
    if (password !== confirm) {
      console.error('\n❌ Passwords do not match.');
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('\n❌ Use at least 8 characters.');
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
    rl.close();
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
