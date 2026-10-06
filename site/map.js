"use strict";
/* map.js — shared poster/video engine. Pure deterministic canvas code, no AI.
   Requires: bd_data.js (DATA, BN) loaded first; optionally world_data.js (WORLD, WORLD_BN);
   fonts.css linked. build() accepts {selected, title, data, bn, sub, footL, footR}. */
const MAP = (() => {
const W = 1200, H = 1600, FPS = 30;
const SITE = { host:"mymap.brightskyit.com", label:"নিজের ম্যাপ বানাও" };
const T = { bg:"#f6f2ea", land:"#e3dccd", stroke:"#f6f2ea", v1:"#0f6b4f", v2:"#1f9a70", vStroke:"#f6f2ea",
            ink:"#17201c", muted:"#7a7f78", label:"#ffffff", halo:"#0b3d2e", dot:"#f42a41", track:"#e3dccd" };
const FONT = '"Anek Bangla",system-ui,sans-serif';

/* map slot inside the 1200x1600 poster */
const SLOT = { x:40, y:250, w:1120, h:1040 };

const TL = { photo:[.15,.75], sub:[.35,.95], title:[.45,1.05], cnt:[.6,1.15], map:[.9,1.65],
             foot:[1.55,2.1], start:1.7, stag:.28, piece:.38, lag:.10, label:.28, brand:[1.15,1.7],
             settle:[9.4,10.3], dur:12 };

const clamp=(v,a=0,b=1)=>v<a?a:v>b?b:v;
const easeOutCubic=p=>1-Math.pow(1-p,3);
const easeOutBack=p=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(p-1,3)+c1*Math.pow(p-1,2);};
const BND=["০","১","২","৩","৪","৫","৬","৭","৮","৯"];
const bn=n=>String(n).split("").map(ch=>ch>="0"&&ch<="9"?BND[+ch]:ch).join("");
const seg=(t,[a,b])=>clamp((t-a)/(b-a));
function alignX(ctx,text,x,align){const w=ctx.measureText(text).width;return align==="left"?x:align==="right"?x-w:x-w/2;}
function textAt(ctx,text,x,y,align,stroke){const ax=alignX(ctx,text,x,align);if(stroke)ctx.strokeText(text,ax,y);ctx.fillText(text,ax,y);}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* per-dataset context: geometry scale + feature index.
   Scale is fitted to the real ink bounds (not the declared canvas), so datasets with
   padding around the shapes — the Mercator world map has 350px of empty ocean below
   the last country — still fill the slot instead of floating in it. */
function makeDS(data, bnMap){
  const { x, y, w, h } = SLOT;
  const pad = 4;                                    // room for the piece stroke
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of data.f){
    const nums = f.d.match(/-?\d+(?:\.\d+)?/g) || [];
    for (let i = 0; i + 1 < nums.length; i += 2){
      const px = +nums[i], py = +nums[i+1];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = data.w; y1 = data.h; }
  const s = Math.min((w - 2*pad) / (x1 - x0), (h - 2*pad) / (y1 - y0));
  const GEO = { s, w:(x1-x0)*s, h:(y1-y0)*s, ox:x0, oy:y0 };
  GEO.x = x + (w - GEO.w) / 2;
  GEO.y = y + (h - GEO.h) / 2;
  const F_BY = Object.fromEntries(data.f.map(f => [f.n, f]));
  const missing = n => !F_BY[n];
  return { data, bn: bnMap || {}, GEO, F_BY, missing };
}

const BD = makeDS(DATA, BN);
const missing = BD.missing;

/* nearest-neighbour journey order starting from the first selected feature */
function routeOrder(sel, F_BY){
  if (!sel.length) return [];
  if (sel.length === 1) return [sel[0]];
  const pt = n => { const f=F_BY[n]; return {x:f.c[0], y:f.c[1]}; };
  const pts = Object.fromEntries(sel.map(n => [n, pt(n)]));
  let cur = sel[0]; const rest = new Set(sel); rest.delete(cur); const out = [cur];
  while (rest.size) {
    let best = null, bd = 1e9;
    for (const n of rest) { const d = Math.hypot(pts[n].x-pts[cur].x, pts[n].y-pts[cur].y); if (d < bd) { bd = d; best = n; } }
    out.push(best); rest.delete(best); cur = best;
  }
  return out;
}

function placeLabels(ctx, route){
  ctx.font = `600 20px ${FONT}`;
  const placed = [], labels = {};
  const byY = [...route].sort((a,b) => a.c[1] - b.c[1]);
  const tries = [[0,-14],[0,26],[12,7],[-12,7],[0,-36],[0,48],[30,-14],[-30,-14],[30,26],[-30,26]];
  for (const f of byY){
    const [cx,cy] = f.c;
    const w = ctx.measureText(f.bnName).width + 8, h = 26;
    let pick = null;
    for (const [dx,dy] of tries){
      const align = dx>0 ? "left" : dx<0 ? "right" : "center";
      const x0 = align==="left" ? cx+dx : align==="right" ? cx+dx-w : cx-w/2, y0 = cy+dy-h+4;
      const box = {x:x0, y:y0, w, h};
      if (!placed.some(b => b.x < box.x+box.w && box.x < b.x+b.w && b.y < box.y+box.h && box.y < b.y+b.h)) { pick = {box, align, tx:cx+dx, ty:cy+dy}; break; }
    }
    if (!pick) { const box = {x:cx-w/2, y:cy-32, w, h}; pick = {box, align:"center", tx:cx, ty:cy-14}; }
    placed.push(pick.box, {x:cx-5, y:cy-5, w:10, h:10});
    labels[f.en] = {...pick, cx, cy, bn:f.bnName};
  }
  return labels;
}

/* build a stateless renderer bound to a canvas */
function build(canvas, opts){
  opts = opts || {};
  const ctx = canvas.getContext("2d");
  const DS = makeDS(opts.data || DATA, opts.bn || BN);
  const denom = opts.denom || DS.data.f.length;
  const sub = opts.sub || "বাংলাদেশ ভ্রমণ ম্যাপ";
  const footL = opts.footL || (st => `${bn(st.pct)}% বাংলাদেশ ঘুরা হয়েছে`);
  const footR = opts.footR || (st => `${bn(st.landed)}টি জেলা · ৮টির মধ্যে ${bn(st.divs)}টি বিভাগ`);
  let route = [];
  let labels = {};
  let TLb = { ...TL };
  function setSelection(list){
    const sel = (list || []).filter(n => !DS.missing(n));
    route = routeOrder(sel, DS.F_BY).map(n => {
      const f = DS.F_BY[n];
      return { en:n, bnName:DS.bn[n] || n, c:[DS.GEO.x + f.c[0]*DS.GEO.s, DS.GEO.y + f.c[1]*DS.GEO.s], dv:f.dv || "" };
    });
    labels = placeLabels(ctx, route);
    /* compress stagger so every piece lands before the settle window (large selections) */
    const room = (TL.settle[0] - TL.start - TL.piece) / Math.max(1, route.length - 1);
    TLb = { ...TL, stag: Math.min(TL.stag, room) };
  }
  setSelection(opts.selected || []);
  let photo = null;                       // HTMLImageElement or null
  let title = opts.title || "আমার বাংলাদেশ";
  const setPhoto = img => { photo = img; };
  const setTitle = t => { if (t) title = t; };

  function stateAt(t){
    let landed = 0, fracPieces = 0, curI = -1;
    for (let i = 0; i < route.length; i++){
      const p = clamp((t - (TLb.start + i*TLb.stag)) / TLb.piece);
      if (p >= 1) landed++; else if (p > 0) curI = i;
      fracPieces += easeOutCubic(p);
    }
    const divs = new Set();
    for (let i = 0; i < route.length; i++)
      if (route[i].dv && clamp((t - (TLb.start + i*TLb.stag)) / TLb.piece) >= 1) divs.add(route[i].dv);
    return { landed, frac:fracPieces/denom, pct:Math.round(fracPieces/denom*100),
             curI, divs:divs.size, total:route.length, denom };
  }

  function drawHeader(t){
    const pa = easeOutCubic(seg(t, TLb.photo));
    if (pa > 0){
      const x=80, y=52, size=168, rad=32;
      ctx.save(); ctx.globalAlpha = pa;
      ctx.translate(x+size/2, y+size/2); ctx.scale(.82+.18*pa, .82+.18*pa); ctx.translate(-(x+size/2), -(y+size/2));
      const rg = ctx.createLinearGradient(x, y, x+size, y+size); rg.addColorStop(0,T.v1); rg.addColorStop(1,T.v2);
      roundRect(ctx, x-7, y-7, size+14, size+14, rad+7); ctx.fillStyle = rg; ctx.fill();
      roundRect(ctx, x-2, y-2, size+4, size+4, rad+2); ctx.fillStyle = T.bg; ctx.fill();
      roundRect(ctx, x+1, y+1, size-2, size-2, rad-1); ctx.clip();
      if (photo && photo.complete && photo.naturalWidth){
        const iw=photo.naturalWidth, ih=photo.naturalHeight, k=Math.max(size/iw, size/ih);
        ctx.drawImage(photo, x+size/2-iw*k/2, y+size/2-ih*k/2, iw*k, ih*k);
      }
      ctx.restore();
    }
    const tx = 80 + 168 + 40;
    const sa = easeOutCubic(seg(t, TLb.sub));
    if (sa > 0){ ctx.save(); ctx.globalAlpha = sa;
      ctx.font = `600 24px ${FONT}`; ctx.fillStyle = T.muted; ctx.textBaseline = "alphabetic";
      ctx.fillText(sub, tx, 112 + 14*(1-sa)); ctx.restore(); }
    const ta = easeOutCubic(seg(t, TLb.title));
    if (ta > 0){ ctx.save(); ctx.globalAlpha = ta;
      ctx.font = `800 64px ${FONT}`; ctx.fillStyle = T.ink;
      ctx.fillText(title, tx, 190 + 18*(1-ta)); ctx.restore(); }
    /* counter */
    const st = stateAt(t);
    const ca = easeOutCubic(seg(t, TLb.cnt));
    if (ca > 0){
      let pulse = 0;
      for (let i = 0; i < route.length; i++){
        const t0 = TLb.start + i*TLb.stag;
        if (t >= t0 && t < t0 + .3) pulse = Math.max(pulse, 1 - (t-t0)/.3);
      }
      const s = 1 + .10*pulse*pulse;
      const num = bn(st.landed), rest = "/" + bn(st.denom);
      ctx.save(); ctx.globalAlpha = ca;
      ctx.font = `700 52px ${FONT}`; const rw = ctx.measureText(rest).width;
      ctx.font = `800 92px ${FONT}`; const nw = ctx.measureText(num).width;
      const right = W-80, base = 208;
      const cx = right - (nw + 8 + rw)/2, cy = base - 34;
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      ctx.textBaseline = "alphabetic";
      ctx.font = `800 92px ${FONT}`; ctx.fillStyle = T.v1;
      textAt(ctx, num, right-8-rw, base, "right");
      ctx.font = `700 52px ${FONT}`; ctx.fillStyle = "#9c9a92";
      textAt(ctx, rest, right, base, "right");
      ctx.restore();
    }
  }

  function drawMapBase(t){
    const a = easeOutCubic(seg(t, TLb.map));
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    const cx = DS.GEO.x + DS.GEO.w/2, cy = DS.GEO.y + DS.GEO.h/2;
    const s = .985 + .015*a;
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    ctx.translate(DS.GEO.x - DS.GEO.ox*DS.GEO.s, DS.GEO.y - DS.GEO.oy*DS.GEO.s);
    ctx.scale(DS.GEO.s, DS.GEO.s);
    ctx.lineJoin = "round";
    for (const f of DS.data.f){
      const p = new Path2D(f.d);
      ctx.fillStyle = T.land; ctx.fill(p);
      ctx.strokeStyle = T.stroke; ctx.lineWidth = 1/DS.GEO.s*1.4; ctx.stroke(p);
    }
    ctx.restore();
  }

  function drawRoute(t){
    if (!route.length) return;
    const st = stateAt(t);
    if (st.landed + (st.curI >= 0 ? 1 : 0) < 1) return;
    const settle = seg(t, TLb.settle);
    const alpha = .85 - .45*easeOutCubic(settle);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.strokeStyle = T.dot; ctx.lineWidth = 2.5; ctx.setLineDash([7,7]);
    ctx.lineDashOffset = -(t*30) % 14;
    ctx.beginPath();
    for (let j = 0; j < route.length-1; j++){
      const p = clamp((t - (TLb.start + (j+1)*TLb.stag)) / TLb.piece);
      if (p <= 0) break;
      const [x0,y0] = route[j].c, [x1,y1] = route[j+1].c;
      const e = easeOutCubic(p);
      if (j === st.curI && p < 1){ ctx.moveTo(x0,y0); ctx.lineTo(x0+(x1-x0)*e, y0+(y1-y0)*e); }
      else { ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); }
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  function drawPieces(t){
    ctx.save();
    ctx.translate(DS.GEO.x - DS.GEO.ox*DS.GEO.s, DS.GEO.y - DS.GEO.oy*DS.GEO.s);
    ctx.scale(DS.GEO.s, DS.GEO.s);
    ctx.lineJoin = "round";
    const vg = ctx.createLinearGradient(0, 0, DS.data.w, DS.data.h);
    vg.addColorStop(0, T.v1); vg.addColorStop(1, T.v2);
    for (let i = 0; i < route.length; i++){
      const t0 = TLb.start + i*TLb.stag;
      const p = clamp((t - t0) / TLb.piece);
      if (p <= 0) continue;
      const f = DS.F_BY[route[i].en];
      const path = new Path2D(f.d);
      const e = easeOutBack(p);
      const sc = .52 + .48*e;
      const [mx,my] = f.c;
      ctx.save();
      ctx.globalAlpha = clamp(p*1.6);
      ctx.translate(mx, my); ctx.scale(sc, sc); ctx.translate(-mx, -my);
      ctx.fillStyle = vg; ctx.fill(path);
      if (p < .65){ ctx.save(); ctx.globalAlpha = (1-p/.65)*.9; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4/DS.GEO.s; ctx.stroke(path); ctx.restore(); }
      ctx.strokeStyle = T.vStroke; ctx.lineWidth = 1.4/DS.GEO.s; ctx.stroke(path);
      ctx.restore();
    }
    ctx.restore();
  }

  /* site watermark — sits in the empty band under the chart so every poster and video
   carries the website name and people can come make their own */
  function drawBrand(t){
    const a = easeOutCubic(seg(t, TLb.brand));
    if (a <= 0) return;
    const rise = 1 - a;
    const parts = [
      { txt:"আমার বাংলাদেশ", font:`700 25px ${FONT}`, color:T.ink },
      { txt:" · " + SITE.label, font:`600 23px ${FONT}`, color:T.v1 },
      { txt:" · " + SITE.host, font:`600 21px ${FONT}`, color:T.muted },
    ];
    ctx.save();
    ctx.globalAlpha = a * .96;
    ctx.textBaseline = "alphabetic";
    let total = 0;
    for (const p of parts){ ctx.font = p.font; p.w = ctx.measureText(p.txt).width; total += p.w; }
    const dotR = 9, gap = 14;
    let x = W/2 - (total + gap + dotR*2) / 2;
    const y = 1396 + 12*rise;
    ctx.beginPath(); ctx.arc(x + dotR, y - 8, dotR, 0, Math.PI*2);
    ctx.fillStyle = T.dot; ctx.fill();
    x += dotR*2 + gap;
    for (const p of parts){
      ctx.font = p.font; ctx.fillStyle = p.color;
      ctx.fillText(p.txt, x, y);
      x += p.w;
    }
    ctx.restore();
  }

  function drawLabels(t){
    ctx.save(); ctx.textBaseline = "alphabetic";
    for (let i = 0; i < route.length; i++){
      const t0 = TLb.start + i*TLb.stag + TLb.lag;
      const p = clamp((t - t0) / TLb.label);
      if (p <= 0) continue;
      const e = easeOutCubic(p);
      const L = labels[route[i].en]; if (!L) continue;
      ctx.save(); ctx.globalAlpha = e;
      const ds = .4 + .6*easeOutBack(clamp(p*1.3));
      ctx.beginPath(); ctx.arc(L.cx, L.cy, 4.5*ds, 0, Math.PI*2);
      ctx.fillStyle = T.dot; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      const dy = 10*(1-e);
      ctx.font = `600 20px ${FONT}`;
      ctx.lineJoin = "round"; ctx.lineWidth = 5; ctx.strokeStyle = T.halo;
      ctx.fillStyle = T.label;
      textAt(ctx, L.bn, L.tx, L.ty+dy, L.align, true);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFooter(t){
    const a = easeOutCubic(seg(t, TLb.foot));
    if (a <= 0) return;
    const st = stateAt(t);
    ctx.save(); ctx.globalAlpha = a;
    const fy = 1455;
    ctx.fillStyle = T.track; roundRect(ctx, 80, fy, W-160, 12, 6); ctx.fill();
    if (st.frac > 0){
      const pg = ctx.createLinearGradient(80, 0, W-80, 0); pg.addColorStop(0,T.v1); pg.addColorStop(1,T.v2);
      ctx.fillStyle = pg; roundRect(ctx, 80, fy, Math.max(12, (W-160)*Math.min(1, st.frac)), 12, 6); ctx.fill();
    }
    const by = 1544;
    ctx.font = `700 24px ${FONT}`; ctx.fillStyle = T.ink;
    ctx.fillText(footL(st), 80, by);
    ctx.font = `500 20px ${FONT}`; ctx.fillStyle = T.muted;
    textAt(ctx, footR(st), W-80, by, "right");
    ctx.restore();
  }

  function seek(t){
    t = clamp(t, 0, TLb.dur);
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = T.bg; ctx.fillRect(0,0,W,H);
    ctx.restore();
    drawMapBase(t);
    drawRoute(t);
    drawPieces(t);
    drawLabels(t);
    drawBrand(t);
    drawHeader(t);
    drawFooter(t);
    return "ok";
  }

  /* canvas-space hit test: exact path first, then nearest small feature's centroid */
  function hit(px, py){
    const gx = (px - DS.GEO.x + DS.GEO.ox*DS.GEO.s) / DS.GEO.s;
    const gy = (py - DS.GEO.y + DS.GEO.oy*DS.GEO.s) / DS.GEO.s;
    for (let i = DS.data.f.length - 1; i >= 0; i--)
      if (new Path2D(DS.data.f[i].d).isPointInPath(gx, gy)) return DS.data.f[i].n;
    let best = null, bd = 15;
    for (const f of DS.data.f){
      const cx = DS.GEO.x + f.c[0]*DS.GEO.s, cy = DS.GEO.y + f.c[1]*DS.GEO.s;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bd){ bd = d; best = f.n; }
    }
    return best;
  }

  return { seek, setPhoto, setTitle, setSelection, stateAt, hit, GEO: DS.GEO,
           get TL(){ return TLb; }, get route(){ return route; }, get labels(){ return labels; },
           W, H, canvas };
}

/* play on an element (canvas), returns stop() */
function play(render, onFrame, onDone){
  const t0 = performance.now(); let raf = 0, alive = true;
  (function loop(){
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= render.TL.dur){ render.seek(render.TL.dur); onFrame && onFrame(render.TL.dur); onDone && onDone(); return; }
    render.seek(t); onFrame && onFrame(t);
    raf = requestAnimationFrame(loop);
  })();
  return () => { alive = false; cancelAnimationFrame(raf); };
}

/* record the canvas to a Blob using MediaRecorder + captureStream (mp4 preferred) */
function record(render, fps = FPS){
  return new Promise((resolve, reject) => {
    const canvas = render.canvas;
    const stream = canvas.captureStream(fps);
    const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "";
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType:mime, videoBitsPerSecond:8e6 } : undefined); }
    catch (e) { reject(e); return; }
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = e => reject(e.error || new Error("MediaRecorder error"));
    rec.onstop = () => {
      resolve({ blob: new Blob(chunks, { type: mime || "video/webm" }), ext: (mime||"").includes("mp4") ? "mp4" : "webm" });
    };
    rec.start();
    play(render, null, () => setTimeout(() => { try { rec.stop(); } catch (e) { reject(e); } }, 400));
  });
}

async function fontsReady(){
  try {
    await Promise.all([
      document.fonts.load(`800 64px ${FONT}`, "আমার বাংলাদেশ"),
      document.fonts.load(`700 24px ${FONT}`, "০১২৩৪৫৬৭৮৯"),
      document.fonts.load(`600 20px ${FONT}`, "সিলেট চট্টগ্রাম"),
      document.fonts.load(`500 20px ${FONT}`, "জেলা বিভাগ"),
    ]);
    await document.fonts.ready;
  } catch (e) {}
}

return { build, play, record, fontsReady, T, TL, FONT, SITE, bn, missing, W, H, DATA_REF: () => DATA, BN_REF: () => BN };
})();
