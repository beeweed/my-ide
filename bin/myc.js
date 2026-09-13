#!/usr/bin/env node
/* `myc` — start the mobile-friendly cloud terminal, print only its frontend URL. */
import net from 'net';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: myc [--port <n>]\n\nStart the mobile terminal server and print its frontend URL.');
  process.exit(0);
}

if (args.includes('-V') || args.includes('--version')) {
  try {
    console.log(JSON.parse(readFileSync(pkgPath, 'utf8')).version);
  } catch {
    console.log('unknown');
  }
  process.exit(0);
}

function flagValue(names) {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i]) && args[i + 1] !== undefined) return args[i + 1];
    if (names.includes('--port')) {
      const m = /^--port=(\d+)$/.exec(args[i]);
      if (m) return m[1];
    }
  }
  return undefined;
}

function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

const explicitPort = flagValue(['-p', '--port']) ?? process.env.PORT;
const wanted = parseInt(explicitPort ?? '3000', 10) || 3000;

let port = wanted;
if (explicitPort !== undefined) {
  if (!(await isFree(port))) {
    console.error(`error: port ${port} is already in use`);
    process.exit(1);
  }
} else {
  while (!(await isFree(port))) {
    port++;
    if (port > wanted + 50) {
      console.error(`error: no free port found near ${wanted}`);
      process.exit(1);
    }
  }
}

process.env.PORT = String(port);
process.env.MYC_QUIET = '1';
await import('../server.js');

// Wait until the server is actually reachable, then expose ONLY the frontend URL.
const deadline = Date.now() + 15000;
let up = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (res.ok) {
      up = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 150));
}

if (!up) {
  console.error('error: server did not start in time');
  process.exit(1);
}

console.log(`http://localhost:${port}`);
