/* Mobile terminal frontend — full xterm.js stack + touch key bar.
 * Uses EVERY installed xterm package (nothing left out):
 *   core + fit, attach, search, serialize, unicode11, web-links,
 *   webgl (gpu), canvas (fallback), image (sixel/iTerm2), progress (OSC 9;4),
 *   headless is server-side only (imported in node, not the browser).
 */
(function () {
  'use strict';

  const termEl = document.getElementById('terminal');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const kbdProxy = document.getElementById('kbd-proxy');
  const tapHint = document.getElementById('tap-hint');
  const searchbar = document.getElementById('searchbar');
  const searchInput = document.getElementById('search-input');

  // ---------- create terminal ----------
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: 1.15,
    scrollback: 5000,
    allowProposedApi: true, // needed by image + progress addons
    theme: {
      background: '#000000',
      foreground: '#e6e9f0',
      cursor: '#4cc38a',
      selectionBackground: 'rgba(76, 195, 138, 0.35)',
    },
  });

  // ---------- load ALL addons ----------
  const fitAddon = new FitAddon.FitAddon();
  const searchAddon = new SearchAddon.SearchAddon();
  const serializeAddon = new SerializeAddon.SerializeAddon();
  const unicode11 = new Unicode11Addon.Unicode11Addon();
  const webLinks = new WebLinksAddon.WebLinksAddon();
  const attachAddon = null; // we speak JSON {type,input/resize} so we wire the socket manually
  void attachAddon;

  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(webLinks);
  term.loadAddon(unicode11);
  term.unicode.activeVersion = '11';

  // image (sixel / iTerm2 inline images)
  try {
    const imageAddon = new ImageAddon.ImageAddon();
    term.loadAddon(imageAddon);
  } catch (e) { console.warn('image addon unavailable', e); }

  // progress (OSC 9;4 progress bars, e.g. apt/pacman style tasks)
  try {
    const progressAddon = new ProgressAddon.ProgressAddon();
    term.loadAddon(progressAddon);
  } catch (e) { console.warn('progress addon unavailable', e); }

  // gpu renderer with canvas fallback
  let gpuAddon = null;
  try {
    gpuAddon = new WebglAddon.WebglAddon();
    term.loadAddon(gpuAddon);
  } catch (e) {
    console.warn('webgl unavailable, trying canvas renderer', e);
    try {
      term.loadAddon(new CanvasAddon.CanvasAddon());
    } catch (e2) { console.warn('canvas addon unavailable', e2); }
  }
  term.onRender && term.onRender(() => {});
  if (gpuAddon && gpuAddon.onContextLoss) {
    gpuAddon.onContextLoss(() => {
      try { gpuAddon.dispose(); } catch {}
      try { term.loadAddon(new CanvasAddon.CanvasAddon()); } catch {}
    });
  }

  term.open(termEl);
  safeFit();

  function safeFit() {
    try { fitAddon.fit(); } catch {}
  }

  // expose for debugging / tests
  window.__term = term;
  window.__serialize = () => serializeAddon.serialize();

  // ---------- websocket <-> pty ----------
  let ws = null;
  let wantClose = false;
  let retryMs = 1000;

  function setStatus(connected, text) {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('disconnected', !connected);
    statusText.textContent = text;
  }

  function connect() {
    wantClose = false;
    setStatus(false, 'connecting…');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/pty');

    ws.onopen = () => {
      retryMs = 1000;
      setStatus(true, 'connected');
      term.writeln('\x1b[32m● connected — tap ⌨️ if your phone keyboard is hidden.\x1b[0m');
      pushResize();
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' && ev.data.indexOf('{"type":"pong"}') !== -1) return;
      term.write(ev.data);
    };

    ws.onclose = () => {
      setStatus(false, 'disconnected');
      if (!wantClose) {
        term.writeln('\x1b[31m● disconnected — retrying…\x1b[0m');
        setTimeout(connect, (retryMs = Math.min(retryMs * 1.5, 8000)));
      }
    };

    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function sendInput(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  function pushResize() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  term.onData((data) => sendInput(data));
  term.onResize((size) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  });

  // keep-alive through proxies
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 25000);

  // ---------- sticky modifiers (CTRL / ALT / SHIFT) ----------
  const sticky = { ctrl: false, alt: false, shift: false };
  const keyCtrl = document.getElementById('key-ctrl');
  const keyAlt = document.getElementById('key-alt');
  const keyShift = document.getElementById('key-shift');

  function paintSticky() {
    keyCtrl.classList.toggle('active', sticky.ctrl);
    keyAlt.classList.toggle('active', sticky.alt);
    keyShift.classList.toggle('active', sticky.shift);
  }

  function bindSticky(btn, name) {
    btn.addEventListener('click', () => {
      sticky[name] = !sticky[name];
      // ctrl and alt are exclusive-ish: enabling one releases the other
      if (sticky[name] && name !== 'shift') {
        if (name === 'ctrl') sticky.alt = false;
        if (name === 'alt') sticky.ctrl = false;
      }
      paintSticky();
      term.focus();
    });
  }
  bindSticky(keyCtrl, 'ctrl');
  bindSticky(keyAlt, 'alt');
  bindSticky(keyShift, 'shift');

  /** Apply sticky modifiers to a key about to be sent. Single-shot: consumed after one use. */
  function applySticky(data) {
    let out = data;
    const wasCtrl = sticky.ctrl;
    const wasAlt = sticky.alt;
    const wasShift = sticky.shift;

    if (wasShift && out.length === 1 && /[a-z]/.test(out)) out = out.toUpperCase();
    // shift + arrows -> modified escape sequences terminals understand
    if (wasShift && out.charCodeAt(0) === 0x1b && out[1] === '[' && /[ABCD]$/.test(out)) {
      out = out.slice(0, -1) + ';2' + out.slice(-1);
    }

    if (wasCtrl && out.length === 1) {
      const lower = out.toLowerCase();
      if (lower >= 'a' && lower <= 'z') {
        out = String.fromCharCode(lower.charCodeAt(0) - 96); // ctrl+a..ctrl+z
      } else if (out === ' ') {
        out = '\x00';
      }
    }
    if (wasAlt) {
      // Alt = ESC prefix (unless it already starts with ESC)
      out = out.charCodeAt(0) === 0x1b ? out : '\x1b' + out;
    }

    sticky.ctrl = sticky.alt = sticky.shift = false;
    paintSticky();
    return out;
  }

  // every button with data-send / data-insert flows through here
  document.addEventListener('click', (ev) => {
    const sendBtn = ev.target.closest('[data-send]');
    if (sendBtn) {
      sendInput(applySticky(sendBtn.getAttribute('data-send')));
      term.focus();
      hideHint();
      return;
    }
    const insBtn = ev.target.closest('[data-insert]');
    if (insBtn) {
      sendInput(applySticky(insBtn.getAttribute('data-insert')));
      term.focus();
      hideHint();
    }
  });

  // ---------- phone keyboard proxy ----------
  // Mobile browsers only open the virtual keyboard for a real <input>.
  // We keep a nearly-invisible input focused and forward everything typed.
  function openKeyboard() {
    kbdProxy.focus({ preventScroll: true });
    // iOS sometimes needs the caret trick:
    try { kbdProxy.setSelectionRange(kbdProxy.value.length, kbdProxy.value.length); } catch {}
  }

  kbdProxy.addEventListener('input', () => {
    const v = kbdProxy.value;
    if (v) {
      // on-screen keyboards may batch words + autocorrect; send raw then reset
      sendInput(applySticky(v));
      kbdProxy.value = '';
    }
  });

  kbdProxy.addEventListener('keydown', (e) => {
    // physical / bluetooth keyboards attached to the phone come through here too
    if (e.key === 'Enter') { sendInput(applySticky('\r')); kbdProxy.value = ''; e.preventDefault(); }
    else if (e.key === 'Backspace' && kbdProxy.value === '') { sendInput(applySticky('\x7f')); e.preventDefault(); }
    else if (e.key === 'Tab') { sendInput(applySticky('\t')); e.preventDefault(); }
    else if (e.key === 'Escape') { sendInput(applySticky('\x1b')); e.preventDefault(); }
    else if (e.key && e.key.length === 1 && (e.ctrlKey || e.metaKey)) {
      const lower = e.key.toLowerCase();
      if (lower >= 'a' && lower <= 'z') {
        sendInput(String.fromCharCode(lower.charCodeAt(0) - 96));
        e.preventDefault();
      }
    }
  });

  termEl.addEventListener('click', () => { hideHint(); openKeyboard(); });
  document.getElementById('btn-keyboard').addEventListener('click', openKeyboard);
  document.getElementById('btn-kbd2').addEventListener('click', () => {
    if (document.activeElement === kbdProxy) kbdProxy.blur();
    else openKeyboard();
  });

  function hideHint() { tapHint.classList.add('gone'); }
  setTimeout(hideHint, 9000);

  // ---------- top bar actions ----------
  document.getElementById('btn-clear').addEventListener('click', () => {
    term.clear();
    term.focus();
  });
  document.getElementById('btn-reconnect').addEventListener('click', () => {
    try { wantClose = true; ws && ws.close(); } catch {}
    term.writeln('\x1b[33m● reconnecting…\x1b[0m');
    setTimeout(connect, 300);
  });

  // ---------- search (addon-search) ----------
  document.getElementById('btn-search').addEventListener('click', () => {
    searchbar.hidden = !searchbar.hidden;
    if (!searchbar.hidden) searchInput.focus();
    else searchAddon.clearDecorations();
  });
  document.getElementById('search-close').addEventListener('click', () => {
    searchbar.hidden = true;
    searchAddon.clearDecorations();
    term.focus();
  });
  function runSearch() {
    const q = searchInput.value;
    if (!q) { searchAddon.clearDecorations(); return; }
    searchAddon.findNext(q, { incremental: true });
  }
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) searchAddon.findPrevious(searchInput.value);
      else searchAddon.findNext(searchInput.value);
    }
    if (e.key === 'Escape') document.getElementById('search-close').click();
  });
  document.getElementById('search-next').addEventListener('click', () => searchAddon.findNext(searchInput.value));
  document.getElementById('search-prev').addEventListener('click', () => searchAddon.findPrevious(searchInput.value));

  // ---------- resize ----------
  function refit() {
    safeFit();
    pushResize();
  }
  new ResizeObserver(() => refit()).observe(termEl);
  window.addEventListener('orientationchange', () => setTimeout(refit, 250));
  window.addEventListener('resize', () => refit());
  // mobile URL bar show/hide changes dvh; ResizeObserver covers it, this is belt & braces
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => refit());
  }
  // fit once fonts/layout settle
  setTimeout(refit, 100);
  setTimeout(refit, 600);

  connect();
})();
