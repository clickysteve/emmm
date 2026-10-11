#!/usr/bin/env node
/**
 * Real-browser test of the Robots window (EXTENDED) in headless Chrome / Chromium — no extra
 * dependencies: it speaks the DevTools protocol over Node's built-in WebSocket.
 *
 *   npm run test:browser        (builds, serves dist/ with `vite preview`, runs this)
 *
 * A fake Web MIDI device is injected before the app loads: one output ("Fake Synth") that
 * records every message with its timestamp, and one input ("Fake Clock") the test feeds with
 * MIDI clock / Start / Stop / Continue. Everything else is the real app, driven by real mouse
 * and keyboard input events (Input.dispatchMouseEvent / dispatchKeyEvent) on the real controls.
 * This does not test real MIDI hardware.
 *
 * Environment: CHROME=/path/to/chrome to choose the browser; SHOTS=dir for screenshots
 * (default: a temporary folder, printed at the end); PORT (default 4179).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 4179);
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}/`;
const CANDIDATES = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome / Chromium found (set CHROME=/path/to/chrome).');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'emmm-browser-'));
const SHOTS = process.env.SHOTS || join(work, 'shots');
const DOWNLOADS = join(work, 'downloads');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DOWNLOADS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------------ processes

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => (cleanup(), process.exit(130)));

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {
      /* not yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await sleep(150);
  }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
children.push(server);
await waitHttp(BASE);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
children.push(chrome);
await waitHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json();

// ------------------------------------------------------------------ DevTools protocol

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let nextId = 1;
const pending = new Map();
const listeners = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  } else if (msg.method) (listeners.get(msg.method) ?? []).forEach((f) => f(msg.params));
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const on = (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f]);
const once = (method) => new Promise((res) => on(method, res));

const consoleErrors = [];
on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
on('Runtime.consoleAPICalled', (p) => p.type === 'error' && consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(' ')));
on('Log.entryAdded', (p) => p.entry.level === 'error' && !/favicon/.test(p.entry.url ?? '') && consoleErrors.push(`${p.entry.source}: ${p.entry.text}`));
let chooser = null;
on('Page.fileChooserOpened', (p) => (chooser = p));

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.setInterceptFileChooserDialog', { enabled: true });
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() => send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }));

// the fake Web MIDI device
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const sent = [];
    window.__midiOut = sent;
    const out = { id: 'fake-out', name: 'Fake Synth', manufacturer: 'emmm test', state: 'connected', type: 'output',
      send(data, ts) { sent.push({ data: Array.from(data), ts: ts ?? performance.now(), at: performance.now() }); } };
    const input = { id: 'fake-in', name: 'Fake Clock', manufacturer: 'emmm test', state: 'connected', type: 'input', onmidimessage: null };
    window.__midiIn = (bytes, ts) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(bytes), timeStamp: ts ?? performance.now() });
    const access = { inputs: new Map([['fake-in', input]]), outputs: new Map([['fake-out', out]]), onstatechange: null, sysexEnabled: false };
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: () => Promise.resolve(access) });
  })();`,
});

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
async function waitFor(expr, ms = 5000, what = expr) {
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(`!!(${expr})`)) return true;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(50);
  }
}
async function load(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  await waitFor('window.emmm && window.emmmUi', 8000);
  await sleep(300);
}
/** the centre of an element, in viewport CSS pixels */
async function centre(sel) {
  const r = await evaluate(`(() => { const e = ${sel}; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r) throw new Error(`no element: ${sel}`);
  return r;
}
/** a real mouse click (press and release) on what is really there: the element must be the
 * topmost thing at its centre (a covered control is an error, as it would be for a user) */
async function click(sel, opts = {}) {
  const p = await centre(sel);
  const visible = await evaluate(`(() => { const e = ${sel}; const t = document.elementFromPoint(${p.x + (opts.dx ?? 0)}, ${p.y + (opts.dy ?? 0)}); return !!t && (t === e || e.contains(t) || t.contains(e)); })()`);
  if (!visible && !opts.anyway) throw new Error(`covered or off screen: ${sel}`);
  const x = p.x + (opts.dx ?? 0);
  const y = p.y + (opts.dy ?? 0);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(opts.wait ?? 60);
}
const KEYCODES = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
/** a real key press; mods: 1 alt, 2 ctrl, 4 meta, 8 shift */
async function key(k, { code, mods = 0, text } = {}) {
  const c = code ?? (k === ' ' ? 'Space' : k.length === 1 ? (/[0-9]/.test(k) ? `Digit${k}` : /[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : '') : k);
  const vk = KEYCODES[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  const t = text ?? (k.length === 1 && !(mods & 7) ? k : undefined);
  await send('Input.dispatchKeyEvent', { type: t ? 'keyDown' : 'rawKeyDown', key: k, code: c, modifiers: mods, windowsVirtualKeyCode: vk, text: t, unmodifiedText: t });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: c, modifiers: mods, windowsVirtualKeyCode: vk });
  await sleep(40);
}
async function typeText(s) {
  for (const ch of s) await key(ch, { code: ch === '/' ? 'Slash' : undefined });
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
}
const W = `document.querySelector('[data-win="robots"]')`;
const inRobots = (q) => `${W}.querySelector(${JSON.stringify(q)})`;
const byText = (q, t) => `[...${W}.querySelectorAll(${JSON.stringify(q)})].find((e) => e.textContent === ${JSON.stringify(t)})`;
const tipped = (q, re) => `[...${W}.querySelectorAll(${JSON.stringify(q)})].filter((e) => ${re}.test(e.dataset.tip || e.title || ''))`;
async function chooseItem(selectorQuery, text) {
  await click(selectorQuery);
  await waitFor(`document.querySelector('.msel-list')`, 2000, 'pop-up list');
  await click(`[...document.querySelectorAll('.msel-item')].find((i) => i.textContent === ${JSON.stringify(text)})`, { wait: 120 });
}
/** the first differing paths of two JSON documents */
function diff(a, b) {
  const out = [];
  const walk = (x, y, p) => {
    if (out.length > 4) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object') for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`);
    else out.push(`${p}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  };
  walk(JSON.parse(a), JSON.parse(b), '');
  return out.join('; ');
}
const midiNotes = () => evaluate(`window.__midiOut.filter((m) => (m.data[0] & 0xf0) === 0x90 && m.data[2] > 0).length`);

// ------------------------------------------------------------------ the test

console.log(`emmm real-browser test — ${chromePath.split('/').pop()} (headless), fake MIDI device, ${BASE}`);
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await load(`${BASE}?new&seed=4242`);
  await evaluate(`document.querySelectorAll('.mdialog').forEach((d) => d.remove())`);
  check('app loads with the fake MIDI device', await evaluate(`emmm.midi.status === 'ready' && emmm.midi.outputs().some((o) => o.name === 'Fake Synth')`));
  await evaluate(`(() => { const s = emmm; s.comp.midi.outputs.forEach((o, i) => { o.port = 'fake-out'; o.channel = i + 1; }); s.comp.voices.forEach((v) => (v.playEnable = true)); s.comp.patternGroups[0].patterns.forEach((p, i) => { p.steps = [[60 + i * 3], [62 + i * 3], [64 + i * 3], [67 + i * 3]]; p.scrambled = [0, 1, 2, 3]; p.outputLength = 4; p.tbDen = 8; }); s.changed('midi'); })()`);

  // Extended on: Options ▸ Extended… ▸ Extended on
  await click(`[...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Options')`);
  await click(`[...document.querySelectorAll('.dropdown .item')].find((i) => i.firstElementChild.textContent.startsWith('Extended…'))`);
  await click(`[...document.querySelector('[data-win="extended"]').querySelectorAll('.num')].find((e) => /Extended on/.test(e.textContent))`);
  check('Extended switched on through its window', await evaluate(`emmm.comp.extended.enabled === true`));
  await click(`document.querySelector('[data-win="extended"] .close')`);

  // 1 open the Robots window: ⌥W
  await key('w', { code: 'KeyW', mods: 1 });
  check('1. ⌥W opens the Robots window', await evaluate(`!${W}.classList.contains('hidden')`));
  // window focus: clicking it brings it to the front
  await click(`document.querySelector('[data-win="patterns"] .titlebar')`, { dx: 40 });
  await click(`${W}.querySelector('.titlebar')`, { dx: 60 });
  check('window focus: a click brings it to the front', await evaluate(`Number(${W}.style.zIndex) === Math.max(...[...document.querySelectorAll('.mwin')].map((w) => Number(w.style.zIndex || 0)))`));

  // 2 enable Robot 2
  await click(inRobots('[aria-label="Robot 2 on / off"]'));
  check('2. Robot 2 switched on (overview toggle)', await evaluate(`emmm.comp.extended.robots[1].enabled === true && ${inRobots('[aria-label="Robot 2 on / off"]')}.getAttribute('aria-checked') === 'true'`));
  // disabled choice: Baton (M) is Robot 1 only
  await click(inRobots('.msel[aria-label="Robot 2 personality"]'));
  check('disabled controls: “Baton (M)” is disabled for Robot 2 and explains why', await evaluate(`[...document.querySelectorAll('.msel-item')].some((i) => i.textContent === 'Baton (M) — Robot 1 only' && i.classList.contains('disabled'))`));
  await key('Escape');
  // 3 personality
  await chooseItem(inRobots('.msel[aria-label="Robot 2 personality"]'), 'Drunk');
  check('3. personality chosen from the pop-up (Drunk)', await evaluate(`emmm.comp.extended.robots[1].personality === 'drunk'`));
  // 4 Variables: Note Density on, Legato off → Density + Velocity
  await click(byText('[role=switch]', 'Note Density'));
  await click(byText('[role=switch]', 'Legato'));
  check('4. Variables assigned (Note Density + Velocity)', await evaluate(`JSON.stringify(emmm.comp.extended.robots[1].variables) === '["noteDensity","velocityRange"]'`));
  // 5 rate: click the numerator box, type 1/8
  await click(`${tipped('[role=spinbutton]', '/Rate \\(M’s Time Base\\)/')}[0]`);
  await typeText('1/8');
  await key('Enter');
  check('5. rate typed as Time Base 1/8', await evaluate(`emmm.comp.extended.robots[1].rateNum === 1 && emmm.comp.extended.robots[1].rateDen === 8 && ${W}.textContent.includes('every 0.5 beat')`));
  // keyboard: a click does not take the focus (Space / Return stay the transport keys);
  // ⌥W on the open window moves the keyboard into it; arrows move; Enter / Space act; Escape leaves
  check('keyboard: a mouse click leaves the keys to the transport (no focus taken)', await evaluate(`!${W}.contains(document.activeElement) || document.activeElement.getAttribute('role') === 'spinbutton'`));
  await evaluate(`document.activeElement && document.activeElement.blur()`);
  await key('w', { code: 'KeyW', mods: 1 });
  check('keyboard: ⌥W again puts the focus in the window (on its tab)', await evaluate(`document.activeElement === ${byText('[role=tab]', 'ROBOT')}`));
  let hops = 0;
  while (hops < 60 && !(await evaluate(`document.activeElement === ${byText('[role=switch]', 'Rhythm')}`))) {
    await key('ArrowRight');
    hops++;
  }
  check('keyboard: → moves through the controls to the Rhythm toggle', hops < 60, `${hops} steps`);
  await key(' ');
  check('keyboard: Space on the focused toggle toggles it (no transport change)', await evaluate(`emmm.comp.extended.robots[1].variables.includes('rhythm') && emmm.engine.state === 'stopped'`));
  await key('Enter');
  check('keyboard: Enter toggles it back', await evaluate(`!emmm.comp.extended.robots[1].variables.includes('rhythm')`));
  await key('Escape');
  check('keyboard: Escape gives the keys back', await evaluate(`!${W}.contains(document.activeElement)`));
  await shot('01-robot-tab');

  // 6 Start (Space = Stop / Play)
  const notesBefore = await midiNotes();
  await key(' ');
  check('6. Space starts playback', await evaluate(`emmm.engine.state === 'playing'`));
  // 7 Robot movement
  await sleep(2500);
  const moves7 = await evaluate(`emmm.conductor.log.filter((l) => l.kind === 'move' && l.robot === 1).length`);
  check('7. Robot 2 moves in the music (log)', moves7 >= 5, `${moves7} moves in 2.5 s`);
  check('7. notes reach the fake MIDI output', (await midiNotes()) > notesBefore + 10);
  check('7. the overview shows its activity', await evaluate(`/Robot 2 \\d → \\d/.test(${inRobots('[role=log]')}.textContent)`));
  await shot('02-playing');

  // 8 weights: Note Density 1 3 5 only (via the WEIGHTS tab, typing; invalid values refused / clamped)
  await click(byText('[role=tab]', 'WEIGHTS'));
  await click(byText('[role=tab]', 'Dens'));
  for (const k of [1, 3, 5]) {
    await click(`${tipped('[role=spinbutton]', '/Note Density Position \\d: weight/')}[${k}]`);
    await typeText('0');
    await key('Enter');
  }
  await click(`${tipped('[role=spinbutton]', '/Note Density Position \\d: weight/')}[0]`);
  await typeText('999');
  await key('Enter');
  check('8. weights typed: Positions 2, 4, 6 excluded; 999 clamped to 100', await evaluate(`JSON.stringify(emmm.comp.extended.weights.noteDensity) === '[100,0,10,0,10,0]'`));
  await click(`${tipped('[role=spinbutton]', '/Note Density Position \\d: weight/')}[2]`); // (a click steps it, as in M)
  const w2 = await evaluate(`emmm.comp.extended.weights.noteDensity[2]`);
  await key('Enter');
  await typeText('-');
  await key('Enter');
  check('invalid values: “-” alone is refused (the box flashes, nothing changes)', await evaluate(`emmm.comp.extended.weights.noteDensity[2] === ${w2}`));
  await key('Escape');
  await evaluate(`document.activeElement.blur()`);
  await shot('03-weights');
  // 9 weighted behaviour, with a personality that chooses by weight (Restless: a weighted other Position)
  await click(byText('[role=tab]', 'ROBOT'));
  await chooseItem(inRobots('.msel[aria-label="Robot 2 personality"]'), 'Restless');
  await click(`${tipped('[role=spinbutton]', '/Restless: stays before a move is certain/')}[0]`);
  await typeText('1');
  await key('Enter');
  check('the personality’s own parameter is offered and typed (Restless patience 1)', await evaluate(`emmm.comp.extended.robots[1].params.patience === 1`));
  await evaluate(`document.activeElement.blur()`);
  const t9 = await evaluate(`emmm.engine.tick`);
  await sleep(4000);
  const landed = await evaluate(`emmm.conductor.log.filter((l) => l.tick > ${t9} && l.kind === 'move' && l.robot === 1).map((l) => Number(/→ (\\d)/.exec(l.text)[1]))`);
  check('9. Robot 2 only lands on allowed Positions (1, 3, 5)', landed.length > 3 && landed.every((p) => [1, 3, 5].includes(p)), landed.join(' '));
  const ones = landed.filter((p) => p === 1).length;
  check('9. the heavy Position (weight 100) is the most frequent', ones > landed.filter((p) => p === 3).length && ones > landed.filter((p) => p === 5).length, `1:${ones} 3:${landed.filter((p) => p === 3).length} 5:${landed.filter((p) => p === 5).length}`);

  // stop, then Rules
  await key(' ');
  check('Space stops', await evaluate(`emmm.engine.state === 'stopped'`));
  // 10 add and edit a Rule
  await click(byText('[role=tab]', 'RULES'));
  await click(byText('.btn', '+ New Rule'));
  await chooseItem(inRobots('.msel[aria-label="Condition"]'), 'Variable enters Position');
  await chooseItem(inRobots('.msel[aria-label="Variable"]'), 'Note Density');
  await click(`${tipped('[role=spinbutton]', '/Position 1–6/')}[0]`);
  await typeText('5');
  await key('Enter');
  await chooseItem(inRobots('.msel[aria-label="Action"]'), 'Set Variable Position');
  await chooseItem(`${W}.querySelectorAll('.msel[aria-label="Variable"]')[1]`, 'Legato');
  await click(`${tipped('[role=spinbutton]', '/Position 1–6/')}[1]`);
  await typeText('6');
  await key('Enter');
  await evaluate(`document.activeElement.blur()`);
  check('10. Rule added and edited through the editor', await evaluate(`JSON.stringify(emmm.comp.extended.rules[0]) === JSON.stringify({ on: true, when: { kind: 'variableAt', variable: 'noteDensity', position: 4 }, every: 1, then: { kind: 'setPosition', variable: 'legato', position: 5 }, at: 'now' })`));
  check('10. the Rule reads WHEN … → THEN …', await evaluate(`${W}.textContent.includes('WHEN Note Density enters Position 5 → THEN Legato → Position 6')`));
  // 11 trigger it by hand while stopped: click Density Position 5 in the Variables window (the
  // Robots window covers it on emmm's 720-pixel screen: close it, click, open it again)
  const n11 = await midiNotes();
  await click(`${W}.querySelector('.close')`);
  await click(`document.querySelector('.pos[data-var="noteDensity"][data-pos="0"]')`, { wait: 400 });
  await click(`document.querySelector('.pos[data-var="noteDensity"][data-pos="4"]')`, { wait: 400 });
  await key('w', { code: 'KeyW', mods: 1 });
  check('11. a manual change fires the Rule at once while stopped', await evaluate(`emmm.comp.noteDensity.active === 4 && emmm.comp.legato.active === 5 && emmm.engine.state === 'stopped'`));
  check('11. … without starting playback or making notes', (await midiNotes()) === n11);
  check('11. the Rule shows that it fired', await evaluate(`/×1/.test(${W}.textContent)`));
  await shot('04-rules');

  // 12 Home
  await click(byText('[role=tab]', 'HOME'));
  await click(`${W}.querySelector('.close')`);
  await click(`document.querySelector('.pos[data-var="noteDensity"][data-pos="0"]')`, { wait: 400 });
  await key('w', { code: 'KeyW', mods: 1 });
  await click(byText('.btn', 'Capture Home'));
  check('12. Home captured', await evaluate(`emmm.comp.extended.home.positions && emmm.comp.extended.home.positions.noteDensity === 0 && ${W}.textContent.includes('At Home')`));
  // 13 move away
  await click(`${W}.querySelector('.close')`);
  await click(`document.querySelector('.pos[data-var="noteDensity"][data-pos="5"]')`, { wait: 400 });
  await click(`document.querySelector('.pos[data-var="transposition"][data-pos="3"]')`, { wait: 400 });
  await key('w', { code: 'KeyW', mods: 1 });
  check('13. moved away from Home', await evaluate(`emmm.conductor.distance() > 0 && /steps? from Home/.test(${W}.textContent)`));
  // 15 setup: a Trajectory on Density Positions (it must not write while Density is Returning)
  await evaluate(`(() => { emmm.setTrajectory(0, { on: true, target: { kind: 'position', variable: 'noteDensity' }, values: [6, 4, 2], rateNum: 1, rateDen: 16 }); emmm.setRobotEnabled(1, false); emmm.setReturnSettings({ num: 2, den: 1, rest: 4, immediate: false }); })()`);
  // 14 Return Home while playing
  await key(' ');
  await sleep(300);
  await click(byText('.btn', 'RETURN HOME'));
  check('14. RETURN HOME starts a gradual Return', await evaluate(`!!emmm.conductor.ret && ${W}.textContent.includes('RETURNING')`));
  await evaluate(`(() => { window.__dens = []; const s = emmm; const t0 = performance.now(); window.__sampler = setInterval(() => window.__dens.push({ t: s.scheduler.nowTick(), d: s.comp.noteDensity.active, ret: !!s.conductor.ret, owned: s.conductor.owns('noteDensity', s.scheduler.nowTick()) }), 20); })()`);
  await shot('05-returning');
  await waitFor(`!emmm.conductor.ret`, 8000, 'Return to complete');
  check('14. Return completes (progress, log)', await evaluate(`emmm.conductor.log.some((l) => l.text.startsWith('Return complete')) && emmm.comp.noteDensity.active === 0`));
  await sleep(1200);
  await evaluate(`clearInterval(window.__sampler)`);
  const samples = await evaluate(`window.__dens`);
  const owned = samples.filter((x) => x.owned);
  const seq = owned.map((x) => x.d).filter((d, i, a) => i === 0 || d !== a[i - 1]);
  const values = [100, 80, 60, 40, 20, 10];
  const dens = await evaluate(`emmm.comp.noteDensity.positions.map((p) => p.reduce((a, b) => a + b, 0) / 4)`);
  const monotone = seq.every((d, i) => i === 0 || Math.abs(dens[d] - dens[0]) < Math.abs(dens[seq[i - 1]] - dens[0]) || d === 0);
  check('15. while Returning / resting, the Trajectory never wrote Density (it only moved toward Home)', owned.length > 10 && monotone, `path ${seq.map((d) => d + 1).join('→')}`);
  void values;
  // 16 rest: still Home for the rest period, owned, then free
  const restHome = owned.filter((x) => !x.ret).every((x) => x.d === 0);
  check('16. rest period: Density stays Home after the Return (owned)', restHome && owned.some((x) => !x.ret));
  await sleep(2400);
  check('16. after the rest the Trajectory moves Density again', await evaluate(`!emmm.conductor.owns('noteDensity') && emmm.comp.noteDensity.active !== 0`));
  await evaluate(`emmm.setTrajectory(0, { on: false })`);
  await key(' ');

  // 17–19 save, reload, check
  const conf = await evaluate(`JSON.stringify({ r: emmm.comp.extended.robots, w: emmm.comp.extended.weights, rules: emmm.comp.extended.rules, h: emmm.comp.extended.home, rs: emmm.comp.extended.returnSettings })`);
  await key('s', { code: 'KeyS', mods: process.platform === 'darwin' ? 4 : 2 });
  let file = null;
  for (let i = 0; i < 40 && !file; i++) {
    await sleep(100);
    file = readdirSync(DOWNLOADS).find((f) => f.endsWith('.emmm.json'));
  }
  check('17. File ▸ Save (⌘S) downloads the document', !!file, file ?? 'nothing downloaded');
  const saved = file ? JSON.parse(readFileSync(join(DOWNLOADS, file), 'utf8')) : null;
  check('17. it is format 5 and holds the Robots, weights, Rules and Home', !!saved && saved.version === 5 && saved.composition.extended.rules.length === 1 && saved.composition.extended.weights.noteDensity[1] === 0);
  // 18 reload the page (autosave), then also open the saved file into a fresh document
  await evaluate(`emmm.changed('conductors')`);
  await sleep(1700); // the autosave writes every ~1.5 s after a change
  await load(BASE);
  const after = await evaluate(`JSON.stringify({ r: emmm.comp.extended.robots, w: emmm.comp.extended.weights, rules: emmm.comp.extended.rules, h: emmm.comp.extended.home, rs: emmm.comp.extended.returnSettings })`);
  check('18. reload: the autosaved project comes back', diff(conf, after) === '', diff(conf, after));
  await evaluate(`document.querySelectorAll('.mdialog').forEach((d) => d.remove())`);
  // dialog behaviour: File ▸ New asks first (an emmm dialog); OK
  await click(`[...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'File')`);
  await click(`[...document.querySelectorAll('.dropdown .item')].find((i) => i.firstElementChild.textContent === 'New')`);
  check('dialogs: File ▸ New asks in an emmm dialog', await evaluate(`!!document.querySelector('.mdialog')`));
  await key('Enter');
  await sleep(200);
  check('dialogs: confirming gives a new document (no Rules)', await evaluate(`emmm.comp.extended.rules.length === 0`));
  if (file) {
    chooser = null;
    await key('o', { code: 'KeyO', mods: process.platform === 'darwin' ? 4 : 2 });
    for (let i = 0; i < 30 && !chooser; i++) await sleep(100);
    if (chooser) await send('DOM.setFileInputFiles', { files: [join(DOWNLOADS, file)], backendNodeId: chooser.backendNodeId });
    await waitFor(`emmm.comp.extended.rules.length === 1`, 4000, 'the opened file');
  }
  const opened = await evaluate(`JSON.stringify({ r: emmm.comp.extended.robots, w: emmm.comp.extended.weights, rules: emmm.comp.extended.rules, h: emmm.comp.extended.home, rs: emmm.comp.extended.returnSettings })`);
  check('19. File ▸ Open of the saved file restores the whole configuration', diff(conf, opened) === '', diff(conf, opened));
  await key('w', { code: 'KeyW', mods: 1 });

  // 20–21 Classic
  await evaluate(`(() => { emmm.setRobotEnabled(1, true); emmm.setRobotEnabled(2, true); })()`);
  await click(`[...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Options')`);
  await click(`[...document.querySelectorAll('.dropdown .item')].find((i) => i.firstElementChild.textContent.startsWith('Extended…'))`);
  await click(`[...document.querySelector('[data-win="extended"]').querySelectorAll('.num')].find((e) => /Extended on/.test(e.textContent))`);
  check('20. switched to Classic (Extended off)', await evaluate(`emmm.comp.extended.enabled === false && emmm.engine.observer === null && emmm.engine.robotGate === null`));
  const logN = await evaluate(`emmm.conductor.log.length`);
  const posBefore = await evaluate(`JSON.stringify([emmm.comp.noteDensity.active, emmm.comp.velocityRange.active, emmm.comp.transposition.active])`);
  await key(' ');
  await sleep(1500);
  check('21. Classic: the Robots do nothing, the music plays', (await evaluate(`emmm.conductor.log.length`)) === logN && (await evaluate(`JSON.stringify([emmm.comp.noteDensity.active, emmm.comp.velocityRange.active, emmm.comp.transposition.active])`)) === posBefore && (await evaluate(`emmm.engine.state === 'playing'`)));
  await key(' ');
  await click(`[...document.querySelector('[data-win="extended"]').querySelectorAll('.num')].find((e) => /Extended on/.test(e.textContent))`);
  await click(`document.querySelector('[data-win="extended"] .close')`);

  // 22 Pause / Continue / Stop (Return = Play / Pause, Space = Stop / Play)
  await key('Enter');
  await sleep(800);
  await key('Enter');
  check('22. Return pauses', await evaluate(`emmm.engine.state === 'paused'`));
  const pausedLog = await evaluate(`emmm.conductor.log.length`);
  const pausedTick = await evaluate(`emmm.engine.tick`);
  await sleep(800);
  check('22. paused: no Robot moves, no time passes', (await evaluate(`emmm.conductor.log.length`)) === pausedLog && (await evaluate(`emmm.engine.tick`)) === pausedTick);
  await key('Enter');
  await sleep(800);
  check('22. Return continues; the Robots go on', await evaluate(`emmm.engine.state === 'playing' && emmm.conductor.log.length > ${pausedLog}`));
  await key(' ');
  check('22. Space stops (back to the beginning)', await evaluate(`emmm.engine.state === 'stopped' && emmm.engine.tick === 0`));

  // 23 external MIDI clock from the fake input
  await evaluate(`(() => { const c = emmm.comp.midi.clockIn; c.enabled = true; c.port = 'fake-in'; c.transport = true; emmm.changed('midi'); })()`);
  // 100 bpm nominally; a timer in a headless page jitters, so compare with the rate really sent
  // pulses at 100 bpm, each stamped with its exact time (as a MIDI input's timestamps are),
  // delivered by a timer that catches up — so the clock is steady even if the timer is not
  await evaluate(`(() => { window.__midiIn([0xfa]); const t0 = performance.now(); let i = 0; window.__clk = setInterval(() => { while (t0 + i * 25 <= performance.now()) window.__midiIn([0xf8], t0 + 25 * i++); }, 5); })()`);
  await sleep(3000);
  const tempo = await evaluate('emmm.comp.tempo.value');
  check('23. external clock: FA starts emmm; the tempo follows the clock (100 bpm)', (await evaluate(`emmm.engine.state === 'playing'`)) && Math.abs(tempo - 100) < 4, `followed ${tempo.toFixed(1)} bpm`);
  check('23. external clock: the Robots move', await evaluate(`emmm.conductor.log.filter((l) => l.kind === 'move').length > 0`));
  await evaluate(`window.__midiIn([0xfc])`);
  await sleep(300);
  const haltLog = await evaluate(`emmm.conductor.log.length`);
  await sleep(600);
  check('23. FC halts (place kept, Robots still)', await evaluate(`emmm.engine.state === 'paused' && emmm.extHalted && emmm.conductor.log.length === ${haltLog}`));
  await evaluate(`window.__midiIn([0xfb])`);
  await sleep(1000);
  check('23. FB continues', await evaluate(`emmm.engine.state === 'playing'`));
  await evaluate(`clearInterval(window.__clk); window.__midiIn([0xfc])`);
  await sleep(300);
  await key(' '); // stop (from halted)
  await sleep(300);
  await evaluate(`(() => { emmm.comp.midi.clockIn.enabled = false; })()`);

  // 24 no stuck notes, no unexpected transport messages to the synth
  await sleep(400);
  const balance = await evaluate(`(() => { const open = new Map(); for (const m of window.__midiOut) { const k = m.data[0] & 0xf0; if (k !== 0x90 && k !== 0x80) continue; const key = (m.data[0] & 15) + ':' + m.data[1]; const on = k === 0x90 && m.data[2] > 0; open.set(key, Math.max(0, (open.get(key) || 0) + (on ? 1 : -1))); } return [...open.values()].filter((v) => v > 0).length; })()`);
  check('24. no stuck notes: every note-on was ended', balance === 0, `${balance} hanging`);
  const transport = await evaluate(`window.__midiOut.filter((m) => [0xfa, 0xfb, 0xfc, 0xf8].includes(m.data[0])).length`);
  check('24. no transport or clock messages sent to the synth (Send Clock is off)', transport === 0, `${transport} sent`);

  // undo / redo by keyboard
  await click(byText('[role=tab]', 'ROBOT'));
  await evaluate(`emmm.history.commit()`);
  await chooseItem(inRobots('.msel[aria-label="Robot 2 personality"]'), 'Chaotic');
  await sleep(400);
  const mod = process.platform === 'darwin' ? 4 : 2;
  await key('z', { code: 'KeyZ', mods: mod });
  check('undo (⌘Z / Ctrl+Z) takes the personality back', await evaluate(`emmm.comp.extended.robots[1].personality !== 'chaotic'`));
  await key('z', { code: 'KeyZ', mods: mod | 8 });
  check('redo (⇧⌘Z) puts it again', await evaluate(`emmm.comp.extended.robots[1].personality === 'chaotic'`));

  // smaller window: the whole screen scales; the Robots window stays inside the viewport
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const fits = await evaluate(`(() => { const r = ${W}.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()`);
  check('smaller browser window (900 × 600): the Robots window is fully visible', fits);
  await click(byText('[role=tab]', 'HOME'));
  await shot('06-small-window-home');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await shot('07-final');

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run completed', false, String(e?.stack ?? e));
  await shot('error').catch(() => {});
}

console.log(`\n${results.length - failed} / ${results.length} checks passed. Screenshots: ${SHOTS}`);
ws.close();
cleanup();
process.exit(failed ? 1 : 0);
