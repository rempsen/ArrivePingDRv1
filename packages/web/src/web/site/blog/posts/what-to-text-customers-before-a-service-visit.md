---
title: "What to Text Customers Before a Service Visit: Timing, Templates and Consent Rules"
seoTitle: "What to Text Customers Before a Service Visit (Templates)"
slug: "what-to-text-customers-before-a-service-visit"
description: "The five texts to send around a service visit, when to send each, copy-ready templates under 160 characters, and the CASL and TCPA rules that apply."
date: "2026-11-09"
updated: "2026-11-09"
author: "Dan Rosenblat"
category: "customer-communication"
tags: ["appointment reminder text", "on-my-way text", "sms templates", "casl", "tcpa", "customer notifications", "field service", "home services"]
image: "/blog/img/what-to-text-customers-before-a-service-visit-0.webp"
imageAlt: "A home cleaner in a navy polo carrying a supply caddy walks into an apartment building lobby on an overcast morning, glancing at the phone in his left hand"
---

Send five texts around a service visit, and nothing else: a booking confirmation when the job is booked, a reminder the day before, an on-my-way text with a live ETA when the technician starts driving, a running-late notice only if the time slips, and a short note when the job is done. Keep each one under 160 plain characters, start it with your business name, give a way to reply or opt out, and leave promotions out. Reminders work: in a Cochrane review of seven trials with 5,841 people, attendance was 78.6% with text reminders against 67.8% with none ([Cochrane, 2013](https://www.cochrane.org/evidence/CD007458_mobile-phone-messaging-reminders-attendance-healthcare-appointments)).

That review covers healthcare appointments, not furnace calls, but the mechanism is the same one a service business relies on: a person who has been reminded at the right moment is more likely to be home, with the dog shut in and the driveway clear.

## Why text customers before a visit at all?

Because the text is the cheapest thing in the visit, and the no-show is the most expensive. Three findings make the case.

- **Reminders raise attendance, and texts do it as well as calls.** The Cochrane authors found text reminders "improved the rate of attendance at healthcare appointments" compared with no reminder (risk ratio 1.14), and had a similar effect to phone-call reminders, while two studies put the cost per attendance 55% to 65% lower for texts ([Cochrane, 2013](https://www.cochrane.org/evidence/CD007458_mobile-phone-messaging-reminders-attendance-healthcare-appointments)). The review rates its evidence as low to moderate quality, so treat the size of the effect as a guide, not a promise.
- **Customers want reminders by text.** In EZ Texting's 2026 survey of 959 U.S. consumers, text was the preferred channel for appointment reminders (65%), and 87% said they check a new text within 15 minutes ([EZ Texting, 2026](https://www.eztexting.com/press/press-releases/2026-consumer-texting-behavior-report)).
- **Nearly everyone can receive one.** About 98% of U.S. adults own a cellphone and 91% own a smartphone ([Pew Research Center, 2026](https://www.pewresearch.org/internet/fact-sheet/mobile/)).

What a missed visit costs a trade business is its own calculation: the drive, the technician's paid hour and the slot nobody else can use. We worked through it in [the cost of a no-call, no-show](/blog/no-call-no-show-cost-of-a-missed-service-appointment).

![Why pre-visit texts are worth getting right: attendance was 78.6% with text reminders against 67.8% with none (Cochrane review, 2013); 87% of consumers check a new text within 15 minutes and 65% prefer text for appointment reminders (EZ Texting, 2026); message frequency is the top opt-out trigger, at 40% (EZ Texting, 2026); 27% have unsubscribed because a business texted outside business hours (EZ Texting, 2022)](/blog/img/what-to-text-customers-before-a-service-visit-1.webp)

## Which texts should you send, and when?

Five messages cover a visit from booking to the end of the job. Each has one job to do. If a message doesn't change what the customer does next, don't send it.

| Text | When to send it | What it must say | What to leave out |
|---|---|---|---|
| Booking confirmation | When the job is booked | Your business name, the service, the date and the arrival window, how to change it | Upsells, links to unrelated offers |
| Day-before reminder | The afternoon before, inside your quiet hours | The window again, that a tracking link will follow, how to reschedule | A second copy of the booking details |
| On the way | When the technician starts driving | The technician's first name, the ETA and a live tracking link | Anything that needs a reply to be useful |
| Running late | Only if the ETA slips past the window, after the office has had a chance to act | The new time, the same tracking link, a way to say the new time doesn't work | Long apologies, reasons the customer can't check |
| Job complete | When the technician closes the job | That the work is done, where the invoice or report will arrive, how to reach you | A review request in the same message (send it separately, to everyone, if you send one) |

Two of these are usually missing. The day-before reminder is the one that catches the customer who forgot, and it gives them a cheap way to move the visit while you can still fill the slot. The running-late notice is the one that keeps a 40-minute delay from becoming a phone call to the office. Both depend on the customer trusting that your texts are short and about their appointment, which is why the list stops at five.

Customer notifications only work if they are sent when the event happens, not when someone remembers. That means the on-my-way text should come from the technician's "start driving" tap, not from the office reading a schedule, and the running-late notice from the ETA, not from a dispatcher noticing the time.

## What should each text say? Five templates under 160 characters

These are written for an imaginary heating company, Prairie Comfort HVAC, with a fictional 555 number and a placeholder link. Swap in your own details. Each one is plain GSM-7 text, the standard SMS character set, and we counted the characters with code, not by eye.

**1. Booking confirmation (139 characters)**

> Prairie Comfort HVAC: Sam, your furnace tune-up is booked for Tue Nov 17, 1-3pm. Questions or changes: 204-555-0148. Reply STOP to opt out.

**2. Day-before reminder (157 characters)**

> Prairie Comfort HVAC: reminder, your furnace tune-up is tomorrow, 1-3pm. We'll text a live tracking link when your tech is on the way. Reply STOP to opt out.

**3. On the way (129 characters)**

> Prairie Comfort HVAC: Jordan is on the way, ETA 1:25pm. Track and text Jordan: https://example.com/t/4f7k2 Reply STOP to opt out.

**4. Running late (150 characters)**

> Prairie Comfort HVAC: Jordan is running about 30 min late. New ETA 1:55pm: https://example.com/t/4f7k2 Reply if that no longer works. STOP to opt out.

**5. Job complete (148 characters)**

> Prairie Comfort HVAC: Jordan has finished your furnace tune-up. Your invoice is on its way by email. Questions? 204-555-0148. Reply STOP to opt out.

Why 160 characters matters: a single SMS holds 160 characters in the GSM-7 encoding, but only 70 if any character falls outside that set, and longer messages are split into segments of 153 or 67 characters ([Twilio](https://twilio.com/docs/glossary/what-sms-character-limit)). Twilio warns that GSM-7 "doesn't include curly quotation marks", so a word processor's automatic apostrophe is enough to switch encodings. We tested the day-before reminder above: with a curly apostrophe in "We'll", the same 157 characters go out as three segments instead of one. Emoji do the same. Write templates in a plain-text editor, and send yourself a test.

A few rules that make the templates work:

- **Business name first.** It is the first thing that shows on a lock screen, and it is what the customer searches for later.
- **A window, not a time, until the technician is driving.** "1-3pm" in the booking and reminder; the exact ETA only once there is a moving vehicle behind it.
- **One link, and only in the texts where it does something.** The tracking link belongs in the on-the-way and running-late texts. A link in every message trains people to ignore links.
- **Short abbreviations are fine; codes are not.** "Tue Nov 17" reads well. A job number doesn't, unless the customer needs it to call you.

If you want to try wording for your own trade, the free [on-my-way text generator](/tools/on-my-way-text-generator) drafts versions you can edit.

## Do you need consent to send appointment texts?

Usually you need less than you need for marketing, but you need something, and the rules differ between Canada and the United States. This is a summary for operators, not legal advice; check your own situation with a lawyer.

**In Canada,** Canada's anti-spam legislation (CASL) applies to "SMS and other messaging to mobile phones and devices," the CRTC confirms ([CRTC](https://crtc.gc.ca/eng/com500/faq500.htm)). Section 6(6) of the Act lifts the consent requirement for a message that solely "facilitates, completes or confirms a commercial transaction" the customer already agreed to ([CASL, s. 6](https://laws-lois.justice.gc.ca/eng/acts/e-1.6/section-6.html)). A booking confirmation or a reminder about a visit the customer booked fits that description. Two things don't go away: section 6(2) still requires the message to identify the sender, give a way to contact them and include an unsubscribe mechanism, and the exemption covers a message that does solely that, so adding a promotion turns it into a marketing message that needs consent. Marketing consent implied by a purchase lasts two years ([CRTC](https://crtc.gc.ca/eng/com500/faq500.htm)).

**In the United States,** the Telephone Consumer Protection Act rules require the called party's prior express consent for autodialed or prerecorded calls to a mobile number, and prior express written consent when the call is telemarketing ([47 CFR 64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200)). The FCC applies these rules to texts. Many service businesses rely on the customer having given their mobile number for the job as consent to texts about that job; ask your lawyer whether that covers yours. A promotion needs the written kind.

**What changes on November 25, 2026.** The FCC's Order 26-67, adopted September 30, 2026, lets a business designate how customers revoke consent, as long as the method is disclosed clearly on the text itself; it keeps the ten-business-day deadline to honor an opt-out and the seven standard reply words: "stop," "quit," "end," "revoke," "opt out," "cancel" and "unsubscribe" ([DLA Piper, 2026](https://www.dlapiper.com/en/insights/publications/2026/10/fcc-tcpa-rule)). It also lets a revocation sent in reply to an informational text apply only to that kind of message, while a marketing opt-out still stops all marketing. The rules take effect November 25 ([Brownstein, 2026](https://www.bhfs.com/insight/new-tcpa-revocation-of-consent-rules-take-effect-on-november-25/)). Under the FCC's 2024 order, one text confirming the opt-out is allowed, sent within five minutes ([Kelley Drye, 2024](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/fcc-adopts-changes-to-tcpa-consent-revocation-rules)).

| | Canada (CASL) | United States (TCPA) |
|---|---|---|
| Do the rules cover texts? | Yes | Yes |
| Consent for a booking confirmation or reminder | Not required for a message that solely confirms or facilitates a transaction the customer agreed to | Prior express consent for autodialed texts; ask whether the number given for the job covers it |
| Consent for a promotion | Express consent, or implied consent (two years after a purchase) | Prior express written consent |
| What every message needs | Your identity, a way to contact you, an unsubscribe mechanism | A clear way to opt out; from Nov 25, 2026, the opt-out method shown on the text |
| Time of day | No time-of-day rule in CASL itself | Telemarketing only between 8 a.m. and 9 p.m. the customer's local time |

The practical version, which works on both sides of the border: collect the mobile number at booking with a line that says you will text appointment updates, put your business name and "Reply STOP to opt out" in the texts, keep promotions in a separate list people chose to join, and honor every STOP the same day, even though the rules allow longer.

## How many texts is too many, and when should they stop?

Five per visit is a ceiling, not a target. Message frequency is the top reason people opt out of business texts, at 40% in EZ Texting's 2026 survey ([EZ Texting, 2026](https://www.eztexting.com/press/press-releases/2026-consumer-texting-behavior-report)), and a customer who replies STOP to your reminder also stops getting your on-my-way texts. That is the real cost of a chatty template: it switches off the message that prevents the "where's my tech?" call.

Timing matters as much as count. In EZ Texting's 2022 survey of 3,095 consumers, 27% said they had unsubscribed because a business texted them outside business hours ([EZ Texting, 2022](https://www.eztexting.com/report/2022-state-of-texting-consumer-behavior-report)). The TCPA limits telemarketing to 8 a.m. to 9 p.m. in the customer's time zone ([47 CFR 64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200)); appointment texts aren't telemarketing, but the same window is a sensible default. Set quiet hours in the customer's time zone, and decide what happens to a message that falls inside them. For a booking confirmation at 11 p.m., skipping it is better than sending it at 7 a.m. with stale information.

Cut, in this order, when you are over the limit:

1. Duplicate confirmations (an email and a text saying the same thing at the same moment).
2. "Your technician has been assigned" messages that the customer can't act on.
3. Survey or review requests bundled into service messages.
4. Anything sent after the job is closed except the one completion note.

## Playbook: set up your pre-visit texts this week

1. **List every text a customer gets today.** Book a test job to your own phone and write down each message, its time and its length. Most teams find one they didn't know about.
2. **Rewrite them to the five above.** Business name first, one purpose each, under 160 characters. Count with a tool, not by eye.
3. **Paste each template into a plain-text editor.** Replace curly quotes and emoji, then send a test and check that it arrives as one message.
4. **Fix the booking step.** Add one line to your booking form or phone script: "We'll text you appointment updates at this number. Reply STOP any time to stop them."
5. **Set quiet hours** in the customer's time zone, and decide which messages are skipped, not delayed, inside them.
6. **Move promotions out.** If a service text includes an offer, take it out and put it in a separate, opted-in list.
7. **Test the STOP path.** Reply STOP to your own test, confirm the confirmation text, and confirm the next reminder doesn't go out.

For what the tracking page behind the on-my-way text should show, see [what a customer tracking link should show](/blog/what-should-a-customer-tracking-link-show).

## How ArrivePing does this

ArrivePing is field service software made by NVC360 in Winnipeg, Manitoba. It began as the dispatch tool for National Interiors, a specialty subcontractor that ran more than 800 field technicians, and it sends the visit's texts from what actually happens on the job rather than from someone's memory.

- **Milestone texts, in your voice.** ArrivePing sends a booking confirmation, an on-the-way text with a live tracking link, a running-late notice if the day slips, an arrival message and a completion email, all under your company name ([customer notifications](/customer-notifications)). The setup agent drafts the wording from your website, and you edit it any time under Setup → Notifications.
- **The on-my-way text goes out when the technician taps Start Driving,** with the technician's name and a live tracking link with the ETA ([on-my-way text](/on-my-way-text-software)). The customer sees the technician's location only while they are driving to that job, and sharing stops on arrival.
- **A day-before reminder is a milestone you add yourself:** name it, set it to a time before the appointment, and write the message. If the appointment is rescheduled, the reminder goes out again so the customer hears the new time.
- **Quiet hours** skip the channels you choose, such as SMS and email, between two times in your company's time zone; nothing is queued for the morning. Customers can reply STOP to any text, and the job itself is unaffected.
- **Every plan includes this,** from $49 USD a month for one dispatcher and two drivers, with a 30-day free trial ([pricing](/pricing)).

When ArrivePing isn't the right choice: if what you need is promotional texting, such as seasonal campaigns, offers and broadcast lists, use a dedicated SMS marketing tool with its own opt-in list. ArrivePing sends service updates about a booked job, and keeping marketing out of those texts is the point.

## FAQ

### What texts should I send a customer before a service appointment?

A booking confirmation when the job is booked, a reminder the day before, an on-my-way text with a live ETA when the technician starts driving, and a running-late notice only if the time slips. After the job, one short completion note. Each text should start with your business name and stay under 160 plain characters.

### When should I send an appointment reminder text?

The afternoon before the visit, inside normal hours in the customer's time zone, so they can still reschedule while you can fill the slot. A same-morning reminder adds little if the on-my-way text with a live ETA is coming.

### Do I need consent to send appointment reminder texts in Canada?

CASL covers text messages, but section 6(6) removes the consent requirement for a message that solely confirms or facilitates a transaction the customer already agreed to, such as a booked visit. The message must still identify your business, give a way to contact you and include an unsubscribe option, and adding a promotion makes it a marketing message that needs consent.

### What changes for texting customers in the US on November 25, 2026?

The FCC's Order 26-67 takes effect. Businesses can designate how customers revoke consent if the method is shown clearly on the text, must still honor opt-outs within ten business days, and, if they take opt-outs by reply text, must recognize seven words, including "stop" and "unsubscribe." An opt-out sent in reply to an informational text can be limited to that type of message.

### How long should an appointment text be?

160 characters or fewer, using plain characters only. One emoji or curly apostrophe switches the message to an encoding that fits 70 characters per message, so a 157-character reminder becomes three segments instead of one.

## Sources

1. Gurol-Urganci I, de Jongh T, Vodopivec-Jamsek V, Atun R, Car J. *Mobile phone messaging reminders for attendance at healthcare appointments*, Cochrane Database of Systematic Reviews, 2013 (plain-language summary). https://www.cochrane.org/evidence/CD007458_mobile-phone-messaging-reminders-attendance-healthcare-appointments
2. EZ Texting, *2026 Consumer Texting Behavior Report* (survey of 959 U.S. consumers), April 14, 2026. https://www.eztexting.com/press/press-releases/2026-consumer-texting-behavior-report
3. EZ Texting, *2022 State of Texting: Consumer Behavior Report* (survey of 3,095 U.S. consumers, January 2022). https://www.eztexting.com/report/2022-state-of-texting-consumer-behavior-report
4. Pew Research Center, *Mobile Fact Sheet* (survey of U.S. adults, Jan. 30–June 18, 2026). https://www.pewresearch.org/internet/fact-sheet/mobile/
5. Twilio, *What is the SMS character limit?* https://twilio.com/docs/glossary/what-sms-character-limit
6. Canadian Radio-television and Telecommunications Commission (CRTC), *Frequently Asked Questions about Canada's Anti-Spam Legislation*. https://crtc.gc.ca/eng/com500/faq500.htm
7. Government of Canada, Justice Laws, *An Act to promote the efficiency and adaptability of the Canadian economy… (CASL), S.C. 2010, c. 23, section 6*. https://laws-lois.justice.gc.ca/eng/acts/e-1.6/section-6.html
8. Electronic Code of Federal Regulations, *47 CFR 64.1200: Delivery restrictions*. https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200
9. DLA Piper, *FCC TCPA rule* (on FCC Order 26-67, adopted September 30, 2026), October 2026. https://www.dlapiper.com/en/insights/publications/2026/10/fcc-tcpa-rule
10. Brownstein Hyatt Farber Schreck, *New TCPA Revocation of Consent Rules Take Effect on November 25*, 2026. https://www.bhfs.com/insight/new-tcpa-revocation-of-consent-rules-take-effect-on-november-25/
11. Kelley Drye & Warren, *FCC Adopts Changes to TCPA Consent Revocation Rules* (on FCC Order 24-24), February 27, 2024. https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/fcc-adopts-changes-to-tcpa-consent-revocation-rules
