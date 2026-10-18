#!/usr/bin/env python3
"""
Technician first run: permissions primer → four coach marks → practice job.

Runs the Expo web build of the technician app in Chromium at real device
sizes (iPhone SE, iPhone 13, Pixel 7, iPad Pro 11 portrait and landscape),
talking to a running ArrivePing server. For each device a brand-new
technician is created, signs in and checks that:
  1. the four tips appear in order (Jobs, On the clock, Start Driving on the
     practice job, Messages), each spotlighting its control with the card on
     screen and clear of the spotlight;
  2. the first tip points at the practice job, and tip 3 is on its screen;
  3. Done returns to Jobs, the device remembers it, and a reload doesn't
     show it again;
  4. Start Driving works on the practice job and "Remove it" is offered.
Then, once: Skip tour is recorded as skipped on the server, Profile → "Show
me around again" replays it, and (with VET_EMAIL) a technician who has
already completed real work gets no tour and no practice job.

The web build only stands in for the phone's layout and logic; the release
check on a real iPhone and iPad (TestFlight) is still needed for native
details (safe areas, Modal over the tab bar, VoiceOver).

Usage:
    cd packages/mobile && npx expo export --platform web --output-dir /tmp/tech-web
    WEB_DIR=/tmp/tech-web LOCAL_API=http://localhost:4200 \\
    ADMIN_EMAIL=... ADMIN_PASSWORD=... [VET_EMAIL=... VET_PASSWORD=...] \\
    python3 e2e/coach-tour.e2e.py

The build's API URL (app.json → extra.apiUrl) is answered by LOCAL_API.
"""
import functools
import http.server
import json
import os
import random
import re
import sys
import threading
from playwright.sync_api import sync_playwright, expect

WEB_DIR = os.environ["WEB_DIR"]
LOCAL = os.environ.get("LOCAL_API", "http://localhost:4200")
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
SHOT_DIR = os.environ.get("SHOT_DIR", "/tmp/coach-shots")
PORT = int(os.environ.get("WEB_PORT", "8081"))
APP = f"http://127.0.0.1:{PORT}"
API = json.load(open(os.path.join(os.path.dirname(__file__), "..", "app.json")))["expo"]["extra"]["apiUrl"].rstrip("/")
TECH_PASSWORD = "Coach-tour-" + str(random.randint(100000, 999999)) + "!"
DEVICES = [("iPhone SE", False), ("iPhone 13", False), ("Pixel 7", False), ("iPad Pro 11", False), ("iPad Pro 11", True)]
if os.environ.get("ONLY_DEVICE"):
    DEVICES = [d for d in DEVICES if d[0] == os.environ["ONLY_DEVICE"] and not d[1]]
os.makedirs(SHOT_DIR, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


class SpaHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        path = self.translate_path(self.path.split("?")[0])
        if not os.path.isfile(path):
            self.path = "/index.html"
        return super().send_head()


def serve():
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(SpaHandler, directory=WEB_DIR))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def wire(page):
    """Answer the build's production API URL from the local server (with CORS)."""

    def handle(route):
        req = route.request
        cors = {
            "access-control-allow-origin": req.headers.get("origin", APP),
            "access-control-allow-credentials": "true",
            "access-control-allow-headers": req.headers.get("access-control-request-headers", "*"),
            "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
            "access-control-expose-headers": "set-auth-token",
        }
        if req.method == "OPTIONS" or "/stream" in req.url:  # SSE can't be proxied; the app polls instead
            return route.fulfill(status=204, headers=cors)
        headers = {k: v for k, v in req.headers.items() if k.lower() not in ("origin", "host")}
        resp = route.fetch(url=LOCAL + req.url[len(API):], headers=headers)
        route.fulfill(response=resp, headers={**resp.headers, **cors})

    page.route(API + "/**", handle)


def new_tech(p, tag):
    email = f"coach-{tag}-{random.randint(10000, 99999)}@example.test"
    rc = p.request.new_context(base_url=LOCAL, extra_http_headers={"origin": LOCAL})
    rc.post("/api/auth/sign-in/email", data={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r = rc.post("/api/riders", data={"name": "New Tech", "email": email, "password": TECH_PASSWORD})
    assert r.ok, r.text()[:200]
    rc.dispose()
    return email


def open_app(browser, p, device, landscape, email, password):
    dev = dict(p.devices[device])
    if landscape:
        dev["viewport"] = {"width": dev["viewport"]["height"], "height": dev["viewport"]["width"]}
    page = browser.new_context(**dev).new_page()
    wire(page)
    page.goto(APP + "/sign-in", wait_until="networkidle")
    page.locator("input").nth(0).fill(email)
    page.locator("input").nth(1).fill(password)
    page.get_by_text("Sign in", exact=True).last.click()
    page.get_by_text("Got it, let's go").wait_for(timeout=20_000)
    page.get_by_text("Got it, let's go").click()
    return page


def server(page, path):
    return page.evaluate(
        """async ([url]) => (await fetch(url, { headers: { Authorization: 'Bearer ' + localStorage.getItem('bearer_token') } })).json()""",
        [API + path],
    )


TIPS = [("Your jobs land here", "practice"), ("Go on the clock", None), ("Tap when you leave", "job"), ("Talk to the office", None)]

serve()
with sync_playwright() as p:
    browser = p.chromium.launch()
    for device, landscape in DEVICES:
        name = device + (" landscape" if landscape else "")
        tag = re.sub(r"[^a-z0-9]+", "-", name.lower())
        page = open_app(browser, p, device, landscape, new_tech(p, tag), TECH_PASSWORD)
        card = page.get_by_test_id("coach-card")
        for k, (title, where) in enumerate(TIPS):
            expect(card).to_contain_text(title, timeout=15_000)
            page.wait_for_timeout(700)
            box, vp = card.bounding_box(), page.viewport_size
            ring = page.get_by_test_id("coach-ring")
            rb = ring.bounding_box() if ring.count() else None
            on_screen = box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= vp["width"] + 1 and box["y"] + box["height"] <= vp["height"] + 1
            clear = rb is not None and (box["y"] >= rb["y"] + rb["height"] - 1 or box["y"] + box["height"] <= rb["y"] + 1)
            page.screenshot(path=f"{SHOT_DIR}/{tag}-{k + 1}.png")
            body = page.inner_text("body")
            extra = True
            if where == "practice":
                extra = "PRACTICE" in body and "Practice job" in body
            elif where == "job":
                extra = "Nobody is texted and it isn't paid" in body and "Start Driving" in body
            check(f"[{name}] tip {k + 1} of 4: {title}", f"{k + 1} of 4" in card.inner_text() and on_screen and clear and extra)
            card.get_by_text("Done" if k == 3 else "Next", exact=True).click()
        expect(card).to_have_count(0, timeout=5_000)
        page.wait_for_timeout(800)
        check(f"[{name}] Done returns to Jobs and is remembered", "Practice job" in page.inner_text("body") and page.evaluate("() => Object.keys(localStorage).some((k) => k.startsWith('tour_seen_v1.') && localStorage.getItem(k) === 'completed')"))
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(4_000)
        check(f"[{name}] not shown again after a reload", card.count() == 0)
        page.get_by_text("Practice job").first.click()
        page.get_by_text("Start Driving", exact=True).click()
        page.get_by_text("I've Arrived", exact=True).wait_for(timeout=15_000)
        page.screenshot(path=f"{SHOT_DIR}/{tag}-practice-enroute.png")
        check(f"[{name}] Start Driving works on the practice job; Remove it is offered", page.get_by_text("Remove it", exact=True).count() == 1)
        page.context.close()

    # Skip and replay
    page = open_app(browser, p, "iPhone 13", False, new_tech(p, "skip"), TECH_PASSWORD)
    card = page.get_by_test_id("coach-card")
    expect(card).to_contain_text("Your jobs land here", timeout=15_000)
    card.get_by_text("Skip tour", exact=True).click()
    expect(card).to_have_count(0, timeout=5_000)
    page.wait_for_timeout(1_000)
    st = server(page, "/api/me/onboarding")
    local = page.evaluate("() => Object.keys(localStorage).filter((k) => k.startsWith('tour_seen_v1.')).map((k) => localStorage.getItem(k))")
    check("Skip tour is recorded as skipped, on the server and on the phone", st.get("state", {}).get("tours", {}).get("tech-app", {}).get("status") == "skipped" and local == ["skipped"], f"local={local}")
    page.get_by_text("Profile", exact=True).last.click()
    page.get_by_text("Show me around again").click()
    expect(card).to_contain_text("1 of 4", timeout=15_000)
    check("Profile → Show me around again replays it", True)
    card.get_by_text("Skip tour", exact=True).click()
    expect(card).to_have_count(0, timeout=5_000)
    # With the practice job removed, replay still has four tips; Start Driving
    # is explained without a spotlight instead of pointing at nothing.
    page.evaluate(
        """async ([url]) => (await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('bearer_token') } })).status""",
        [API + "/api/me/practice-job"],
    )
    page.get_by_text("Profile", exact=True).last.click()
    page.get_by_text("Show me around again").click()
    expect(card).to_contain_text("1 of 4", timeout=15_000)
    card.get_by_text("Next", exact=True).click()
    expect(card).to_contain_text("2 of 4", timeout=15_000)
    card.get_by_text("Next", exact=True).click()
    expect(card).to_contain_text("Tap Start Driving when you leave", timeout=3_000)
    check("replay after removing the practice job: Start Driving tip without a spotlight", page.get_by_test_id("coach-ring").count() == 0 and "3 of 4" in card.inner_text())
    page.context.close()

    if os.environ.get("VET_EMAIL"):
        page = open_app(browser, p, "iPhone 13", False, os.environ["VET_EMAIL"], os.environ["VET_PASSWORD"])
        page.wait_for_timeout(6_000)
        check("an experienced technician gets no tour and no practice job", page.get_by_test_id("coach-card").count() == 0 and "Practice job" not in page.inner_text("body"))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed. Screenshots: {SHOT_DIR}")
sys.exit(0 if all(results) else 1)
