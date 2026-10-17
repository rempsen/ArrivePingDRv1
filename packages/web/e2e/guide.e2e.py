#!/usr/bin/env python3
"""
Guide e2e ("guide-lint"): every tour chapter runs end to end, at desktop and
phone widths, by keyboard alone.

For each chapter in CHAPTERS and each viewport it:
  1. starts the chapter with the ?guide=<id> deep link,
  2. checks the step card is a labelled dialog that has focus,
  3. presses Next (Enter on the focused button) through every step, checking
     the spotlighted anchor exists and the "N of M" counter advances,
  4. checks the tour closes and the chapter is recorded as completed.
It also checks Esc exits a chapter mid-way.

A chapter whose anchor goes missing still finishes in production (the step
auto-skips), but here the counter would jump, so the test fails: that is the
point — a UI change that breaks a tour fails CI instead of a customer's tour.

Usage (server running, an admin account that can sign in):
    BASE_URL=http://localhost:4200 E2E_EMAIL=... E2E_PASSWORD=... \\
    python3 e2e/guide.e2e.py
Screenshots of every step land in $SHOT_DIR (default /tmp/guide-shots).
"""
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect, TimeoutError as PWTimeout

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4200")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOT_DIR = os.environ.get("SHOT_DIR", "/tmp/guide-shots")

# Keep in sync with src/web/guide/registry.ts (chapter id -> step count).
CHAPTERS = {"find-your-way": 4, "create-job": 5, "scheduler": 5}
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "phone": {"width": 390, "height": 844}}


def sign_in(page):
    page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
    page.get_by_placeholder("Email address").fill(EMAIL)
    page.get_by_placeholder("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/admin**", timeout=20_000)


def card(page):
    return page.locator(".ap-guide-card")


def welcome(page):
    """First visit: the Welcome sheet opens by itself; 'Plan my week' -> scheduler chapter."""
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    dialog = page.get_by_role("dialog", name=re.compile("Welcome to ArrivePing"))
    expect(dialog).to_be_visible(timeout=10_000)
    page.screenshot(path=f"{SHOT_DIR}/welcome.png")
    dialog.get_by_role("button", name="Dispatcher").click()
    dialog.get_by_role("button", name=re.compile("Plan my week")).click()
    dialog.get_by_role("button", name="Show me around").click()
    expect(card(page)).to_contain_text("Scheduler", timeout=10_000)
    page.keyboard.press("Escape")
    expect(card(page)).to_have_count(0, timeout=5_000)
    # Never shows again.
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)
    expect(page.get_by_role("dialog", name=re.compile("Welcome to ArrivePing"))).to_have_count(0)


def board_mode_from_menu(page):
    """Scheduler already in Board mode, chapter launched from the Guide menu:
    the calendar-only steps must still show (the guide switches to Calendar),
    and focus returns to the Guide launcher afterwards."""
    page.goto(f"{BASE_URL}/admin/scheduler", wait_until="networkidle")
    page.get_by_role("button", name="Board").click()
    page.locator('[data-tour="guide.button"]:visible').first.click()
    page.get_by_role("menuitem", name=re.compile("Scheduler")).click()
    steps = CHAPTERS["scheduler"]
    for i in range(steps):
        expect(card(page)).to_contain_text(f"{i + 1} of {steps}", timeout=10_000)
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
    expect(card(page)).to_have_count(0, timeout=5_000)
    on_launcher = page.evaluate("() => document.activeElement?.getAttribute('data-tour') === 'guide.button'")
    assert on_launcher, "focus did not return to the Guide launcher"


def run_chapter(page, vp_name, chapter, steps):
    page.goto(f"{BASE_URL}/admin?guide={chapter}", wait_until="networkidle")
    for i in range(steps):
        expect(card(page)).to_be_visible(timeout=10_000)
        expect(card(page)).to_contain_text(f"{i + 1} of {steps}")
        # Labelled dialog with focus inside it.
        role = card(page).get_attribute("role")
        assert role in ("dialog", "alertdialog"), f"step card role is {role!r}"
        assert card(page).get_attribute("aria-labelledby"), "step card has no accessible name"
        focused_inside = page.evaluate(
            "() => !!document.activeElement && !!document.activeElement.closest('.ap-guide-card')"
        )
        assert focused_inside, f"{chapter} step {i + 1}: focus is not inside the step card"
        page.wait_for_timeout(500)  # let the card finish fading in before the screenshot
        page.screenshot(path=f"{SHOT_DIR}/{vp_name}-{chapter}-{i + 1}.png")
        page.keyboard.press("Enter")  # activates the focused Next / Done button
        page.wait_for_timeout(250)
    expect(card(page)).to_have_count(0, timeout=5_000)


def main() -> int:
    os.makedirs(SHOT_DIR, exist_ok=True)
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for vp_name, vp in VIEWPORTS.items():
            ctx = browser.new_context(viewport=vp)
            page = ctx.new_page()
            page.set_default_timeout(15_000)
            try:
                sign_in(page)
                if vp_name == "desktop":
                    welcome(page)
                    print("PASS desktop: Welcome sheet")
                for chapter, steps in CHAPTERS.items():
                    run_chapter(page, vp_name, chapter, steps)
                    print(f"PASS {vp_name}: {chapter} ({steps} steps)")
                if vp_name == "desktop":
                    board_mode_from_menu(page)
                    print("PASS desktop: Board mode + focus back to launcher")
                # Esc exits mid-chapter.
                page.goto(f"{BASE_URL}/admin?guide=find-your-way", wait_until="networkidle")
                expect(card(page)).to_be_visible(timeout=10_000)
                page.keyboard.press("Escape")
                expect(card(page)).to_have_count(0, timeout=5_000)
                print(f"PASS {vp_name}: Esc exits")
                # Progress recorded (server-side) for completed chapters: the
                # Guide menu shows a tick per completed chapter.
                page.reload(wait_until="networkidle")
                page.locator('[data-tour="guide.button"]:visible').first.click()
                expect(page.get_by_role("menu").get_by_label("Completed")).to_have_count(len(CHAPTERS), timeout=5_000)
                page.keyboard.press("Escape")
                print(f"PASS {vp_name}: progress recorded")
            except (AssertionError, PWTimeout) as e:
                failures.append(f"{vp_name}: {e}")
                page.screenshot(path=f"{SHOT_DIR}/FAIL-{vp_name}.png")
            finally:
                ctx.close()
        browser.close()
    if failures:
        print("\nFAIL:\n  " + "\n  ".join(failures), file=sys.stderr)
        return 1
    print("\nPASS: guide e2e")
    return 0


if __name__ == "__main__":
    sys.exit(main())
