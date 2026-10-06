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

    /* --- 1c2. Latin name must not glue the Bengali conjunct "ের" onto it --- */
    const titles = await evalJs(ws, `(() => ({
      latin: titleFromName('SOHAG', 'bd'),
      latinW: titleFromName('SOHAG', 'w'),
      bnCons: titleFromName('রাহিম', 'bd'),
      bnVowel: titleFromName('রাজা', 'bd'),
      endsRa: titleFromName('অমর', 'bd'),
      empty: titleFromName('', 'bd'),
    }))()`);
    console.log("titleFromName:", JSON.stringify(titles));
    if (titles.latin !== "SOHAG এর বাংলাদেশ") throw new Error("Latin name title wrong: " + titles.latin);
    if (titles.latinW !== "SOHAG এর বিশ্ব") throw new Error("Latin world title wrong: " + titles.latinW);
    if (titles.bnCons !== "রাহিমের বাংলাদেশ") throw new Error("Bengali consonant title wrong: " + titles.bnCons);
    if (titles.bnVowel !== "রাজার বাংলাদেশ") throw new Error("Bengali vowel title wrong: " + titles.bnVowel);
    if (titles.endsRa !== "অমর বাংলাদেশ") throw new Error("name-ending-in-র title wrong: " + titles.endsRa);
    if (titles.empty !== "আমার বাংলাদেশ") throw new Error("empty-name title wrong: " + titles.empty);
    if (/ের/.test(titles.latin) || /ের/.test(titles.latinW)) throw new Error("conjunct এর leaked into Latin title");

    /* --- 1d. mobile: a touch that starts on the map must scroll the page, and a tap
       on the uploaded photo thumbnail must open the file picker --- */
    await ws("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await ws("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 3, mobile: true });
    /* the world tab was left active by the section above — go back to districts */
    await evalJs(ws, "document.getElementById('tabBd').click(); window.scrollTo(0, 0); 'ok'");
    await sleep(700);
    const mapBox = await evalJs(ws, `(() => { const r = document.getElementById('cv').getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    const touchAction = await evalJs(ws, "getComputedStyle(document.getElementById('cv')).touchAction");
    /* a point that is genuinely inside the Dhaka district, in canvas coordinates */
    await evalJs(ws, `(() => {
      const g = EN.bd.GEO, f = DATA.f.find(x => x.n === 'Dhaka');
      window.__inside = { x: g.x + (f.c[0]-g.ox)*g.s, y: g.y + (f.c[1]-g.oy)*g.s };
      window.__hit = EN.bd.hit(window.__inside.x, window.__inside.y);
      return 'ok';
    })()`);
    const hitName = await evalJs(ws, "window.__hit");
    /* drag upward from the middle of the map — this is what a user does to scroll down */
    const cx = mapBox.x, cy = mapBox.y;
    await ws("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await ws("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy - i * 40, id: 1 }] });
      await sleep(30);
    }
    await ws("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(600);
    const scrolled = await evalJs(ws, "window.scrollY");
    const selAfterDrag = await evalJs(ws, "cfg.sel.length");

    /* now a clean tap on a district should still select it */
    await evalJs(ws, "window.scrollTo(0, 0); 'ok'");
    await sleep(300);
    const before = await evalJs(ws, "cfg.sel.length");
    const tapXY = await evalJs(ws, `(() => { const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      const i = window.__inside;
      return { x: Math.round(r.left + i.x * (r.width/cv.width)), y: Math.round(r.top + i.y * (r.height/cv.height)) }; })()`);
    await ws("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tapXY.x, y: tapXY.y, id: 2 }] });
    await ws("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(400);
    const after = await evalJs(ws, "cfg.sel.length");

    /* desktop click path: a plain mouse click on Dhaka must select it */
    await sleep(200);
    const clickSel = await evalJs(ws, `(() => {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      const i = window.__inside;
      const px = r.left + i.x * (r.width / cv.width), py = r.top + i.y * (r.height / cv.height);
      const opts = { bubbles: true, clientX: px, clientY: py, pointerId: 9, pointerType: 'mouse', isPrimary: true };
      cv.dispatchEvent(new PointerEvent('pointerdown', opts));
      cv.dispatchEvent(new PointerEvent('pointerup', opts));
      return cfg.sel.filter(n => n === 'Dhaka').length;
    })()`);
    const desktopDelta = clickSel;   /* 1 = Dhaka was off and got turned on */

    /* tap the photo button (whole button — thumbnail + placeholder): should arm the
       picker, not silently do nothing. A real touch tap, at the button's own
       coordinates, scrolled into the viewport first (on mobile it sits below the map). */
    const txy = await evalJs(ws, `(() => {
      const b = document.getElementById('photoBtn');
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    await evalJs(ws, `(() => {
      window.__picked = 0;
      document.getElementById('photoIn').click = () => { window.__picked++; };  // stub the native dialog
      return 'ok';
    })()`);
    await ws("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: txy.x, y: txy.y, id: 3 }] });
    await sleep(60);
    await ws("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(300);
    const picked = await evalJs(ws, "window.__picked");

    /* a real image upload: after the file lands, the thumbnail must be visible and the
       label must flip to "change photo" without needing a reload */
    const upload = await evalJs(ws, `(async () => {
      // 1x1 red PNG as a stand-in for a user photo
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'me.png', { type: 'image/png' });
      const input = document.getElementById('photoIn');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // wait for the img onload handler to apply the data-URL
      for (let i = 0; i < 40; i++) {
        if (!document.getElementById('thumb').hidden && document.getElementById('photoLbl').textContent.includes('বদলাও')) break;
        await new Promise(r => setTimeout(r, 50));
      }
      return {
        hidden: document.getElementById('thumb').hidden,
        lbl: document.getElementById('photoLbl').textContent,
        hasSrc: (document.getElementById('thumb').src || '').startsWith('data:image'),
        phHidden: document.getElementById('thumbPh').hidden,
      };
    })()`, true);
    const storedPhoto = await evalJs(ws, `(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try { const c = JSON.parse(localStorage.getItem(k)); if (c && c.photo) return { key: k, len: c.photo.length }; } catch {}
      }
      return null;
    })()`);
    console.log("photo upload OK — thumb:", JSON.stringify(upload), "| stored:", JSON.stringify(storedPhoto));
    if (upload.hidden !== false) throw new Error("thumbnail still hidden after upload");
    if (!upload.hasSrc) throw new Error("thumbnail has no data-URL src after upload");
    if (!upload.lbl.includes("বদলাও")) throw new Error("photo label did not flip after upload: " + upload.lbl);
    if (upload.phHidden !== true) throw new Error("placeholder still visible after upload");
    if (!storedPhoto || storedPhoto.len < 100) throw new Error("photo was not persisted to localStorage");

    await ws("Emulation.setTouchEmulationEnabled", { enabled: false });
    await ws("Emulation.setDeviceMetricsOverride", { width: 760, height: 2400, deviceScaleFactor: 1, mobile: false });

    console.log("mobile scroll OK — touch-action:", touchAction, "| scrolled to y =", scrolled,
                "| districts changed by the drag:", selAfterDrag - before);
    console.log("mobile tap OK — Dhaka via desktop click:", desktopDelta, "| hit() on that point:", hitName,
                "| tap changed selection:", before, "->", after, "| photo picker fired:", picked, "time(s)");
    if (touchAction !== "pan-y") throw new Error("canvas must be touch-action:pan-y so the page scrolls, got " + touchAction);
    if (scrolled < 100) throw new Error("dragging on the map did not scroll the page (scrollY=" + scrolled + ")");
    if (selAfterDrag !== before) throw new Error("a scroll drag changed the selection");
    if (hitName !== "Dhaka") throw new Error("hit() resolved " + hitName + " instead of Dhaka — tap-to-select is broken");
    if (desktopDelta !== 1) throw new Error("a desktop click on Dhaka did not select it");
    if (after === before) throw new Error("a tap did not change the selection");
    if (picked !== 1) throw new Error("tapping the photo button did not open the picker (fired " + picked + "x)");

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
    /* seed a world selection: an empty mode now shows the empty state, not a demo */
    await ws("Page.navigate", { url: BASE + "/video.html?mode=world" });
    await sleep(400);
    if (!(await waitReady(ws))) throw new Error("video.html?mode=world never became ready");
    /* if the empty state appeared (cfg.wsel was cleared), take the explicit demo path */
    const emptyShown = await evalJs(ws, "document.getElementById('emptyCard').style.display !== 'none'");
    if (emptyShown) {
      console.log("world mode empty (cfg.wsel cleared) — using explicit demo button");
      await evalJs(ws, "document.getElementById('emptyDemo').click(); 'ok'");
      await sleep(600);
      if (!(await waitReady(ws))) throw new Error("video.html?mode=world after demo never became ready");
    }
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

    /* --- 5. empty world mode: districts exist but no countries — must NOT auto-pick demo ---
       the reported bug: after a BD video, switching to the country tab silently
       selected India/Nepal/... and recorded them. Now it must show the empty state. */
    await evalJs(ws, `(() => {
      const c = JSON.parse(localStorage.getItem('mb_cfg') || '{}');
      c.sel = c.sel || ['Dhaka','Cumilla','Sylhet'];
      c.wsel = [];                          /* user never picked countries */
      localStorage.setItem('mb_cfg', JSON.stringify(c));
      return 'ok';
    })()`);
    await ws("Page.navigate", { url: BASE + "/video.html?mode=world" });
    await sleep(400);
    if (!(await waitReady(ws))) throw new Error("video.html?mode=world (empty) never became ready");
    await sleep(800);                       /* give auto-record a chance to (wrongly) start */
    const emptyState = await evalJs(ws, `(() => ({
      emptyShown: document.getElementById('emptyCard').style.display !== 'none',
      lbl: document.getElementById('emptyLbl').textContent,
      progHidden: document.getElementById('progCard').style.display === 'none',
      shareHidden: !document.getElementById('shareBox').classList.contains('show'),
      sel: (JSON.parse(localStorage.getItem('mb_cfg')||'{}').wsel || []).length,
      hasDemoCountries: ['India','Nepal','France'].some(n =>
        (JSON.parse(localStorage.getItem('mb_cfg')||'{}').wsel || []).includes(n)),
    }))()`);
    await shot(ws, "C:/MyMap/shot_video_empty.png");
    console.log("empty world mode:", JSON.stringify(emptyState));
    if (!emptyState.emptyShown) throw new Error("empty world mode did not show the empty state");
    if (!emptyState.lbl.includes("দেশ")) throw new Error("empty-state label wrong: " + emptyState.lbl);
    if (!emptyState.progHidden) throw new Error("recording progress still visible in empty mode");
    if (!emptyState.shareHidden) throw new Error("share panel shown without a recording");
    if (emptyState.hasDemoCountries) throw new Error("demo countries were auto-selected into cfg.wsel");

    /* explicit demo button must fill the selection and start the normal record path */
    await evalJs(ws, "document.getElementById('emptyDemo').click(); 'ok'");
    let afterDemo = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      afterDemo = await evalJs(ws, `(() => {
        if (window.__READY !== 1) return null;           /* still reloading */
        return {
          emptyGone: document.getElementById('emptyCard').style.display === 'none',
          wsel: (JSON.parse(localStorage.getItem('mb_cfg')||'{}').wsel || []).length,
          recStarted: document.getElementById('progLbl').textContent.includes('তৈরি হচ্ছে') ||
                      document.getElementById('shareBox').classList.contains('show'),
        };
      })()`);
      if (afterDemo && afterDemo.emptyGone && afterDemo.wsel >= 10) break;
    }
    console.log("after emptyDemo:", JSON.stringify(afterDemo));
    if (!afterDemo || !afterDemo.emptyGone) throw new Error("empty state still shown after explicit demo");
    if (afterDemo.wsel < 10) throw new Error("demo button did not persist world selection: " + afterDemo.wsel);

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
