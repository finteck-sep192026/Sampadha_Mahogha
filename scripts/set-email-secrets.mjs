// Sets the two portal email senders as Supabase Edge Function secrets (see
// supabase/functions/_shared/smtp.ts):
//   kyc@sampadha.com       client onboarding, sign-in codes, client links
//   research@sampadha.com  research reports, order alerts, test emails
//
//   npx supabase login        (once on this computer)
//   npm run secrets:email     asks for each value; passwords are not shown while typed
//
// Each password is a Google app password of that mailbox (Google Account → Security → App passwords).
// The script signs in to Gmail with it first, so a wrong password is caught here rather than when a
// client is waiting for a code. Values go to Supabase through a temporary file that only this user can
// read and that is deleted straight after; nothing is written inside the project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import tls from 'node:tls';

const PROJECT_REF = 'nxtyswlxnmekpvlfuucg';
const HOST = 'smtp.gmail.com';
const PORT = 465;

function ask(question, fallback = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = fallback ? ` [${fallback}]` : '';
  return new Promise((resolve) =>
    rl.question(`${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    }),
  );
}

// Reads a line without echoing it.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal so the password can be typed.'));
    stdout.write(`${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      err ? reject(err) : resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled.'));
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

// Signs in over SMTPS and quits; resolves on success, rejects with the server's answer otherwise.
function checkSmtp(user, pass) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST });
    const steps = [
      { expect: '220', send: 'EHLO sampadha-setup' },
      { expect: '250', send: 'AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64') },
      { expect: '235', send: 'QUIT' },
    ];
    let buffer = '';
    const timer = setTimeout(() => fail(new Error('No answer from Gmail within 20 seconds.')), 20000);
    const fail = (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    socket.setEncoding('utf8');
    socket.on('error', fail);
    socket.on('data', (data) => {
      buffer += data;
      // A reply is complete when its last line has a space after the code ("250 OK", not "250-...").
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] ?? '';
      if (!buffer.endsWith('\r\n') || !/^\d{3} /.test(last)) return;
      buffer = '';
      const step = steps.shift();
      if (!step) return;
      if (!last.startsWith(step.expect)) return fail(new Error(last));
      socket.write(step.send + '\r\n');
      if (step.send === 'QUIT') {
        clearTimeout(timer);
        socket.end();
        resolve();
      }
    });
  });
}

async function sender(label, defaultUser, defaultName) {
  console.log(`\n${label}`);
  const user = await ask('  Mailbox', defaultUser);
  for (;;) {
    const pass = (await askHidden('  App password (16 letters; spaces are fine)')).replace(/\s+/g, '');
    if (!pass) {
      console.log('  An app password is needed.');
      continue;
    }
    process.stdout.write('  Checking with Gmail… ');
    try {
      await checkSmtp(user, pass);
      console.log('signed in.');
      // Just the name people see; the address is always the mailbox itself (see _shared/smtp.ts).
      const from = await ask('  Sender name shown to clients', defaultName);
      return { user, pass, from };
    } catch (err) {
      console.log(`refused: ${err.message}`);
      console.log('  Check the mailbox and that this is an app password, not the account password.');
    }
  }
}

const kyc = await sender('KYC sender: onboarding, sign-in codes, client links', 'kyc@sampadha.com', 'Sampadha KYC');
const research = await sender('Research sender: reports, order alerts, test emails', 'research@sampadha.com', 'Sampadha Research');

const quote = (v) => JSON.stringify(v);
const lines = [
  `SMTP_HOST=${HOST}`,
  `SMTP_PORT=${PORT}`,
  `SMTP_KYC_USERNAME=${quote(kyc.user)}`,
  `SMTP_KYC_PASSWORD=${quote(kyc.pass)}`,
  `MAIL_FROM_KYC=${quote(kyc.from)}`,
  `SMTP_RESEARCH_USERNAME=${quote(research.user)}`,
  `SMTP_RESEARCH_PASSWORD=${quote(research.pass)}`,
  `MAIL_FROM_RESEARCH=${quote(research.from)}`,
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampadha-secrets-'));
const file = path.join(dir, 'email.env');
try {
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`\nSaving ${lines.length} secrets to Supabase project ${PROJECT_REF}…`);
  // One command line (npx is a .cmd on Windows, which needs a shell); the only variable part is our
  // own temp path, quoted.
  const run = spawnSync(`npx supabase secrets set --env-file "${file}" --remote=${PROJECT_REF}`, {
    stdio: 'inherit',
    shell: true,
  });
  if (run.status !== 0) {
    console.error('\nSupabase did not accept them. If it asked you to log in, run: npx supabase login');
    process.exitCode = 1;
  } else {
    console.log('\nDone. Next: npm run deploy:email (once), then Admin → Email delivery → Send test email.');
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
