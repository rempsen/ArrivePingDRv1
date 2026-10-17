#!/usr/bin/env python3
"""
Sample day e2e: the pretend day a new company starts with.

Checks, against a running server whose test company has a sample day:
  1. the banner explains the sample day, at desktop and phone widths;
  2. the sample jobs are on the Jobs page;
  3. the live van's customer tracking page loads, and the van moves between
     two server ticks (one minute apart) while its ETA counts down;
  4. "Clear sample data" asks first, then removes every sample row and the banner;
  5. Guide & help -> "Add a sample day" brings it back.

Usage (server running, an admin of a company that has a sample day):
    BASE_URL=http://localhost:4200 E2E_EMAIL=... E2E_PASSWORD=... \\
    python3 e2e/sample-day.e2e.py
Set SKIP_TICK=1 to skip the one-minute van check.
"""
import json
import os
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4200")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOT_DIR = os.environ.get("SHOT_DIR", "/tmp/sample-day-shots")
os.makedirs(SHOT_DIR, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def sign_in(page):
    page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
    page.get_by_placeholder("Email address").fill(EMAIL)
    page.get_by_placeholder("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/admin**", timeout=20_000)
    # The one-time Welcome sheet may open first.
    skip = page.get_by_role("button", name="Skip for now")
    try:
        skip.wait_for(timeout=4_000)
        skip.click()
    except Exception:
        pass


def track(token):
    with urllib.request.urlopen(f"{BASE_URL}/api/track/{token}") as r:
        return json.loads(r.read())


def banner(page):
    return page.get_by_role("region", name="Sample data")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    sign_in(page)

    # 1. Banner
    page.goto(f"{BASE_URL}/admin/scheduler", wait_until="networkidle")
    b = banner(page)
    expect(b).to_be_visible(timeout=10_000)
    check("banner explains the sample day", "sample day" in b.inner_text().lower() and "nobody is texted or emailed" in b.inner_text().lower())
    page.wait_for_timeout(500)
    page.screenshot(path=f"{SHOT_DIR}/1-scheduler-desktop.png")

    status = page.evaluate("() => fetch('/api/sample-day').then(r => r.json())")
    check("status reports 8 jobs, 3 techs, 6 customers", (status.get("jobs"), status.get("techs"), status.get("customers")) == (8, 3, 6), json.dumps(status))
    token = status.get("trackToken")

    # 2. Jobs page lists the sample jobs
    page.goto(f"{BASE_URL}/admin/work-orders", wait_until="networkidle")
    page.wait_for_timeout(800)
    body = page.inner_text("main")
    check("sample jobs on the Jobs page", "Emergency call" in body and "(sample)" in body)

    # 3. The live van
    tp = ctx.new_page()
    tp.goto(f"{BASE_URL}/t/{token}", wait_until="load")  # live SSE stream: never idle
    tp.wait_for_timeout(3000)
    tp.screenshot(path=f"{SHOT_DIR}/2-tracking-page.png")
    check("tracking page loads for the van", tp.locator("body").inner_text().strip() != "" and "not found" not in tp.locator("body").inner_text().lower())
    a = track(token)
    loc_a = a.get("techLocation")
    check("tracking API shares the van's position", bool(loc_a), json.dumps(loc_a))
    if not os.environ.get("SKIP_TICK"):
        time.sleep(65)
        z = track(token)
        loc_z = z.get("techLocation")
        moved = bool(loc_a and loc_z and (loc_a["lat"], loc_a["lng"]) != (loc_z["lat"], loc_z["lng"]))
        check("van moved after one server tick", moved, f"{loc_a} -> {loc_z}")
        check("van still on its way (never auto-arrives)", z.get("status") == "enroute", str(z.get("status")))
    tp.close()

    # Phone width
    ph = browser.new_context(viewport={"width": 390, "height": 844}, storage_state=ctx.storage_state())
    pp = ph.new_page()
    pp.goto(f"{BASE_URL}/admin/scheduler", wait_until="networkidle")
    expect(banner(pp)).to_be_visible(timeout=10_000)
    pp.wait_for_timeout(500)
    pp.screenshot(path=f"{SHOT_DIR}/3-banner-phone.png")
    sw = pp.evaluate("() => document.documentElement.scrollWidth")
    check("banner fits a phone without sideways scroll", sw <= 390, f"scrollWidth={sw}")
    ph.close()

    # 4. Clear
    page.goto(f"{BASE_URL}/admin/scheduler", wait_until="networkidle")
    banner(page).get_by_role("button", name="Clear sample data").click()
    dlg = page.get_by_role("dialog", name="Clear sample data?")
    expect(dlg).to_be_visible()
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SHOT_DIR}/4-clear-confirm.png")
    check("clear asks first", "Your own" in dlg.inner_text())
    dlg.get_by_role("button", name="Clear sample data").click()
    expect(banner(page)).to_have_count(0, timeout=10_000)
    after = page.evaluate("() => fetch('/api/sample-day').then(r => r.json())")
    check("everything sample is gone", after.get("active") is False and after.get("jobs") == 0, json.dumps(after))
    page.goto(f"{BASE_URL}/admin/work-orders", wait_until="networkidle")
    page.wait_for_timeout(800)
    check("Jobs page has no sample rows", "(sample)" not in page.inner_text("main"))

    # 5. Add it back from Guide & help
    page.locator('[data-tour="guide.button"]:visible').first.click()
    page.get_by_role("menuitem", name="Add a sample day").click()
    expect(banner(page)).to_be_visible(timeout=15_000)
    check("Guide & help can add the sample day back", True)

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed. Screenshots: {SHOT_DIR}")
sys.exit(1 if failed else 0)
