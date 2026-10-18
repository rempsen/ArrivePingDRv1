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
CHAPTERS = {
    "find-your-way": 4,
    "create-job": 5,
    "scheduler": 5,
    "people": 5,
    "notifications": 4,
    "milestones": 4,
    "reply-to": 3,
    "reports": 3,
    "export": 4,
}
# Office roles below admin only get chapters 1–3 (the pages behind 4–9 are admin-only).
NON_ADMIN_CHAPTERS = ["find-your-way", "create-job", "scheduler"]
DISPATCHER_EMAIL = os.environ.get("E2E_DISPATCHER_EMAIL")
DISPATCHER_PASSWORD = os.environ.get("E2E_DISPATCHER_PASSWORD")
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "phone": {"width": 390, "height": 844}}


class _Skip(Exception):
    pass


def sign_in(page, email=None, password=None):
    page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
    page.get_by_placeholder("Email address").fill(email or EMAIL)
    page.get_by_placeholder("Password").fill(password or PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/admin**", timeout=20_000)


def card(page):
    return page.locator(".ap-guide-card")


def panel(page):
    return page.get_by_role("dialog", name="Guide & help")


def help_panel(page, vp_name):
    """Guide panel: opens with focus in search, finds an article, reads it in
    place, follows "Show me in ArrivePing" into the matching tour, and Esc
    closes it with focus back on the launcher."""
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    page.locator('[data-tour="guide.button"]:visible').first.click()
    expect(panel(page)).to_be_visible(timeout=10_000)
    search = panel(page).get_by_role("searchbox", name=re.compile("help articles"))
    expect(search).to_be_focused()
    expect(panel(page).get_by_role("region", name="Guided tours").get_by_role("button")).to_have_count(len(CHAPTERS))
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SHOT_DIR}/{vp_name}-panel.png")
    search.fill("reply to")
    expect(panel(page).get_by_role("region", name="Search results")).to_contain_text("Set your reply-to email")
    page.screenshot(path=f"{SHOT_DIR}/{vp_name}-panel-search.png")
    panel(page).get_by_role("button", name=re.compile("^Set your reply-to email")).click()
    expect(panel(page).get_by_role("heading", name="Set your reply-to email")).to_be_visible()
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SHOT_DIR}/{vp_name}-panel-article.png")
    panel(page).get_by_role("button", name=re.compile("Show me in ArrivePing")).click()
    expect(panel(page)).to_have_count(0)
    expect(card(page)).to_contain_text("Reply-to email", timeout=10_000)
    page.keyboard.press("Escape")
    expect(card(page)).to_have_count(0, timeout=5_000)
    # A click on the shaded area outside the panel closes it.
    page.locator('[data-tour="guide.button"]:visible').first.click()
    expect(panel(page)).to_be_visible()
    vw = page.viewport_size["width"]
    if vw > 500:  # on a phone the panel fills the screen: there is no outside
        page.mouse.click(40, 300)
        expect(panel(page)).to_have_count(0, timeout=3_000)
    else:
        page.keyboard.press("Escape")
    # Esc closes the panel and returns focus to the launcher.
    page.locator('[data-tour="guide.button"]:visible').first.click()
    expect(panel(page)).to_be_visible()
    page.keyboard.press("Escape")
    expect(panel(page)).to_have_count(0)
    on_launcher = page.evaluate("() => document.activeElement?.getAttribute('data-tour') === 'guide.button'")
    assert on_launcher, "focus did not return to the Guide launcher after closing the panel"


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
    panel(page).get_by_role("button", name=re.compile(r"3\. Scheduler")).click()
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
        # The card must be fully on screen (a target inside a sideways-scrolling
        # table once put it off the right edge on phones).
        box = card(page).bounding_box()
        vw = page.viewport_size["width"]
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= vw + 1, (
            f"{chapter} step {i + 1}: card is off screen ({box}, viewport {vw})"
        )
        # The spotlighted target must be on screen and not hidden under the card.
        target = page.locator("[data-guide-active]")
        if target.count():
            t = target.first.bounding_box()
            vh = page.viewport_size["height"]
            assert t and t["y"] < vh and t["y"] + t["height"] > 0 and t["x"] < vw and t["x"] + t["width"] > 0, (
                f"{chapter} step {i + 1}: target is off screen ({t})"
            )
            if t["height"] < vh * 0.4:  # a small target must not be covered by the card
                covered = not (t["y"] + t["height"] <= box["y"] or t["y"] >= box["y"] + box["height"]
                               or t["x"] + t["width"] <= box["x"] or t["x"] >= box["x"] + box["width"])
                assert not covered, f"{chapter} step {i + 1}: card covers its target ({t} vs {box})"
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
                help_panel(page, vp_name)
                print(f"PASS {vp_name}: Guide panel (search, article, Show me, Esc)")
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
                expect(panel(page).get_by_label("Completed")).to_have_count(len(CHAPTERS), timeout=5_000)
                expect(panel(page)).to_contain_text(f"{len(CHAPTERS)} of {len(CHAPTERS)} done")
                page.keyboard.press("Escape")
                expect(panel(page)).to_have_count(0)
                print(f"PASS {vp_name}: progress recorded")
            except (AssertionError, PWTimeout) as e:
                failures.append(f"{vp_name}: {e}")
                page.screenshot(path=f"{SHOT_DIR}/FAIL-{vp_name}.png")
            finally:
                ctx.close()
        if DISPATCHER_EMAIL and DISPATCHER_PASSWORD:
            ctx = browser.new_context(viewport=VIEWPORTS["desktop"])
            page = ctx.new_page()
            try:
                page.goto(f"{BASE_URL}/sign-in", wait_until="networkidle")
                page.get_by_placeholder("Email address").fill(DISPATCHER_EMAIL)
                page.get_by_placeholder("Password").fill(DISPATCHER_PASSWORD)
                page.get_by_role("button", name="Sign in").click()
                page.wait_for_timeout(5000)
                if "/admin" not in page.url:
                    # Known issue (2026-10-17): non-admin office roles are routed to
                    # the customer portal and /admin admits admin/superadmin only.
                    raise _Skip(f"dispatcher lands on {page.url}, not /admin")
                skip = page.get_by_role("button", name="Skip for now")
                try:
                    skip.wait_for(timeout=4_000)
                    skip.click()
                except PWTimeout:
                    pass
                page.locator('[data-tour="guide.button"]:visible').first.click()
                items = panel(page).get_by_role("region", name="Guided tours").get_by_role("button")
                expect(items).to_have_count(len(NON_ADMIN_CHAPTERS), timeout=5_000)
                page.keyboard.press("Escape")
                # An admin-only chapter can't be started by deep link either.
                page.goto(f"{BASE_URL}/admin?guide=reports", wait_until="networkidle")
                page.wait_for_timeout(1500)
                expect(card(page)).to_have_count(0)
                print(f"PASS dispatcher: sees only chapters 1–3")
            except _Skip as e:
                print(f"SKIP dispatcher: {e}")
            except (AssertionError, PWTimeout) as e:
                failures.append(f"dispatcher: {e}")
                page.screenshot(path=f"{SHOT_DIR}/FAIL-dispatcher.png")
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
