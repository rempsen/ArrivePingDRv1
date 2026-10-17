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
CHAPTERS = {"find-your-way": 4, "scheduler": 5}
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "phone": {"width": 390, "height": 844}}


def sign_in(page):
    page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
    page.get_by_placeholder("Email address").fill(EMAIL)
    page.get_by_placeholder("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/admin**", timeout=20_000)


def card(page):
    return page.locator(".ap-guide-card")


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
                for chapter, steps in CHAPTERS.items():
                    run_chapter(page, vp_name, chapter, steps)
                    print(f"PASS {vp_name}: {chapter} ({steps} steps)")
                # Esc exits mid-chapter.
                page.goto(f"{BASE_URL}/admin?guide=find-your-way", wait_until="networkidle")
                expect(card(page)).to_be_visible(timeout=10_000)
                page.keyboard.press("Escape")
                expect(card(page)).to_have_count(0, timeout=5_000)
                print(f"PASS {vp_name}: Esc exits")
                # Progress recorded for completed chapters.
                done = page.evaluate(
                    "() => Object.entries(localStorage).filter(([k]) => k.startsWith('ap_guide_v1:')).map(([,v]) => v).join('')"
                )
                for chapter in CHAPTERS:
                    if not re.search(rf'"{chapter}":"completed"', done):
                        raise AssertionError(f"{chapter} not recorded as completed: {done}")
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
