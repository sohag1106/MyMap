/* One-off live-site check: caption URL after /video.html → /video redirect + root loads. */
const { spawn } = require("child_process");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9446;
const PROFILE = "C:/MyMap/.chrome-profile-live";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

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
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push("EXCEPTION: " + ((d.exception && d.exception.description) || d.text));
      }
      if (m.id && pending.has(m.id)) {
        const { r2, rj } = pending.get(m.id); pending.delete(m.id);
        m.error ? rj(new Error(m.error.message)) : r2(m.result);
      }
    };
    ws.onerror = () => rej(new Error("ws failed"));
  });
}
async function evalJs(ws, expr) {
  const r = await ws("Runtime.evaluate", { expression: expr, returnByValue: true });
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

(async () => {
  require("fs").rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*",
    "--disable-gpu", "--hide-scrollbars", "--window-size=760,1400",
    `--user-data-dir=${PROFILE}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    await waitDevtools();
    const tab = await openTab("https://mymap.brightskyit.com/video.html?still=1&mode=bd");
    const ws = await connect(tab.webSocketDebuggerUrl);
    await ws("Page.enable"); await ws("Runtime.enable");
    if (!(await waitReady(ws))) throw new Error("video page never ready");
    const v = await evalJs(ws, `({
      path: location.pathname, href: location.href,
      cap: document.getElementById("cap").value,
      title: document.title
    })`);
    console.log("video page:", v.path, "| title:", v.title);
    const cap = v.cap;
    console.log("caption link line:", (cap.match(/👉 (\S+)/) || ["MISSING", "?"])[1]);
    if (!cap.includes("mymap.brightskyit.com")) throw new Error("caption URL wrong: " + cap);

    await ws("Page.navigate", { url: "https://mymap.brightskyit.com/" });
    await sleep(500);
    if (!(await waitReady(ws))) throw new Error("root page never ready");
    const root = await evalJs(ws, `({
      path: location.pathname, title: document.title,
      demo: !!document.getElementById("demoBtn"),
      tabW: !!document.getElementById("tabW")
    })`);
    console.log("root page:", JSON.stringify(root));
    if (root.path !== "/" || !root.demo || !root.tabW) throw new Error("root page wrong");

    if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
    console.log("LIVE OK");
  } finally {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    try { chrome.kill(); } catch {}
  }
})().then(() => process.exit(0)).catch(e => { console.error("FAIL:", e.message); process.exit(1); });
