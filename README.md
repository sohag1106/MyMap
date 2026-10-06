# MyMap

Shareable travel-video map site for Bangladesh and the world — pick the districts (জেলা) or countries you've visited, get a 12-second animated puzzle video, and share it to Facebook in one tap. Everything is rendered in the browser with deterministic Canvas 2D (no AI, no server).

## Features

- **বাংলাদেশ · জেলা** — grouped, searchable picker for all 64 districts (per-division counts, bulk select, map tap)
- **বিশ্ব · দেশ** — 179 countries grouped by continent, on a Mercator world map fitted to fill the frame
- **12-second animated video** recorded in-browser (MP4 via MediaRecorder, WebM fallback)
- **Share the image or the video** — the home page shares the poster directly, or hands off to the video page
- **Facebook share** — native share sheet with the file on mobile (HTTPS), download + copy-caption fallback otherwise
- Custom name + optional profile photo (**no photo is used unless you add one** — nothing personal is pre-loaded)
- Website name (`mymap.brightskyit.com`) is drawn into the poster and video, in the caption, and in `SITE` in `site/map.js`

## Structure

| Path | What |
|---|---|
| `site/` | The website (`index.html` picker + share → `video.html` record/share) |
| `site/map.js` | Shared deterministic canvas engine (play/record/hit-test/watermark) |
| `site/bd_data.js` | 64 district paths + Bangla names |
| `site/world_data.js` | 179 country paths + Bangla names + continent (generated) |
| `world_gen.py` | Generates `site/world_data.js` from `countries.geo.json` |
| `test_site.js` | Headless-Chrome CDP smoke test (screenshots + real recordings) |
| `test_live.js` | Checks the deployed site (redirects, caption, watermark host) |
| `test_layout.js` | Measures poster ink coverage / map fill on the canvas |

## Run locally

```bash
python -m http.server 8123 --directory site
# open http://127.0.0.1:8123/
```

## Test

```bash
node test_site.js     # pages + real recording, both modes
node test_live.js     # deployed site over HTTPS
node test_layout.js   # canvas ink coverage
```

## Deploy notes

- Serve over **HTTPS** — `navigator.share` with files only works on secure origins (falls back to download + copy + Facebook steps otherwise).
- Live at **https://mymap.brightskyit.com** — Cloudflare Worker `mymap` with `site/` as static assets (`npx wrangler deploy`).
- Workers redirect `/index.html` → `/` and `/video.html` → `/video`; in-page links build their URL from `location.pathname`, so both spellings work.
- Dataset: Antarctica excluded; this geojson has no Singapore.
