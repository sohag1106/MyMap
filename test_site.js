/* Site smoke test: screenshots index.html + video.html and verifies in-browser recording. */
const { spawn } = require("child_process");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9445;
const BASE = "http://127.0.0.1:8123";
const PROFILE = "C:/MyMap/.chrome-profile-test";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

async function waitDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("DevTools endpoint did not come up");
}

async function openTab(url) {
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
        if (m.method === "Runtime.exceptionThrown") {
          const d = m.params.exceptionDetails;
          errors.push("EXCEPTION: " + (d.exception && d.exception.description || d.text));
        }
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

async function evalJs(ws, expr, awaitPromise = false) {
  const r = await ws("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
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

async function shot(ws, file) {
  const s = await ws("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
  require("fs").writeFileSync(file, Buffer.from(s.data, "base64"));
  return file;
}

async function main() {
  const fs = require("fs");
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=760,2400",
    "--force-device-scale-factor=1",
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], { stdio: "ignore" });

  let ws, tab;
  try {
    await waitDevtools();
    tab = await openTab(BASE + "/index.html");
    ws = await connect(tab.webSocketDebuggerUrl);
    await ws("Page.enable");
    await ws("Runtime.enable");
    await ws("Emulation.setDeviceMetricsOverride", { width: 760, height: 2400, deviceScaleFactor: 1, mobile: false });

    /* --- 1. index.html: load demo selection, screenshot --- */
    if (!(await waitReady(ws))) throw new Error("index.html never became ready");
    await evalJs(ws, "document.getElementById('demoBtn').click(); 'ok'");
    await sleep(600);
    const stats = await evalJs(ws, "document.getElementById('statBadge').textContent");
    const cta = await evalJs(ws, "document.getElementById('goBtn').textContent + '|' + document.getElementById('goBtn').disabled");
    const bdOn = await evalJs(ws, "document.querySelectorAll('.chip[data-bd].on').length");
    const undef = await evalJs(ws, "[...document.querySelectorAll('.chip')].filter(c => c.textContent.includes('undefined')).length");
    const divHead = await evalJs(ws, "document.querySelector('.gt[data-dv=\\\"Dhaka\\\"]').textContent");
    const noPhoto = await evalJs(ws, "document.getElementById('thumb').hidden + '|' + document.getElementById('photoLbl').textContent");
    const cvSize = await evalJs(ws, "document.getElementById('cv').width + 'x' + document.getElementById('cv').height");
    await shot(ws, "C:/MyMap/shot_index.png");
    console.log("index.html OK — stats:", stats, "| CTA:", cta, "| bd chips on:", bdOn, "| undefined-text chips:", undef, "| Dhaka head:", divHead);
    console.log("  default photo:", noPhoto, "| canvas backing store:", cvSize);
    if (bdOn !== 26) throw new Error("expected 26 selected district chips, got " + bdOn);
    if (undef !== 0) throw new Error(undef + " chips rendered 'undefined' text");
    if (!stats.includes("২৬/৬৪")) throw new Error("stats badge wrong: " + stats);
    if (noPhoto.split("|")[0] !== "true") throw new Error("a people photo is pre-loaded on a fresh visit");
    if (!noPhoto.split("|")[1].includes("ছবি যোগ করো")) throw new Error("photo button label wrong: " + noPhoto);
    if (!/^1200x1600$/.test(cvSize)) throw new Error("poster canvas should stay at the engine's 1200x1600, got " + cvSize);

    /* --- 1b. index.html world tab: demo countries --- */
    await evalJs(ws, "document.getElementById('tabW').click(); 'ok'");
    await sleep(300);
    await evalJs(ws, "document.getElementById('demoWBtn').click(); 'ok'");
    await sleep(600);
    const wStats = await evalJs(ws, "document.getElementById('statBadge').textContent");
    const wOn = await evalJs(ws, "document.querySelectorAll('#wGroups .chip.on').length");
    const wGrp = await evalJs(ws, "document.querySelectorAll('#wGroups .grp').length");
    const wHead = await evalJs(ws, "document.querySelector('#wGroups .gt[data-dv=\\\"এশিয়া\\\"]').textContent");
    const wCta = await evalJs(ws, "document.getElementById('goBtn').textContent + '|' + document.getElementById('goBtn').disabled");
    await shot(ws, "C:/MyMap/shot_index_world.png");
    console.log("index world tab OK — stats:", wStats, "| CTA:", wCta, "| chips on:", wOn, "| continent groups:", wGrp);
    console.log("  continent head:", wHead);
    if (wOn !== 14) throw new Error("expected 14 selected country chips, got " + wOn);
    if (wGrp !== 6) throw new Error("expected 6 continent groups, got " + wGrp);
    if (!wStats.includes("১৪/১৭৯")) throw new Error("world stats badge wrong: " + wStats);
    if (wCta.split("|")[1] !== "false") throw new Error("world CTA disabled despite selection");

    /* --- 1c. home page image share: poster blob + share plumbing --- */
    const imgShare = await evalJs(ws, `(async () => {
      const b = await new Promise(r => { const e = window.__eng ? null : null; document.getElementById('cv').toBlob(r, 'image/png'); });
      return { size: b ? b.size : 0, type: b ? b.type : 'none',
               shImg: !!document.getElementById('shImg'), shVid: !!document.getElementById('shVid'),
               host: MAP.SITE.host };
    })()`, true);
    console.log("home image share OK — poster blob:", JSON.stringify(imgShare));
    if (!imgShare.size || imgShare.size < 50000) throw new Error("poster blob too small: " + imgShare.size);
    if (!imgShare.shImg || !imgShare.shVid) throw new Error("home share buttons missing");
    if (imgShare.host !== "mymap.brightskyit.com") throw new Error("watermark host wrong: " + imgShare.host);

    /* --- 2. video.html?still=1: poster + share panel, no record (BD forced) --- */
    await ws("Page.navigate", { url: BASE + "/video.html?still=1&mode=bd" });
    await sleep(400);
    if (!(await waitReady(ws))) throw new Error("video.html?still never became ready");
    await sleep(300);
    const caption = await evalJs(ws, "document.getElementById('cap').value");
    const shareShown = await evalJs(ws, "document.getElementById('shareBox').classList.contains('show')");
    const capHost = await evalJs(ws, "document.getElementById('cap').value.includes('mymap.brightskyit.com')");
    await shot(ws, "C:/MyMap/shot_video_still.png");
    console.log("video.html?still OK — share panel:", shareShown, "| caption first line:", caption.split("\n")[0]);
    if (!capHost) throw new Error("caption does not carry the website name");

    /* --- 3. video.html: real recording smoke test (BD) --- */
    await ws("Page.navigate", { url: BASE + "/video.html?mode=bd" });
    await sleep(400);
    if (!(await waitReady(ws))) throw new Error("video.html never became ready");
    console.log("recording... (up to 45s)");
    let done = false;
    for (let i = 0; i < 90; i++) {
      done = await evalJs(ws, "document.getElementById('shareBox').classList.contains('show')");
      if (done) break;
      await sleep(500);
    }
    if (!done) throw new Error("recording never finished within 45s");
    const rec = await evalJs(ws, `(async () => {
      const v = document.getElementById("out");
      if (!v.src) return { none: true };
      const b = await (await fetch(v.src)).blob();
      return { size: b.size, type: b.type, fmt: document.getElementById("progFmt").textContent,
               lbl: document.getElementById("progLbl").textContent };
    })()`, true);
    /* pause + seek near the end so the screenshot shows the final state, not the intro */
    await evalJs(ws, `(async () => {
      const v = document.getElementById("out");
      v.pause(); v.currentTime = 11.5;
      await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
      return 1;
    })()`, true);
    await sleep(300);
    await shot(ws, "C:/MyMap/shot_video_done.png");
    console.log("record result:", JSON.stringify(rec));
    if (!rec || rec.none || rec.size < 100000) throw new Error("recorded blob missing or too small");

    /* --- 4. video.html world mode: caption + real recording --- */
    await ws("Page.navigate", { url: BASE + "/video.html?mode=world" });
    await sleep(400);
    if (!(await waitReady(ws))) throw new Error("video.html?mode=world never became ready");
    const modeOn = await evalJs(ws, "document.getElementById('mW').classList.contains('on') + '|' + document.getElementById('mBd').classList.contains('on')");
    console.log("world video recording... (up to 45s) | mode switch:", modeOn);
    if (modeOn !== "true|false") throw new Error("world mode switch wrong: " + modeOn);
    let doneW = false;
    for (let i = 0; i < 90; i++) {
      doneW = await evalJs(ws, "document.getElementById('shareBox').classList.contains('show')");
      if (doneW) break;
      await sleep(500);
    }
    if (!doneW) throw new Error("world recording never finished within 45s");
    const capW = await evalJs(ws, "document.getElementById('cap').value");
    const recW = await evalJs(ws, `(async () => {
      const v = document.getElementById("out");
      if (!v.src) return { none: true };
      const b = await (await fetch(v.src)).blob();
      return { size: b.size, type: b.type };
    })()`, true);
    await evalJs(ws, `(async () => {
      const v = document.getElementById("out");
      v.pause(); v.currentTime = 11.5;
      await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
      return 1;
    })()`, true);
    await sleep(300);
    await shot(ws, "C:/MyMap/shot_video_world.png");
    console.log("world caption first line:", capW.split("\n")[0], "| record:", JSON.stringify(recW));
    if (!capW.includes("পৃথিবী") || !capW.includes("#আমারবিশ্বভ্রমণ")) throw new Error("world caption wrong: " + capW.split("\n")[0]);
    if (!recW || recW.none || recW.size < 100000) throw new Error("world recorded blob missing or too small");

    if (errors.length) {
      console.log("PAGE ERRORS:\n" + errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("ALL TESTS PASSED");
    }
  } finally {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    try { chrome.kill(); } catch {}
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error("FAIL:", e.message); if (errors.length) console.error(errors.join("\n")); process.exit(1); });
