/* Measure the poster's real ink coverage: where the map sits on the canvas and
   whether the world map fills the slot like the Bangladesh map does. */
const { spawn } = require("child_process");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9447;
const BASE = "http://127.0.0.1:8123";
const PROFILE = "C:/MyMap/.chrome-profile-layout";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitDevtools() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error("no devtools");
}
async function openTab(url) {
  let r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error("open tab " + r.status);
  return await r.json();
}
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => res((method, params = {}) => new Promise((r2, rj) => {
      const i = ++id; pending.set(i, { r2, rj });
      ws.send(JSON.stringify({ id: i, method, params }));
    }));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { r2, rj } = pending.get(m.id); pending.delete(m.id);
        m.error ? rj(new Error(m.error.message)) : r2(m.result);
      }
    };
    ws.onerror = () => rej(new Error("ws failed"));
  });
}
async function evalJs(ws, expr, awaitPromise = false) {
  const r = await ws("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitReady(ws, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalJs(ws, "window.__READY===1")) return true;
    await sleep(250);
  }
  return false;
}
/* bbox of pixels that differ from the flat background colour */
const INK = `(() => {
  const cv = document.getElementById('cv');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const bg = [0xf6, 0xf2, 0xea];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const i = (y*cv.width + x)*4;
    if (Math.abs(d[i]-bg[0]) + Math.abs(d[i+1]-bg[1]) + Math.abs(d[i+2]-bg[2]) > 24) {
      n++; if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y;
    }
  }
  return { x0, y0, x1, y1, w: x1-x0+1, h: y1-y0+1, px: n };
})()`;
/* the map band only: rows 250..1290, i.e. the slot the map is drawn into */
const MAPBAND = `(() => {
  const cv = document.getElementById('cv');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 240, cv.width, 1060).data;
  const bg = [0xf6, 0xf2, 0xea];
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = 0; y < 1060; y++) for (let x = 0; x < cv.width; x++) {
    const i = (y*cv.width + x)*4;
    const dr = Math.abs(d[i]-bg[0]) + Math.abs(d[i+1]-bg[1]) + Math.abs(d[i+2]-bg[2]);
    if (dr > 40) { n++; if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
  }
  return { x0, x1, w: x1-x0+1, y0: y0+240, y1: y1+240, h: y1-y0+1, px: n };
})()`;

(async () => {
  require("fs").rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*",
    "--disable-gpu", "--hide-scrollbars", "--window-size=760,2400",
    `--user-data-dir=${PROFILE}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    await waitDevtools();
    const tab = await openTab(BASE + "/index.html");
    const ws = await connect(tab.webSocketDebuggerUrl);
    await ws("Page.enable"); await ws("Runtime.enable");
    await ws("Emulation.setDeviceMetricsOverride", { width: 760, height: 2400, deviceScaleFactor: 1, mobile: false });
    if (!(await waitReady(ws))) throw new Error("never ready");

    for (const [label, setup] of [
      ["BD demo (26 districts)", `document.getElementById('demoBtn').click()`],
      ["WORLD demo (14 countries)", `document.getElementById('tabW').click(); document.getElementById('demoWBtn').click()`],
    ]) {
      await evalJs(ws, setup + "; 'ok'");
      await sleep(900);
      const geo = await evalJs(ws, `({ gw: EN[mode].GEO.w, gh: EN[mode].GEO.h, gx: EN[mode].GEO.x, gy: EN[mode].GEO.y })`);
      const band = await evalJs(ws, MAPBAND);
      console.log(label);
      console.log("  GEO:", JSON.stringify(geo));
      console.log("  map band ink:", `x ${band.x0}..${band.x1} (w ${band.w})  y ${band.y0}..${band.y1} (h ${band.h})  fill ${(100*band.w/1120).toFixed(0)}% of slot width`);
    }
    /* open tabs back to BD for the final screenshot comparison */
    await evalJs(ws, `document.getElementById('tabBd').click(); document.getElementById('demoBtn').click(); 'ok'`);
    await sleep(700);
    const all = await evalJs(ws, INK);
    console.log("whole poster ink:", JSON.stringify(all));
  } finally {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    try { chrome.kill(); } catch {}
  }
})().then(() => process.exit(0)).catch(e => { console.error("FAIL:", e.message); process.exit(1); });