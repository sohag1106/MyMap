# MyMap

Shareable travel-video map site for Bangladesh and the world — pick the districts (জেলা) or countries you've visited, get a 12-second animated puzzle video, and share it to Facebook in one tap. Everything is rendered in the browser with deterministic Canvas 2D (no AI, no server).

## Features

- **বাংলাদেশ · জেলা** — grouped, searchable picker for all 64 districts (per-division counts, bulk select, map tap)
- **বিশ্ব · দেশ** — searchable picker for 179 countries on a Mercator world map
- **12-second animated video** recorded in-browser (MP4 via MediaRecorder, WebM fallback)
- **Facebook share** — native share sheet with file on mobile (HTTPS), download + copy-caption fallback otherwise
- Poster image download, custom name + profile photo, Bangla captions & hashtags

## Structure

| Path | What |
|---|---|
| `site/` | The website (`index.html` picker → `video.html` record/share) |
| `site/map.js` | Shared deterministic canvas engine (play/record/hit-test) |
| `site/bd_data.js` | 64 district paths + Bangla names |
| `site/world_data.js` | 179 country paths + Bangla names (generated) |
| `world_gen.py` | Generates `site/world_data.js` from `countries.geo.json` |
| `test_site.js` | Headless-Chrome CDP smoke test (screenshots + real recording) |

## Run locally

```bash
python -m http.server 8123 --directory site
# open http://127.0.0.1:8123/
```

## Test

```bash
node test_site.js
```

## Deploy notes

- Serve over **HTTPS** — `navigator.share` with files only works on secure origins (falls back to download + copy + Facebook steps otherwise).
- After deploy, add an absolute `og:image` URL in `site/index.html` (see TODO comment).
- Dataset: Antarctica excluded; this geojson has no Singapore.
