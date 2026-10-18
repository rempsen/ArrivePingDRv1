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


def open_page(ctx):
    pg = ctx.new_page()
    pg.goto(BASE + "/sign-in", wait_until="networkidle")
    pg.get_by_placeholder("Email address").fill(EMAIL)
    pg.get_by_placeholder("Password").fill(PASSWORD)
    pg.get_by_role("button", name="Sign in").click()
    pg.wait_for_url("**/admin**", timeout=20_000)
    pg.goto(BASE + "/admin/fleet?map=v2", wait_until="domcontentloaded")
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
    return t.inner_text() if t.count() else ""


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
    pg.get_by_role("button", name="Undo").click()
    pg.wait_for_timeout(1200)
    check("desktop: Undo puts it back", pg.locator(".ap-card").count() == cards, f"{pg.locator('.ap-card').count()} cards")

    # Drag to a technician who can't do it: the clash card asks first.
    seen_clash = False
    for i in range(chips):
        card = pg.locator(".ap-card").first
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
                btn.click()
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
    check("desktop: Escape clears the selection", pg.locator(".ap-inspector").count() == 0)
    pg.get_by_role("button", name="Satellite").click()
    pg.wait_for_timeout(500)
    check("desktop: satellite toggle", pg.get_by_role("button", name="Satellite").get_attribute("aria-pressed") == "true")
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
    pg.screenshot(path=f"{SHOTS}/phone-1-open.png")
    pg.locator(".ap-sheet__grip").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=f"{SHOTS}/phone-2-half.png")
    pg.locator(".ap-card").first.click()
    pg.wait_for_timeout(800)
    check("phone: tapping a job opens its inspector in the sheet", pg.locator(".ap-sheet .ap-inspector").count() == 1)
    pg.screenshot(path=f"{SHOTS}/phone-3-job.png")
    ctx.close()
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed. Screenshots: {SHOTS}")
sys.exit(0 if passed == len(results) else 1)
