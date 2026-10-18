#!/usr/bin/env python3
"""
"Ask ArrivePing" e2e (the Guide panel's help assistant).

The model's answers are canned here (the browser's /api/guide/ask calls are
answered by the test), so this checks the panel itself, on desktop and phone:
  1. with Ask on, the box reads "Ask a question or search help" and typing
     shows an "Ask ArrivePing" row above the matching articles;
  2. Enter sends the question with the company's words, the answer streams in,
     and the suggestions show as buttons;
  3. "Read:" opens the article in the panel and Back returns to the answer;
  4. a follow-up sends the earlier turn back; "Open …" goes to the page;
  5. "Show me:" closes the panel and starts the tour;
  6. a 429 shows a friendly message; with Ask off (no AI key, the real server
     locally) the box is plain search with no Ask row;
  7. the conversation fits a phone.
The route itself (streaming, allowlist, roles, 503) is covered by
src/api/routes/__tests__/guide-ask.test.ts with a mock model.

Usage:
    BASE_URL=http://localhost:4200 E2E_EMAIL=... E2E_PASSWORD=... python3 e2e/guide-ask.e2e.py
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4200")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOT_DIR = os.environ.get("SHOT_DIR", "/tmp/guide-ask-shots")
os.makedirs(SHOT_DIR, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def sse(*events):
    return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events) + "event: done\ndata: {}\n\n"


ANSWERS = {
    "reply": sse(
        ("delta", {"text": "Go to **Setup → Notifications**, open the Channels tab "}),
        ("delta", {"text": "and type the inbox in Reply-to."}),
        ("action", {"type": "tour", "id": "reply-to"}),
        ("action", {"type": "article", "slug": "set-your-reply-to-email"}),
    ),
    "sender": sse(
        ("delta", {"text": "The sender name is on the same tab, just above Reply-to."}),
        ("action", {"type": "page", "route": "/admin/notifications"}),
    ),
}


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


def panel(page):
    return page.get_by_role("dialog", name="Guide & help")


def open_panel(page):
    page.locator('[data-tour="guide.button"]:visible').first.click()
    expect(panel(page)).to_be_visible(timeout=10_000)


def fake_ask(page, sent, status=200, available=True):
    def handle(route):
        req = route.request
        if req.method == "GET":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"available": available}))
        body = json.loads(req.post_data or "{}")
        sent.append(body)
        if status != 200:
            return route.fulfill(status=status, content_type="application/json", body=json.dumps({"message": "nope"}))
        key = "sender" if "sender" in body.get("question", "") else "reply"
        return route.fulfill(status=200, headers={"content-type": "text/event-stream"}, body=ANSWERS[key])

    page.route("**/api/guide/ask", handle)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for vp, size in {"desktop": {"width": 1280, "height": 800}, "phone": {"width": 390, "height": 844}}.items():
        ctx = browser.new_context(viewport=size)
        page = ctx.new_page()
        sent = []
        fake_ask(page, sent)
        sign_in(page)
        page.goto(f"{BASE_URL}/admin", wait_until="networkidle")

        # 1. The box, and the Ask row above the results
        open_panel(page)
        box = panel(page).get_by_role("searchbox", name="Ask a question or search help articles")
        expect(box).to_be_focused()
        box.fill("How do I change the reply-to email?")
        ask_row = panel(page).get_by_role("button", name=re.compile("^Ask ArrivePing"))
        expect(ask_row).to_be_visible()
        expect(panel(page).get_by_role("region", name="Search results")).to_contain_text("Set your reply-to email")
        page.screenshot(path=f"{SHOT_DIR}/{vp}-1-typed.png")
        check(f"{vp}: Ask row above the matching articles", True)

        # 2. Enter asks; the answer streams in with buttons
        box.press("Enter")
        conv = panel(page).get_by_role("region", name="Ask ArrivePing")
        expect(conv.get_by_test_id("ask-answer")).to_contain_text("type the inbox in Reply-to", timeout=10_000)
        expect(conv.get_by_role("button", name=re.compile("^Show me: Reply-to email"))).to_be_visible()
        expect(conv.get_by_role("button", name=re.compile("^Read: Set your reply-to email"))).to_be_visible()
        first = sent[0] if sent else {}
        check(
            f"{vp}: sends the question and the company's words, no history",
            first.get("question") == "How do I change the reply-to email?" and isinstance(first.get("terms"), dict) and not first.get("history"),
            json.dumps(first)[:200],
        )
        bold = conv.locator("strong", has_text="Setup → Notifications").count()
        check(f"{vp}: answer renders bold, not asterisks", bold == 1 and "**" not in conv.inner_text())
        page.wait_for_timeout(200)
        page.screenshot(path=f"{SHOT_DIR}/{vp}-2-answer.png")

        # 3. Read the article in the panel, Back to the answer
        conv.get_by_role("button", name=re.compile("^Read: ")).click()
        expect(panel(page).get_by_role("heading", name="Set your reply-to email")).to_be_visible()
        panel(page).get_by_role("button", name="Back").click()
        expect(panel(page).get_by_role("region", name="Ask ArrivePing")).to_contain_text("type the inbox in Reply-to")
        check(f"{vp}: Read opens the article; Back returns to the answer", True)

        # 4. Follow-up carries the earlier turn; Open goes to the page
        follow = panel(page).get_by_role("searchbox", name="Ask a follow-up question")
        follow.fill("And the sender name?")
        follow.press("Enter")
        expect(conv.get_by_test_id("ask-answer").nth(1)).to_contain_text("just above Reply-to", timeout=10_000)
        hist = sent[-1].get("history") if sent else None
        check(
            f"{vp}: follow-up sends the earlier turn back",
            isinstance(hist, list) and len(hist) == 2 and hist[0]["role"] == "user" and "reply-to" in hist[0]["text"],
            json.dumps(hist)[:200],
        )
        page.screenshot(path=f"{SHOT_DIR}/{vp}-3-followup.png", full_page=False)
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        check(f"{vp}: conversation fits the screen", sw <= size["width"], f"scrollWidth={sw}")
        conv.get_by_role("link", name=re.compile("^Open Setup → Notifications")).click()
        page.wait_for_url("**/admin/notifications", timeout=10_000)
        expect(panel(page)).to_have_count(0)
        check(f"{vp}: Open goes to the page and closes the panel", True)

        # 5. Show me starts the tour
        open_panel(page)
        box = panel(page).get_by_role("searchbox", name="Ask a question or search help articles")
        box.fill("reply-to email please")
        box.press("Enter")
        panel(page).get_by_role("button", name=re.compile("^Show me: Reply-to email")).click()
        expect(panel(page)).to_have_count(0)
        expect(page.locator(".ap-guide-card")).to_contain_text("Your name on every email", timeout=10_000)
        page.keyboard.press("Escape")
        check(f"{vp}: Show me starts the tour", True)
        ctx.close()

    # 6a. Rate limited
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    fake_ask(page, [], status=429)
    sign_in(page)
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    open_panel(page)
    box = panel(page).get_by_role("searchbox", name="Ask a question or search help articles")
    box.fill("anything")
    box.press("Enter")
    expect(panel(page).get_by_role("region", name="Ask ArrivePing")).to_contain_text("You've asked a lot of questions", timeout=10_000)
    check("429 shows a friendly message", True)
    ctx.close()

    # 6b. The real server without an AI key: plain search, no Ask row
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    sign_in(page)
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    avail = page.evaluate("async () => (await (await fetch('/api/guide/ask')).json())")
    post = page.evaluate(
        "async () => (await fetch('/api/guide/ask', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({question:'hi'})})).status"
    )
    open_panel(page)
    box = panel(page).get_by_role("searchbox", name="Search help articles")
    box.fill("reply to")
    expect(panel(page).get_by_role("region", name="Search results")).to_contain_text("Set your reply-to email")
    rows = panel(page).get_by_role("button", name=re.compile("^Ask ArrivePing")).count()
    check("without an AI key: plain search, no Ask row, POST is 503", avail == {"available": False} and rows == 0 and post == 503, f"{avail} rows={rows} post={post}")
    ctx.close()
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed. Screenshots: {SHOT_DIR}")
sys.exit(1 if failed else 0)
