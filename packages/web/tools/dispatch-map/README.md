# "How it works" real-map capture

Regenerates `public/img/site/dispatch-map-river-heights.webp` and the route
constants in `src/web/site/live/dispatch-map.ts`.

1. **Routes:** real OSRM driving routes to 214 Waverley St, Winnipeg (front door
   on Waverley), saved in `routes.json`:
   - Marcus 856 m, Niagara → Kingsway → Waverley
   - Priya 529 m, Academy → Waverley
   - Dev 401 m, Oxford → Kingsway → Waverley
2. **Map:** `map.html` renders the vendored ArrivePing Ink style
   (`src/web/lib/basemap/arriveping-ink.style.json`) with MapLibre. Serve the
   style, MapLibre, OpenFreeMap z14 tiles, fonts and sprites from a local folder
   (`style.json` pointing at `http://127.0.0.1:8788`).
3. **Render:** `PTS=pts.json node render.mjs out.png -97.17899842 49.87142258 15.4 960 720 2`
   writes a 1920×1440 PNG. It prints the pixel projection of every `[lon, lat]` in
   `PTS`. Convert the PNG to WebP at quality 80.
4. **Simplify:** run Douglas–Peucker (0.6 px) on the projected routes and paste
   them into `dispatch-map.ts`.

Scale: about 1.17 m per CSS px. If you change it, update the
`lv-drive` / `lv-ahead` keyframes in `live.css`, which are written as
px = m / 1.17.
