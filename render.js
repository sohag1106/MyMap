/* Deterministic frame capture: drives animate.html via Chrome DevTools Protocol, no AI involved. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9444;
const W = 1200, H = 1600, FPS = 30, DUR = 12;
const OUT = "C:/MyMap/frames";
const PROFILE = "C:/MyMap/.chrome-profile";
const URL_PAGE = "file:///C:/MyMap/animate.html?render=1";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint did not come up");
}

async function openTab(url) {
  // Newer Chrome requires PUT for /json/new; older accepts GET.
  let r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error("failed to open tab: " + r.status);
  return await r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
          const { res, rej } = pending.get(m.id);
          pending.delete(m.id);
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
      };
      ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error("ws closed")); pending.clear(); };
      resolve(send);
    };
    ws.onerror = () => reject(new Error("ws connect failed"));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    `--window-size=${W},${H}`,
    "--force-device-scale-factor=1",
    "--allow-file-access-from-files",
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], { stdio: "ignore" });

  let ws, tab;
  try {
    await waitDevtools();
    tab = await openTab(URL_PAGE);
    ws = await connect(tab.webSocketDebuggerUrl);

    await ws("Page.enable");
    await ws("Runtime.enable");
    await ws("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    // wait for page-ready gate (fonts + photo + label layout)
    let ready = false;
    for (let i = 0; i < 160; i++) {
      try {
        const r = await ws("Runtime.evaluate", { expression: "window.__READY===1", returnByValue: true });
        if (r.result && r.result.value) { ready = true; break; }
      } catch {}
      await sleep(200);
    }
    if (!ready) {
      const err = await ws("Runtime.evaluate", { expression: "String(window.__ERR||'')", returnByValue: true }).catch(() => null);
      throw new Error("page never became ready " + (err && err.result ? err.result.value : ""));
    }

    const N = Math.round(DUR * FPS);
    const t0 = Date.now();
    for (let f = 1; f <= N; f++) {
      const t = (f - 1) / FPS;
      const ev = await ws("Runtime.evaluate", { expression: `SEEK(${t.toFixed(4)})`, returnByValue: true });
      if (ev.exceptionDetails) throw new Error("SEEK failed: " + JSON.stringify(ev.exceptionDetails));
      const shot = await ws("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, `frame_${String(f).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
      if (f % 30 === 0 || f === N) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`frame ${f}/${N}  (${el}s)`);
      }
    }
    console.log("DONE", N, "frames");
  } finally {
    // kill only this headless instance's process tree, never other Chrome windows
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    try { chrome.kill(); } catch {}
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
