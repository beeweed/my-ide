# my-ide — mobile-friendly cloud terminal

Fix for phone users who can't use the terminal inside cloud-hosted VS Code:
a full [xterm.js](https://xtermjs.org) terminal in the browser with a touch
key bar (CTRL, ALT, SHIFT, ESC, TAB, arrows, Home/End, PgUp/PgDn, backspace,
delete, Ctrl+C/D/Z/…, F1–F12, programming symbols) next to it.

## Install & run (npm package)

```bash
npm install -g my-ide-mobile-terminal
myc
```
or

```bash
npm install -g --allow-scripts=node-pty my-ide-mobile-terminal
myc
```

`myc` starts the app and prints only the frontend URL, e.g.
`http://localhost:3000`. Options: `myc --port 4000`, `myc --help`.

On the phone: tap ✂️ for select mode (drag to select text), ⧉ for
select-all, 📋 to copy, 📥 to paste, and tap any URL to open it in a
new browser tab.

## Run from source

```bash
npm install
npm start
```

Open `http://localhost:3000` on your phone (same Wi-Fi, or forward the port
with the VS Code **Ports** panel). Tap the terminal, then type with your
phone keyboard (⌨️ button) or the side keys.

## How it works

- `server.js` — Express static server + WebSocket (`/pty`) bridge to a real
  shell spawned with `node-pty`. Every installed xterm.js bundle is served
  locally from `node_modules`, no CDN.
- `public/` — mobile UI: **left** PC-key bar, **middle** xterm.js terminal,
  symbol quick-bar on top, thumb bar at the bottom. All xterm.js packages
  are loaded: core, fit, attach, search, serialize, unicode11, web-links,
  webgl (+ canvas fallback), image, progress.
  version = 1.1.0
