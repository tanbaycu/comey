import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CLOUD_DIR = path.join(ROOT, 'apps', 'cloud');
const DEV_VARS_PATH = path.join(CLOUD_DIR, '.dev.vars');
const PUBLIC_INDEX_PATH = path.join(CLOUD_DIR, 'public', 'index.html');
const IS_WIN = process.platform === 'win32';

function quoteWinArg(arg) {
  if (!/[\s"&|<>^()]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function resolveCommand(cmd, args) {
  if (IS_WIN) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const commandLine = [cmd, ...args].map(quoteWinArg).join(' ');
    return {
      command: comspec,
      args: ['/d', '/s', '/c', commandLine],
    };
  }
  return { command: cmd, args };
}

function runStep(cmd, args, options = {}) {
  const resolved = resolveCommand(cmd, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: options.cwd ?? ROOT,
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });
  if (result.error) {
    console.error(`[comey dev] Failed to execute ${cmd}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureDevVars() {
  if (existsSync(DEV_VARS_PATH)) {
    return;
  }
  const masterKey = randomBytes(32).toString('base64');
  const sessionSecret = randomBytes(32).toString('base64');
  const content = [
    `MASTER_ENCRYPTION_KEY=${masterKey}`,
    `SESSION_SECRET=${sessionSecret}`,
    'ALLOW_PUBLIC_SIGNUP=true',
    'ADMIN_BOOTSTRAP_KEY=comey_local_bootstrap',
    '',
  ].join('\n');
  writeFileSync(DEV_VARS_PATH, content, 'utf8');
  console.log('[comey dev] Created apps/cloud/.dev.vars with random local secrets.');
}

console.log('[comey dev] Bootstrapping workspace...');
ensureDevVars();

// Always build workspace libraries so cloud & dashboard use fresh builds
runStep('pnpm', ['--filter', '@comey/core', 'build']);
runStep('pnpm', ['--filter', '@comey/apps-script', 'build']);
if (!existsSync(PUBLIC_INDEX_PATH)) {
  runStep('pnpm', ['--filter', '@comey/dashboard', 'build']);
}

console.log('[comey dev] Applying local D1 migrations...');
runStep(
  'pnpm',
  ['--filter', '@comey/cloud', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'],
  { input: 'y\n' }
);

console.log('');
console.log('==========================================================');
console.log('  Comey Local Studio Ready!');
console.log('  - Dashboard HMR UI : http://127.0.0.1:5173');
console.log('  - Worker API + D1  : http://127.0.0.1:8787');
console.log('==========================================================');
console.log('');

const children = [];
let shuttingDown = false;

function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    killTree(child);
  }
  process.exit(exitCode);
}

function startBg(label, filterName) {
  const resolved = resolveCommand('pnpm', ['--filter', filterName, 'dev']);
  const child = spawn(resolved.command, resolved.args, {
    cwd: ROOT,
    stdio: 'inherit',
    detached: !IS_WIN,
  });
  child.on('error', (err) => {
    console.error(`[${label}] failed to start:`, err.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (code !== null && code !== 0) {
      console.error(`[${label}] exited unexpectedly with code ${code}. Shutting down...`);
      shutdown(code);
    } else if (signal) {
      console.error(`[${label}] terminated by signal ${signal}. Shutting down...`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

startBg('cloud', '@comey/cloud');
startBg('dashboard', '@comey/dashboard');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
