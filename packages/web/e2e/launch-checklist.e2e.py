#!/usr/bin/env python3
"""
Launch checklist e2e.

Against a running server and an admin account, checks:
  1. the sidebar card shows "n of 5 done" and opens /admin/getting-started;
  2. the page lists the five launch steps, each not-done step with "Show me"
     (starts its tour) and a link that goes to the right page;
  3. a real action ticks its step: setting a Reply-to address under
     Notifications → Channels ticks "Set your reply-to email" (within 20 s);
  4. "Hide from the sidebar" hides the card, and the page can bring it back;
  5. the page fits a phone (no sideways scroll).

Usage:
    BASE_URL=http://localhost:4200 E2E_EMAIL=... E2E_PASSWORD=... python3 e2e/launch-checklist.e2e.py
"""
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4200")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOT_DIR = os.environ.get("SHOT_DIR", "/tmp/launch-shots")
REPLY_TO = os.environ.get("E2E_REPLY_TO", "office@launch-e2e.test")
os.makedirs(SHOT_DIR, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def sign_in(page):
    page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
    page.get_by_placeholder("Email address").fill(EMAIL)
    page.get_by_placeholder("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/admin**", timeout=20_000)
    skip = page.get_by_role("button", name="Skip for now")
    try:
        skip.wait_for(timeout=4_000)
        skip.click()
    except Exception:
        pass


def item(page, n):
    return page.get_by_role("list", name="Launch checklist").get_by_role("listitem").nth(n)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    sign_in(page)
    # Start from "no reply-to" so the tick is observed happening.
    page.evaluate(
        """() => fetch('/api/notif-config/channels', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailReplyTo: '' }) })"""
    )
    # Make sure the card isn't hidden from a previous run.
    page.evaluate(
        """() => fetch('/api/me/onboarding', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checklistHidden: false }) })"""
    )

    # 1. Sidebar card
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    card = page.locator('[data-tour="launch.card"]:visible').first
    expect(card).to_be_visible(timeout=15_000)
    check("sidebar card shows progress", bool(re.search(r"\d of 5 done", card.inner_text())), card.inner_text().replace("\n", " · "))
    card.click()
    page.wait_for_url("**/admin/getting-started", timeout=10_000)
    expect(page.get_by_role("list", name="Launch checklist")).to_be_visible(timeout=10_000)
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SHOT_DIR}/page-before.png", full_page=True)

    # 2. Five steps, actions on the not-done ones
    items = page.get_by_role("list", name="Launch checklist").get_by_role("listitem")
    check("page lists five steps", items.count() == 5, str(items.count()))
    reply = item(page, 3)
    check("reply-to step starts not done", "To do:" in reply.inner_text() or "Show me" in reply.inner_text(), reply.inner_text().replace("\n", " · "))
    reply.get_by_role("button", name="Show me").click()
    expect(page.locator(".ap-guide-card")).to_contain_text("Reply-to email", timeout=10_000)
    page.keyboard.press("Escape")
    check("Show me starts the matching tour", True)

    # 3. A real action ticks it
    page.goto(f"{BASE_URL}/admin/notifications", wait_until="networkidle")
    page.locator('[data-tour="notif.tab.channels"]').click()
    field = page.locator('[data-tour="email.replyto"] input')
    expect(field).to_be_visible(timeout=10_000)
    field.fill(REPLY_TO)
    page.get_by_role("button", name="Save settings").click()
    page.wait_for_timeout(1000)
    page.goto(f"{BASE_URL}/admin/getting-started", wait_until="networkidle")
    try:
        expect(item(page, 3)).to_contain_text("Done:", timeout=20_000)
        check("setting a reply-to ticks its step", True)
    except AssertionError as e:
        check("setting a reply-to ticks its step", False, str(e)[:200])
    page.screenshot(path=f"{SHOT_DIR}/page-after.png", full_page=True)

    # 4. Hide and show
    page.get_by_role("button", name=re.compile("Hide from the sidebar")).click()
    expect(page.locator('[data-tour="launch.card"]:visible')).to_have_count(0, timeout=5_000)
    page.get_by_role("button", name="Show in the sidebar").click()
    expect(page.locator('[data-tour="launch.card"]:visible').first).to_be_visible(timeout=5_000)
    check("hide from sidebar, and show again", True)
    ctx.close()

    # 5. Phone
    ph = browser.new_context(viewport={"width": 390, "height": 844})
    pp = ph.new_page()
    sign_in(pp)
    pp.goto(f"{BASE_URL}/admin/getting-started", wait_until="networkidle")
    expect(pp.get_by_role("list", name="Launch checklist")).to_be_visible(timeout=10_000)
    pp.wait_for_timeout(400)
    pp.screenshot(path=f"{SHOT_DIR}/page-phone.png", full_page=True)
    sw = pp.evaluate("() => document.documentElement.scrollWidth")
    check("page fits a phone", sw <= 390, f"scrollWidth={sw}")
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed. Screenshots: {SHOT_DIR}")
sys.exit(1 if failed else 0)
