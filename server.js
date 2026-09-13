import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/pty' });

const PORT = process.env.PORT || 3000;

// ---- static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

// Serve every installed xterm.js bundle locally (nothing loaded from CDN,
// so "nothing gets remains" — all packages are installed AND used).
//  core:      /xterm/xterm.js  +  /xterm/xterm.css
//  addons:    /xterm/addon-*.js
app.use(
  '/xterm/xterm.css',
  express.static(path.join(__dirname, 'node_modules/@xterm/xterm/css/xterm.css'))
);
for (const addon of [
  'addon-attach',
  'addon-canvas',
  'addon-fit',
  'addon-image',
  'addon-progress',
  'addon-search',
  'addon-serialize',
  'addon-unicode11',
  'addon-web-links',
  'addon-webgl',
]) {
  app.use(
    `/xterm/${addon}.js`,
    express.static(path.join(__dirname, `node_modules/@xterm/${addon}/lib/${addon}.js`))
  );
}
app.use(
  '/xterm/xterm.js',
  express.static(path.join(__dirname, 'node_modules/@xterm/xterm/lib/xterm.js'))
);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- pty handling ----
function spawnShell(cols = 80, rows = 30) {
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
  return pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });
}

wss.on('connection', (ws) => {
  const ptyProc = spawnShell();
  console.log(`[+] pty started pid=${ptyProc.pid}`);

  // pty -> browser
  const onData = (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  };
  ptyProc.onData(onData);
  ptyProc.onExit(({ exitCode, signal }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[31m[process exited code=${exitCode} signal=${signal}]\x1b[0m\r\n`);
      ws.close();
    }
  });

  // browser -> pty. Accepts raw strings (legacy) or JSON:
  //   {"type":"input","data":"ls\r"} | {"type":"resize","cols":80,"rows":24}
  ws.on('message', (msg) => {
    const text = msg.toString();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && parsed.type) {
        if (parsed.type === 'input' && typeof parsed.data === 'string') {
          ptyProc.write(parsed.data);
        } else if (parsed.type === 'resize') {
          const cols = Math.max(20, Math.min(300, parseInt(parsed.cols, 10) || 80));
          const rows = Math.max(5, Math.min(100, parseInt(parsed.rows, 10) || 30));
          ptyProc.resize(cols, rows);
        } else if (parsed.type === 'ping' && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }
    } catch {
      // not JSON -> treat as raw input
    }
    ptyProc.write(text);
  });

  ws.on('close', () => {
    console.log(`[-] ws closed, killing pty pid=${ptyProc.pid}`);
    try {
      ptyProc.kill();
    } catch {
      /* already dead */
    }
  });
  ws.on('error', () => {
    try {
      ptyProc.kill();
    } catch {
      /* noop */
    }
  });
});

server.listen(PORT, () => {
  if (process.env.MYC_QUIET) return; // `myc` CLI prints only the URL itself
  console.log(`Mobile terminal listening on http://localhost:${PORT}`);
  console.log('Open it on your phone (same network / forwarded port) and tap the terminal.');
});
