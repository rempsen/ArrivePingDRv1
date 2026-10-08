import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
const [,, out, lon, lat, z, w, h, scale, debug] = process.argv;
const b = await chromium.launch({ executablePath: "/root/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7977.30/chrome-headless-shell-linux64/chrome-headless-shell", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-proxy-server"] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale });
const errs = []; p.on("console", m => m.type() === "error" && errs.push(m.text())); p.on("pageerror", e => errs.push(e.message));
await p.goto(`http://127.0.0.1:8788/map.html?lon=${lon}&lat=${lat}&z=${z}&w=${w}&h=${h}${debug ? "&debug=1" : ""}`);
await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
await p.waitForTimeout(debug ? 1500 : 500);
await p.screenshot({ path: out });
if (process.env.PTS) { const pts = JSON.parse((await import("node:fs")).readFileSync(process.env.PTS, "utf8")); const res = await p.evaluate(pts => pts.map(([x, y]) => { const q = map.project([x, y]); return [+q.x.toFixed(1), +q.y.toFixed(1)]; }), pts); console.log(JSON.stringify(res)); }
console.error(errs.slice(0, 5).join("\n"));
await b.close();
