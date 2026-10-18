#!/usr/bin/env python3
"""
Map v2 e2e: the dispatch map at desktop, iPad and phone sizes.

Runs against the demo server (it seeds a company, technicians and jobs, and
prints the sign-in):

    bun run build
    bun run tools/dispatch-demo.ts --port 4300 --no-move &
    BASE_URL=http://localhost:4300 python3 e2e/dispatch-map.e2e.py

Checks:
  desktop 1440x900  page loads, a marker per technician with a location,
                    queue cards, drag a card onto a technician chip -> "Offered to",
                    Undo puts it back, a drag onto a technician who isn't qualified
                    shows the one-sentence clash card, "Assign anyway" assigns,
                    job inspector one-click Assign, Escape clears selection.
  iPad 1024x1366    same layout, touch: press-and-hold then drag assigns.
  phone 390x844     bottom sheet shows, strip scrolls, tap a card selects it.
Set SHOT_DIR to keep screenshots. Browser flags suit headless Chromium without a GPU.
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:4300")
EMAIL = os.environ.get("E2E_EMAIL", "dispatch@demo.test")
PASSWORD = os.environ.get("E2E_PASSWORD", "demo-dispatch-123")
SHOTS = os.environ.get("SHOT_DIR", "/tmp/dispatch-shots")
os.makedirs(SHOTS, exist_ok=True)
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
if os.environ.get("PW_PROXY"):
    ARGS += [f"--proxy-server={os.environ['PW_PROXY']}", "--proxy-bypass-list=localhost;127.0.0.1"]

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))


def mock_tiles(ctx):
    """The sandbox can't reach the tile host; answer the TileJSON so credits can render, 404 the tiles."""
    tj = '{"tilejson":"3.0.0","tiles":["https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf"],"minzoom":0,"maxzoom":14,"attribution":"provider-credit"}'
    def handle(route):
        u = route.request.url
        if u.rstrip("/").endswith("/planet"):
            route.fulfill(status=200, content_type="application/json", body=tj, headers={"access-control-allow-origin": "*"})
        else:
            route.fulfill(status=404, body="", headers={"access-control-allow-origin": "*"})
    ctx.route("https://tiles.openfreemap.org/**", handle)


def credits_ok(pg, label):
    a = pg.locator(".maplibregl-ctrl-attrib")
    vis = a.count() > 0 and a.first.is_visible()
    txt = a.first.inner_text() if a.count() else ""
    strip = pg.locator(".ap-strip, .ap-sheet").first.bounding_box()
    box = a.first.bounding_box() if vis else None
    clear = bool(box and strip and box["y"] + box["height"] <= strip["y"] + 1) if label == "desktop" else vis
    check(f"{label}: map credits are visible and name OpenStreetMap", vis and "OpenStreetMap" in txt and "OpenFreeMap" in txt, txt.replace("\n", " ")[:80])
    check(f"{label}: credits sit clear of the panels", clear)


def open_page(ctx):
    mock_tiles(ctx)
    pg = ctx.new_page()
    pg.goto(BASE + "/sign-in", wait_until="networkidle")
    pg.get_by_placeholder("Email address").fill(EMAIL)
    pg.get_by_placeholder("Password").fill(PASSWORD)
    pg.get_by_role("button", name="Sign in").click()
    pg.wait_for_url("**/admin**", timeout=20_000)
    pg.goto(BASE + "/admin/fleet?map=v2&e2e=1", wait_until="domcontentloaded")
    pg.locator("[data-testid=dispatch-page]").wait_for(timeout=20_000)
    # First-visit sheets (welcome, setup) can open a moment late; close whatever shows.
    for _ in range(3):
        pg.wait_for_timeout(1500)
        for label in ("Skip for now", "I'll finish this later"):
            try:
                pg.get_by_role("button", name=label).click(timeout=700)
            except Exception:
                pass
    pg.wait_for_timeout(500)
    return pg


def mouse_drag(pg, src, dst):
    a, b = src.bounding_box(), dst.bounding_box()
    pg.mouse.move(a["x"] + 40, a["y"] + 20)
    pg.mouse.down()
    pg.mouse.move(a["x"] + 60, a["y"] + 30, steps=4)
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=14)
    pg.wait_for_timeout(200)
    pg.mouse.up()


def touch_drag(pg, cdp, src, dst):
    a, b = src.bounding_box(), dst.bounding_box()
    x0, y0 = a["x"] + 40, a["y"] + 20
    x1, y1 = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    pt = lambda x, y: [{"x": x, "y": y, "id": 1}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pt(x0, y0)})
    pg.wait_for_timeout(420)  # the hold
    for i in range(1, 13):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pt(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12)})
        pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def toast_text(pg):
    t = pg.locator(".ap-toast")
    return t.last.inner_text() if t.count() else ""


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", None), args=ARGS)

    # ---------- desktop ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = open_page(ctx)
    check("desktop: page and map render", pg.locator(".ap-map").count() == 1)
    markers = pg.locator(".ap-tech").count()
    chips = pg.locator(".ap-chipbtn").count()
    check("desktop: a marker for technicians with a location", 0 < markers <= chips, f"{markers} markers, {chips} technicians")
    cards = pg.locator(".ap-card").count()
    check("desktop: unassigned queue lists jobs", cards > 0, f"{cards} cards")
    pg.screenshot(path=f"{SHOTS}/desktop-1-open.png")

    # Drop on a technician who is ready: assigns at once, with Undo.
    ready = pg.locator(".ap-chipbtn").first
    first_card = pg.locator(".ap-card").first
    mouse_drag(pg, first_card, ready)
    pg.wait_for_timeout(1200)
    text = toast_text(pg)
    clash = pg.locator(".ap-clash").count()
    if clash:
        pg.screenshot(path=f"{SHOTS}/desktop-2-clash.png")
        pg.get_by_role("button", name="Assign anyway").click()
        pg.wait_for_timeout(1200)
        text = toast_text(pg)
    check("desktop: drop assigns and offers Undo", "Offered to" in text and "Undo" in text, text.replace("\n", " "))
    after = pg.locator(".ap-card").count()
    check("desktop: assigned job leaves the queue", after == cards - 1, f"{cards} -> {after}")
    pg.screenshot(path=f"{SHOTS}/desktop-3-assigned.png")
    pg.get_by_role("button", name="Undo").last.click()
    pg.wait_for_timeout(1200)
    check("desktop: Undo puts it back", pg.locator(".ap-card").count() == cards, f"{pg.locator('.ap-card').count()} cards")

    # Drag to a technician who can't do it: the clash card asks first.
    seen_clash = False
    for i in range(chips):
        # A job due today: the demo seeds time off and skills that clash with it.
        card = pg.locator(".ap-card", has_text="Today").first
        mouse_drag(pg, card, pg.locator(".ap-chipbtn").nth(i))
        pg.wait_for_timeout(900)
        if pg.locator(".ap-clash").count():
            seen_clash = True
            msg = pg.locator(".ap-clash__text").inner_text()
            pg.screenshot(path=f"{SHOTS}/desktop-4-clash.png")
            check("desktop: clash card says why and asks 'Assign anyway?'", msg.rstrip().endswith("Assign anyway?"), msg.replace("\n", " "))
            pg.get_by_role("button", name="Cancel").click()
            break
        if pg.locator(".ap-toast").count():
            btn = pg.get_by_role("button", name="Undo")
            if btn.count():
                btn.last.click()
                pg.wait_for_timeout(900)
    check("desktop: a drop on an unqualified technician stops to ask", seen_clash)

    # Job inspector: ranked candidates and one-click Assign.
    pg.locator(".ap-card").first.click()
    pg.wait_for_timeout(800)
    insp = pg.locator(".ap-inspector")
    check("desktop: selecting a job opens its inspector", insp.count() == 1)
    pg.screenshot(path=f"{SHOTS}/desktop-5-job.png")
    assign_btn = insp.get_by_role("button", name="Assign").first
    if assign_btn.count():
        assign_btn.click()
        pg.wait_for_timeout(1200)
        t = toast_text(pg) or (pg.locator(".ap-clash__text").inner_text() if pg.locator(".ap-clash").count() else "")
        check("desktop: one-click Assign in the inspector", "Offered to" in t or "Assign anyway" in t, t.replace("\n", " "))
    pg.keyboard.press("Escape")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    try:
        pg.locator(".ap-inspector").wait_for(state="detached", timeout=4000)
    except Exception:
        pass
    pg.wait_for_timeout(900)  # let the panel transition finish; taps are held until it does
    check("desktop: Escape clears the selection", pg.locator(".ap-inspector").count() == 0)
    pg.get_by_role("button", name="Satellite").click()
    pg.wait_for_timeout(500)
    check("desktop: satellite toggle", pg.get_by_role("button", name="Satellite").get_attribute("aria-pressed") == "true")
    # Drag a job pin straight off the map onto a technician chip.
    pin = pg.evaluate("""() => {
      const h = window.__apMap; if (!h) return null;
      const board = [...document.querySelectorAll('.ap-card')].map(c => c.dataset.job);
      const m = h.controller().map; const r = document.querySelector('.ap-map').getBoundingClientRect();
      for (const id of board) {
        const ll = h.jobs().positionOf(id); if (!ll) continue;
        const pt = m.project(ll);
        const x = r.left + pt.x, y = r.top + pt.y;
        if (x > r.left + 360 && x < r.right - 380 && y > r.top + 80 && y < r.bottom - 120) return { id, x, y };
      }
      return null; }""")
    if pin:
        n0 = pg.locator(".ap-card").count()
        pg.mouse.move(pin["x"], pin["y"]); pg.mouse.down()
        pg.mouse.move(pin["x"] + 12, pin["y"] + 8, steps=3)
        tb = pg.locator(".ap-chipbtn").nth(3).bounding_box()
        pg.mouse.move(tb["x"] + 30, tb["y"] + 20, steps=14); pg.wait_for_timeout(200); pg.mouse.up()
        pg.wait_for_timeout(1200)
        t = toast_text(pg)
        check("desktop: dragging a pin off the map assigns it (or asks on a clash)", "Offered to" in t or pg.locator(".ap-clash").count() == 1, t.replace("\n", " "))
        if pg.locator(".ap-clash").count(): pg.get_by_role("button", name="Cancel").click()
    else:
        check("desktop: a job pin is on screen to drag", False)

    # Find: "/" opens the palette, typing narrows, Enter opens the technician.
    pg.keyboard.press("/")
    pg.wait_for_timeout(300)
    pg.keyboard.type("diego")
    pg.wait_for_timeout(200)
    pg.keyboard.press("Enter")
    try:
        pg.locator(".ap-inspector[data-tech]").wait_for(timeout=4000)
    except Exception:
        pass
    check("desktop: '/' finds a technician and opens their panel", pg.locator(".ap-inspector[data-tech]").count() == 1)
    # Message the technician without leaving the map.
    pg.locator(".ap-inspector").get_by_role("button", name="Message", exact=True).click()
    pg.wait_for_timeout(500)
    dlg = pg.locator("dialog.ap-msg[open]")
    check("desktop: Message opens the in-app thread", dlg.count() == 1)
    dlg.locator("textarea").fill("On your way? e2e check")
    dlg.get_by_role("button", name="Send").click()
    pg.wait_for_timeout(1500)
    check("desktop: a sent message appears in the thread", dlg.locator(".ap-bubble", has_text="e2e check").count() >= 1)
    pg.screenshot(path=f"{SHOTS}/desktop-message.png")
    dlg.get_by_role("button", name="Close").first.click()
    pg.wait_for_timeout(300)
    t_btn = pg.locator(".ap-inspector").get_by_role("button", name="Text", exact=True)
    if t_btn.count():
        t_btn.click()
        pg.wait_for_timeout(400)
        dlg = pg.locator("dialog.ap-msg[open]")
        dlg.locator("textarea").fill("e2e text")
        dlg.get_by_role("button", name="Send").click()
        pg.wait_for_timeout(1500)
        note = dlg.locator(".ap-ok").inner_text() if dlg.locator(".ap-ok").count() else dlg.locator(".ap-error").inner_text() if dlg.locator(".ap-error").count() else ""
        check("desktop: Text sends (or logs when texting isn't set up)", "Text sent" in note or "Logged" in note, note)
        dlg.get_by_role("button", name="Close").first.click()
    pg.keyboard.press("Escape")

    # Hover a team chip: the peek card shows name, status and jobs.
    pg.locator(".ap-chipbtn").nth(1).hover()
    pg.wait_for_timeout(700)
    check("desktop: hovering a technician shows a peek card", pg.locator(".ap-peek").count() == 1, pg.locator(".ap-peek").inner_text().replace("\n", " | ") if pg.locator(".ap-peek").count() else "")
    pg.screenshot(path=f"{SHOTS}/desktop-peek.png")
    pg.mouse.move(700, 400)
    pg.wait_for_timeout(300)
    check("desktop: the peek goes away when the pointer leaves", pg.locator(".ap-peek").count() == 0)
    sat = pg.locator(".maplibregl-ctrl-attrib").first.inner_text() if pg.locator(".maplibregl-ctrl-attrib").count() else ""
    check("desktop: satellite view credits Esri", "Esri" in sat, sat.replace("\n", " ")[:80])
    pg.get_by_role("button", name="Satellite").click()  # back to the dark map
    pg.wait_for_timeout(1200)
    credits_ok(pg, "desktop")

    # Installable app: manifest and service worker.
    mf = pg.request.get(BASE + "/admin/manifest.webmanifest")
    ok_mf = mf.ok and mf.json().get("scope") == "/admin/" and len(mf.json().get("icons", [])) >= 3
    check("desktop: web app manifest is served with scope /admin/", ok_mf)
    sw = pg.request.get(BASE + "/admin/sw.js")
    check("desktop: service worker is served and never cached", sw.ok and "no-cache" in (sw.headers.get("cache-control") or ""), sw.headers.get("cache-control", ""))
    pg.wait_for_timeout(1500)
    reg = pg.evaluate("navigator.serviceWorker.getRegistration('/admin/').then(r => !!r)")
    check("desktop: service worker registers under /admin/", reg is True)
    ctx.close()

    # ---------- iPad (touch) ----------
    ctx = browser.new_context(viewport={"width": 1024, "height": 1366}, has_touch=True, is_mobile=True)
    pg = open_page(ctx)
    check("ipad: layout is medium", pg.locator("[data-layout=medium]").count() == 1)
    pg.screenshot(path=f"{SHOTS}/ipad-1-open.png")
    cdp = ctx.new_cdp_session(pg)
    cards = pg.locator(".ap-card").count()
    touch_drag(pg, cdp, pg.locator(".ap-card").first, pg.locator(".ap-chipbtn").first)
    pg.wait_for_timeout(1200)
    t = toast_text(pg)
    c = pg.locator(".ap-clash").count()
    check("ipad: press-and-hold, drag, drop assigns (or asks on a clash)", "Offered to" in t or c == 1, t.replace("\n", " ") or f"clash={c}")
    pg.screenshot(path=f"{SHOTS}/ipad-2-dropped.png")
    ctx.close()

    # ---------- phone ----------
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    pg = open_page(ctx)
    check("phone: layout is narrow with a bottom sheet", pg.locator("[data-layout=narrow] .ap-sheet").count() == 1)
    credits_ok(pg, "phone")
    pg.screenshot(path=f"{SHOTS}/phone-1-open.png")
    pg.locator(".ap-sheet__grip").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=f"{SHOTS}/phone-2-half.png")
    pg.locator(".ap-card").first.click()
    pg.wait_for_timeout(800)
    check("phone: tapping a job opens its inspector in the sheet", pg.locator(".ap-sheet .ap-inspector").count() == 1)
    pg.screenshot(path=f"{SHOTS}/phone-3-job.png")
    # Swipe the grip up and down through the detents.
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(900)  # panel transition finishes before the swipe
    g = pg.locator(".ap-sheet__grip").bounding_box()
    d0 = pg.locator(".ap-sheet").get_attribute("data-detent")
    pg.mouse.move(g["x"] + g["width"] / 2, g["y"] + 10); pg.mouse.down(); pg.mouse.move(g["x"] + g["width"] / 2, g["y"] - 120, steps=6); pg.mouse.up()
    pg.wait_for_timeout(300)
    d1 = pg.locator(".ap-sheet").get_attribute("data-detent")
    check("phone: swiping the sheet grip up moves to the next detent", d0 != d1, f"{d0} -> {d1}")
    ctx.close()
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed. Screenshots: {SHOTS}")
sys.exit(0 if passed == len(results) else 1)
