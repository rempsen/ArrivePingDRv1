/**
 * Screen map: what a company's own customers see (tracking link, pay link,
 * selections link, property history, booking forms, customer portal, the texts
 * and emails they receive) and the account screens everyone uses (company
 * signup, sign in, passwords, accepting an invite).
 *
 * Written from web/pages/{track,pay,selections,property}-public.tsx,
 * intake-form.tsx, work-order-form.tsx, web/pages/customer/*, signup-company.tsx,
 * auth.tsx, forgot/reset-password.tsx, join-company.tsx, join-tech.tsx and the
 * API routes / services behind them (services/dispatch.ts default messages).
 */
import type { KbEntry } from "./types";

export const entries: KbEntry[] = [
  // ───────────────────────────────────────────────────────────── tracking link
  {
    id: "customer.tracking",
    title: "Live tracking page (tracking link)",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer taps the link in the text or email (\"Track live, see ETA & message them\") — no login needed",
    route: "/t/:token",
    summary:
      "The page a {customer} opens from the on-the-way text. While the {job} is live it shows a map with the {worker}'s position, a live ETA, who is coming, Call / Text buttons and a message thread. Once the {job} is finished the same link becomes a permanent service record with photos, materials, sign-off and a star rating.",
    controls: [
      { label: "Status row (Confirmed · Assigned · En Route / On the way · Arrived · Working · Complete)", does: "Shows the current stage in words with \"x of 6\" and six dots. Hidden on a cancelled {job}." },
      { label: "Map", does: "Shows the {worker}'s live position, the service address and the route. Updates on its own; no refresh needed." },
      { label: "Arriving in / Estimated arrival", does: "Live countdown to arrival (minutes, then a seconds countdown under 2 minutes, then \"Arriving now\"), with the expected clock time and distance away. A green \"Live\" dot shows when the page is receiving live updates." },
      { label: "Your {worker} has arrived! / Job in progress / Job paused", does: "Replaces the countdown once the {worker} is on site, working, or has paused work." },
      { label: "Call", does: "Phones the assigned {worker}. Only shown when the {worker} has a phone number." },
      { label: "Text", does: "Opens a text message to the assigned {worker}'s phone." },
      { label: "Running about N minutes late (banner)", does: "Appears when the {job} has been flagged as running late, with the new expected time. The page has no reschedule option." },
      { label: "Your {worker} is less than 500 m away — please be ready! (banner)", does: "Pops up once when the {worker} comes within 500 m while on the way; closes by itself after 8 seconds or with ✕." },
      { label: "Pay {amount} / Amount due / Paid", does: "Shown once the {worker} has arrived, is working or has finished, when the {job} collects payment on site. \"Pay\" opens the secure pay page." },
      { label: "Messages", does: "Message thread with the {worker} and office. \"Anything you send here goes straight to your {worker}.\" The assigned {worker} also gets a text." },
      { label: "Type a message… / Send message", does: "Types and sends a message. If it fails the text stays in the box so it can be resent." },
      { label: "Job timeline", does: "Every customer-visible event (created, assigned, on the way, arrived, started, completed, photos, signature, the company's own milestones) with times in the company's time zone." },
      { label: "Photos (Before / During / After)", does: "Job photos grouped by phase; tap one to open it full screen, close with \"Close photo\" or Escape." },
      { label: "Materials & work performed", does: "What was used and how much. Never shows prices." },
      { label: "Sign-off", does: "The captured signature and who signed." },
      { label: "Service record", does: "On a completed {job}: service, {worker}, scheduled, completed, time on site and address, with the note that the link is permanent." },
      { label: "How was your experience? (1–5 stars) / Any comments? (optional) / Submit review", does: "On a completed {job} only. Saves one rating per {job}." },
      { label: "Leave a Google review", does: "Shown after a 4 or 5 star rating, only if the company has a public review link set up." },
      { label: "Email {company}", does: "On a finished or cancelled {job}: opens an email to the company with the {job} title as the subject." },
      { label: "Full service history for this address", does: "Opens the property history page for the address (every visit, photo and material, no login)." },
    ],
    tasks: [
      {
        q: "What does the customer see when the technician is on the way?",
        steps: [
          "When the {worker} taps that they are on the way, the {customer} gets a text with the tracking link (by default).",
          "On the page they see the map with the {worker}'s live position and the route.",
          "Below the map: \"Arriving in\" with a live countdown, the expected time and the distance away.",
          "Then the {worker}'s name, photo and vehicle, with Call and Text buttons.",
          "Within 500 m they get a one-time \"less than 500 m away — please be ready!\" banner.",
        ],
      },
      {
        q: "What does the customer see after the job is complete?",
        steps: [
          "The same link now shows \"Job complete — thanks for choosing us!\" with the company and {worker}.",
          "Below it: a star rating box, the Service record, the Job timeline, Photos, Materials & work performed and Sign-off.",
          "If the address has a property history, \"Full service history for this address\" links to it.",
        ],
        note: "A completed {job}'s link never expires; it is the {customer}'s permanent record. Prices are never shown on it.",
      },
      {
        q: "How does the customer message the technician?",
        steps: [
          "Open the tracking link.",
          "In Messages, type in \"Type a message…\".",
          "Press the send arrow.",
        ],
        note: "Messages reach the assigned {worker} in the app and by text. Replies show in the same thread. Messaging still works after the {job} is complete.",
      },
      {
        q: "How do I call or text my technician? (customer)",
        steps: [
          "Open the tracking link from your text.",
          "Under the countdown, press Call or Text next to your {worker}'s name.",
        ],
        note: "The buttons only appear when the {worker} has a phone number on file.",
      },
      {
        q: "How does a customer pay from the tracking page?",
        steps: [
          "Once the {worker} has arrived, an \"Amount due\" box appears for {jobs} set to collect payment on site.",
          "Press \"Pay {amount}\" to open the secure pay page.",
          "After paying, the box shows \"Paid\".",
        ],
      },
      {
        q: "How does a customer leave a review?",
        steps: [
          "Open the tracking link after the {job} is complete (the review-request text links to it).",
          "Under \"How was your experience?\" pick 1 to 5 stars.",
          "Optionally type in \"Any comments? (optional)\".",
          "Press Submit review.",
          "With 4 or 5 stars and a company review link set up, press \"Leave a Google review\" to post it publicly.",
        ],
        note: "Only one review is saved per {job}. Ratings of 3 or fewer are never sent to the public review link; admins get a private \"needs attention\" alert instead.",
      },
      {
        q: "Can the customer reschedule from the tracking link?",
        steps: [
          "No — the tracking page has no reschedule or cancel button.",
          "A {customer} with a portal login can request a change from the booking in the customer portal; otherwise they contact the office.",
        ],
      },
      {
        q: "Why does the customer see a 'running late' banner?",
        steps: [
          "The banner \"Running about N minutes late\" appears when the {job} was flagged as late (automatically or by the office).",
          "It shows the new expected time when one is known.",
          "The page updates on its own as things change.",
        ],
      },
    ],
    fixes: [
      {
        problem: "Customer sees \"This tracking link is invalid or has expired.\"",
        fix: "A live link stops working 24 hours after the {worker} set off (the window can be configured on the server), or if the token is wrong. Completed {jobs} never expire. Send a fresh link or have the {customer} contact the office.",
      },
      {
        problem: "Message didn't send: \"This tracking link is no longer active — please contact the company directly.\"",
        fix: "The link has expired, so the page can no longer post messages. The {customer} should call or email the company.",
      },
      {
        problem: "Message didn't send: \"Too many messages just now — please wait a minute and try again.\"",
        fix: "The page limits how fast messages can be sent. Wait a minute; the typed message stays in the box.",
      },
      {
        problem: "Review error: \"Rating must be a whole number from 1 to 5\" or \"Job not yet complete\"",
        fix: "Ratings are only accepted on completed {jobs}, as 1–5 whole stars. Comments have a maximum length (\"Comment is too long\").",
      },
      {
        problem: "No Call / Text buttons on the tracking page",
        fix: "They only show when a {worker} is assigned and has a phone number on their profile.",
      },
      {
        problem: "No 'Leave a Google review' button after a good rating",
        fix: "It only appears for 4 or 5 stars and only when the company has a public review link saved.",
      },
    ],
    keywords: ["tracking link", "ETA", "where is my technician", "live map", "on my way text", "track page", "rate", "review", "service record", "receipt link"],
  },

  // ─────────────────────────────────────────────────────────────── pay page
  {
    id: "customer.pay",
    title: "Pay page (on-site payment link)",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer opens the texted pay link, scans the QR code on the {worker}'s phone, or presses Pay on the tracking page",
    route: "/pay/:token",
    summary:
      "A no-login card payment page for {jobs} set to collect payment on site. Shows the company, the {job}, line items, tax and total, and takes card, Apple Pay or Google Pay through Stripe.",
    controls: [
      { label: "Line items / Subtotal / tax line / Total", does: "What the {customer} is paying for, with the company's tax label and the total." },
      { label: "Card form (Stripe)", does: "Card entry with Apple Pay / Google Pay where the device supports it. The company never sees the card number." },
      { label: "Pay {amount}", does: "Submits the payment. On success the page shows \"Paid. Thank you!\"." },
      { label: "Paid. Thank you!", does: "Confirms payment and says a receipt is on its way (with the invoice number when there is one)." },
    ],
    tasks: [
      {
        q: "How does a customer pay on site?",
        steps: [
          "The {worker} or office sends the pay link by text, or shows the QR code for the {customer} to scan.",
          "The {customer} opens the page and checks the line items and Total.",
          "They enter a card (or use Apple Pay / Google Pay).",
          "They press \"Pay {amount}\".",
          "The page shows \"Paid. Thank you!\" and a receipt email follows.",
        ],
        note: "Only works for {jobs} set to collect payment on site, and only when the company has card payments switched on.",
      },
      {
        q: "What text does the customer get with the pay link?",
        steps: [
          "When staff choose to text the link, the {customer} receives: \"{company}: your total is ${total}. Pay securely by card, Apple Pay or Google Pay: {link}\".",
          "The link opens this pay page.",
        ],
      },
      {
        q: "Does the customer get a receipt?",
        steps: [
          "When the card payment succeeds, the page shows \"Paid. Thank you!\" and says a receipt is on its way.",
          "A receipt email and an in-app notification are sent to the {customer}.",
        ],
      },
      {
        q: "Can the customer pay after the job is finished?",
        steps: [
          "Yes. A completed {job}'s pay link keeps working.",
          "Open the same link (or Pay on the tracking page) and pay as normal.",
        ],
      },
    ],
    fixes: [
      {
        problem: "\"This payment link isn't available.\" / \"Ask your technician for a new one.\"",
        fix: "The {job} isn't set to collect payment on site, was cancelled or deleted, or the live link expired before the {job} was completed. Check the {job}'s payment setting and send a new link.",
      },
      {
        problem: "\"Card payments aren't switched on for {company} yet. Please pay your technician another way.\"",
        fix: "The company hasn't connected card payments. Collect payment another way, or connect payments in the office settings.",
      },
      {
        problem: "\"There's no balance to pay on this job.\"",
        fix: "The total is zero. Add line items or charges to the {job} first.",
      },
      {
        problem: "Card declined or \"The payment didn't go through. Please check the card details.\"",
        fix: "The card issuer's message is shown from Stripe. Try another card or method.",
      },
      {
        problem: "\"Card payment isn't available right now.\"",
        fix: "The checkout couldn't be started. Try again in a moment, or pay the {worker} another way.",
      },
    ],
    keywords: ["pay link", "QR code", "payment", "Apple Pay", "Google Pay", "card", "invoice", "collect payment on site"],
  },

  // ─────────────────────────────────────────────────────────── selections
  {
    id: "customer.selections",
    title: "Selections page (options and upgrades)",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Office presses \"Copy customer selections link\" on the {job} and sends it to the {customer}",
    route: "/s/:token",
    summary:
      "A no-login page where the {customer} picks one option per category (for example Good / Better / Best), types their name as a signature and confirms. The chosen price differences are added to the {job}.",
    controls: [
      { label: "Option cards (per category)", does: "Pick one option per category. Each shows its tier label, name, description and \"Included\" or \"+$amount\". The company's default option is preselected." },
      { label: "Total upgrades", does: "Running total of the extra cost of the current picks." },
      { label: "Type your name to confirm these selections", does: "Name field used as the e-signature (placeholder \"Full name\")." },
      { label: "Confirm selections", does: "Submits the choices. Disabled until every category has a pick and a name is typed." },
      { label: "Selections confirmed", does: "Shown after submitting (and on later visits): the chosen options and their prices." },
    ],
    tasks: [
      {
        q: "How do I send a customer their options to choose from?",
        steps: [
          "Open the {job} in the office and press \"Copy customer selections link\".",
          "Paste the link into a text or email to the {customer}.",
        ],
        note: "The employee work-order form also offers \"Copy customer selections link\" after it creates a {job}.",
      },
      {
        q: "How does a customer choose their options?",
        steps: [
          "Open the selections link.",
          "In each category, tap the option you want.",
          "Check \"Total upgrades\".",
          "Type your name in \"Type your name to confirm these selections\".",
          "Press Confirm selections.",
        ],
      },
      {
        q: "What happens after the customer confirms?",
        steps: [
          "The page shows \"Selections confirmed\" with each choice.",
          "The price differences are added to the {job}'s line items.",
          "Revisiting the link shows the confirmed choices instead of the picker.",
        ],
      },
      {
        q: "Can the customer change their selections after confirming?",
        steps: [
          "Not from the page: once confirmed, the link only shows \"Selections confirmed\".",
          "The {customer} contacts the office to change them.",
        ],
      },
    ],
    fixes: [
      {
        problem: "\"This selections link is invalid or has expired.\"",
        fix: "The link uses the same token as the tracking link, so it follows the same expiry: a live link stops working 24 hours after the {worker} set off, unless the {job} is completed. Check the link was copied in full.",
      },
      {
        problem: "Confirm selections button is greyed out",
        fix: "Every category needs a pick and a name must be typed.",
      },
      {
        problem: "\"Invalid selection for category …\"",
        fix: "An option was changed or removed in the company's catalog after the page was opened. Reload the page and pick again.",
      },
    ],
    keywords: ["options", "upgrades", "good better best", "tiers", "e-sign", "selections link"],
  },

  // ─────────────────────────────────────────────────────────── property page
  {
    id: "customer.property",
    title: "Property service history page",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer taps \"Full history for this address\" in the completion text, or \"Full service history for this address\" on the tracking page",
    route: "/p/:token",
    summary:
      "A permanent, no-login page for one address listing every completed {job} there: when, by which {worker}, time on site, materials and photos. It never shows prices.",
    controls: [
      { label: "{jobs} completed / Last service / Customer since", does: "Totals for the address." },
      { label: "Request service at this address", does: "Opens the company's booking form with the address already filled in. Only shown when the company has an active request form." },
      { label: "Completed work", does: "One card per completed {job} with date, {worker}, time on site, Materials & work and Photos." },
      { label: "Full record", does: "Opens that {job}'s tracking page (its permanent service record)." },
      { label: "Serviced by (phone / email)", does: "The company's phone and email; tap to call or email." },
    ],
    tasks: [
      {
        q: "How does a customer see all past work at their address?",
        steps: [
          "Open the property link from the completion text or the tracking page.",
          "Scroll \"Completed work\" for each visit.",
          "Press \"Full record\" on a visit for its timeline, photos and sign-off.",
        ],
      },
      {
        q: "How does a customer book again from their property page?",
        steps: [
          "Open the property link.",
          "Press \"Request service at this address\".",
          "Fill in the request form (the address is already filled in) and press Submit request.",
        ],
        note: "The button only appears when the company has an active request form.",
      },
      {
        q: "Does the property page show prices?",
        steps: [
          "No. It is a shareable link, so it only shows the work done, never money.",
          "Amounts and payment are only on the {job}'s pay page and receipt.",
        ],
      },
      {
        q: "Where does the customer get the property link?",
        steps: [
          "In the default \"Job completed\" message: \"Full history for this address: {link}\" (when the address has one).",
          "On the tracking page of a {job} at that address: \"Full service history for this address\".",
        ],
      },
    ],
    fixes: [
      {
        problem: "\"This property link is invalid.\"",
        fix: "The link token wasn't found. Check the full link was copied, or send the link from a recent completed {job}.",
      },
      {
        problem: "\"No completed work recorded at this address yet.\"",
        fix: "Only completed {jobs} appear here.",
      },
    ],
    keywords: ["property hub", "service history", "address history", "past visits", "home record"],
  },

  // ─────────────────────────────────────────────────────── public request form
  {
    id: "customer.request-form",
    title: "Public request / booking form",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer opens the company's form link, or fills it in where it is embedded on the company website",
    route: "/f/:companyId/:slug?k=…",
    summary:
      "The company's own request form, shared as a link or embedded on its website. The fields and sections are set by the company. Submitting creates a new pending {job} (a lead) for the office.",
    controls: [
      { label: "Form fields (company-defined)", does: "Name, email, phone, address (with suggestions), service, preferred date, notes, photo and any custom questions. Fields marked * are required." },
      { label: "Service dropdown", does: "Only shown when the form offers two or more services." },
      { label: "Photo upload", does: "Attach one image, up to 15 MB." },
      { label: "Submit request", does: "Sends the request. Shows \"Sending…\" while it submits." },
      { label: "Request received", does: "Confirmation screen with the company's success message." },
    ],
    tasks: [
      {
        q: "How does a customer request service online?",
        steps: [
          "Open the company's form link (or the form on its website).",
          "Fill in the fields; pick the address from the suggestions.",
          "Optionally attach a photo.",
          "Press Submit request.",
          "The page shows \"Request received\".",
        ],
      },
      {
        q: "What happens when a customer submits the request form?",
        steps: [
          "A new {job} is created with status pending, so it lands in the office as a new lead.",
          "The office is notified, and the form's recipient email (if set) gets the details.",
          "The {customer} gets the \"We've received your request\" message (email by default).",
        ],
        note: "If no preferred date is given, the lead is placed one day after submission.",
      },
      {
        q: "Can the form be put on our website?",
        steps: [
          "Yes. The form is built to be shared as a link or placed in an iframe on the company website.",
          "Always use the full link including its ?k= access key.",
        ],
      },
      {
        q: "How does a customer send a photo with their request?",
        steps: [
          "On the form, use the photo field to choose an image (up to 15 MB).",
          "Press Submit request; the photo is attached to the new {job}'s notes.",
        ],
        note: "The photo field only appears if the company has it switched on for the form.",
      },
    ],
    fixes: [
      {
        problem: "\"This form link is incomplete.\" / \"This form link is missing its access key.\"",
        fix: "The link is missing its ?k= key, so it can't be submitted. Use the full form link from the office.",
      },
      {
        problem: "\"Form unavailable\" / \"Form not found\"",
        fix: "The form was switched off or the link is wrong.",
      },
      {
        problem: "\"Sorry, your address is outside our service area. Please contact us directly for availability.\"",
        fix: "The address falls outside the company's active service zones. The {customer} should call the company.",
      },
      {
        problem: "\"That photo is too large (max 15 MB).\"",
        fix: "Choose a smaller image.",
      },
      {
        problem: "\"<field> is required\" / \"Name is required\" / \"Please enter a valid email address.\"",
        fix: "Fill in the required field shown in the message and submit again.",
      },
      {
        problem: "\"Invalid or missing public key\" / \"Key not authorized for this form\" / \"Origin not allowed\"",
        fix: "The form's access key is wrong, belongs to another form, or the website it's embedded on isn't allowed for that key. Check the form's link and key in the office.",
      },
    ],
    keywords: ["intake form", "booking form", "lead form", "request service", "website form", "embed", "iframe"],
  },

  // ───────────────────────────────────────────────── employee work-order form
  {
    id: "customer.work-order-form",
    title: "Employee work-order form (public link)",
    surface: "customer",
    platforms: ["web"],
    roles: ["technician", "dispatcher", "manager"],
    path: "Staff open the company's work-order form link and enter the employee access code",
    route: "/f/:companyId/:slug",
    summary:
      "A no-login form for staff to create a {job}, gated by a shared employee access code instead of a sign-in. Pick or add the {customer}, service, priority, optional schedule and {worker}, line items and charges, then create it.",
    controls: [
      { label: "Access code / Continue", does: "Enter the employee access code to open the form." },
      { label: "Client: Search existing / Add new", does: "Search by name, email or phone, or add a new {customer} (Full name, Phone, Email, Address). \"Change\" clears the picked {customer}." },
      { label: "Service", does: "Required service for the {job}." },
      { label: "Priority", does: "Low, Normal, High or Urgent." },
      { label: "Job address", does: "Where the work is. For a new {customer}, leave blank to use their address." },
      { label: "Your name", does: "Who submitted it, so the office knows." },
      { label: "Notes / describe the work", does: "Free-text notes." },
      { label: "Schedule (optional)", does: "Date and time. Leave blank to let dispatch schedule it. Only shown when the form allows it." },
      { label: "Technician (optional)", does: "Assign a {worker}, or leave \"Unassigned — dispatch will assign\". Only shown when the form allows it." },
      { label: "Line items / Charges", does: "Add catalog items, per-unit lines, call-out fees and hourly labour." },
      { label: "Tax region", does: "Auto-detected from the address; change if needed, or \"No tax\"." },
      { label: "Price preview", does: "Line items, charges, subtotal, tax and total; hourly charges are \"billed at job time\"." },
      { label: "Create work order", does: "Creates the {job}." },
      { label: "Copy customer selections link / Create another", does: "After creating: copy the {customer}'s options link, or reset for a new one." },
    ],
    tasks: [
      {
        q: "How do I create a work order from the employee form?",
        steps: [
          "Open the form link and enter the access code, then press Continue.",
          "Under Client, use Search existing or Add new.",
          "Pick the Service and Priority, and fill in Job address and Your name.",
          "Optionally set Schedule and Technician, and add Line items or Charges.",
          "Check the Price preview and press Create work order.",
        ],
      },
      {
        q: "How do I send the customer their options after creating a work order here?",
        steps: [
          "After \"Work order created\", press \"Copy customer selections link\".",
          "Paste it into a message to the {customer}.",
        ],
      },
      {
        q: "How do I add a new client from the work-order form?",
        steps: [
          "Under Client press Add new.",
          "Fill in Full name (required), Phone, Email and Address.",
          "Leave Job address blank to use that address, then finish the form.",
        ],
      },
      {
        q: "How do I leave scheduling and assignment to dispatch?",
        steps: [
          "Leave Schedule (optional) empty.",
          "Leave Technician (optional) on \"Unassigned — dispatch will assign\".",
          "Press Create work order.",
        ],
      },
    ],
    fixes: [
      {
        problem: "\"Incorrect access code\"",
        fix: "Get the current employee access code from the office.",
      },
      {
        problem: "\"Pick a service.\" / \"Pick a client or add a new one.\"",
        fix: "Both a service and a {customer} are required before creating.",
      },
      {
        problem: "\"Address is outside all active service zones.\"",
        fix: "The address isn't in any of the company's active zones. Check the address or the zones.",
      },
    ],
    keywords: ["work order form", "access code", "PIN", "employee form", "create job without login"],
  },

  // ───────────────────────────────────────────────────── customer portal home
  {
    id: "customer.portal.home",
    title: "Customer portal — Home",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Sign in with a customer account → Home",
    route: "/app",
    summary:
      "The signed-in {customer}'s start page: a banner for any open booking and a searchable grid of the company's services to book.",
    controls: [
      { label: "Home / Work Orders / Profile", does: "Portal menu: this page, the list of bookings, and the account details." },
      { label: "Active booking (banner)", does: "Shows the open booking's service, status and time; tap to track it." },
      { label: "Search services…", does: "Filters the services by name or category." },
      { label: "Clear search", does: "Shown when nothing matches; clears the search." },
      { label: "Service cards", does: "Each shows the service, rating, starting price and duration; tap one to book it." },
    ],
    tasks: [
      {
        q: "How does a customer book a service in the portal?",
        steps: [
          "Sign in and go to Home.",
          "Find the service under \"Browse services\" or with \"Search services…\".",
          "Tap the service card to open the booking page.",
        ],
      },
      {
        q: "How does a customer get to their current appointment?",
        steps: [
          "On Home, tap the \"Active booking\" banner.",
          "Or open Work Orders and tap the booking.",
        ],
      },
      {
        q: "How does a customer find a specific service?",
        steps: [
          "Type in \"Search services…\" on Home.",
          "Tap the matching card, or press Clear search if nothing matches.",
        ],
      },
      {
        q: "What does the customer see on a service card?",
        steps: [
          "The service name, rating, starting price and duration.",
          "Tap the card to open the booking page with the full description.",
        ],
      },
    ],
    fixes: [
      {
        problem: "\"No services available yet\"",
        fix: "The company has no services set up for customers to book.",
      },
    ],
    keywords: ["customer portal", "client portal", "book online", "my account"],
  },

  // ─────────────────────────────────────────────────── customer portal booking
  {
    id: "customer.portal.book",
    title: "Customer portal — Book a service",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer portal → Home → tap a service",
    route: "/app/book/:id",
    summary:
      "Where a signed-in {customer} picks a time and address for a service and confirms the booking. Tax is calculated from the address.",
    controls: [
      { label: "Back", does: "Returns to Home." },
      { label: "Choose a time", does: "Pick a day, then a time slot, in the company's time zone." },
      { label: "Service address", does: "Address with suggestions. Picking a suggestion lets tax be calculated correctly." },
      { label: "Notes (optional)", does: "Gate code, parking, specifics." },
      { label: "Order summary", does: "Service price, tax (\"Calculated from your address\" until an address is entered) and Total." },
      { label: "Confirm booking", does: "Creates the booking. Disabled until a time and address are chosen." },
      { label: "Track my booking / Back to home", does: "Shown on the \"Booking confirmed!\" screen." },
    ],
    tasks: [
      {
        q: "How does a customer book and pick a time?",
        steps: [
          "Open the service from Home.",
          "Under \"Choose a time\" pick the day, then the time.",
          "Enter the Service address and pick the matching suggestion.",
          "Add Notes (optional) if needed.",
          "Check the Order summary and press Confirm booking.",
          "On \"Booking confirmed!\" press Track my booking.",
        ],
        note: "\"You'll pay after the service is completed.\"",
      },
      {
        q: "Why does the tax say 'estimated — confirm your address'?",
        steps: [
          "The address didn't resolve to a province or state.",
          "Pick a suggestion from the address list to confirm it; the tax then updates.",
        ],
      },
      {
        q: "How does a customer leave a gate code or parking note?",
        steps: [
          "On the booking page, type it in Notes (optional).",
          "Press Confirm booking; the note is saved on the booking.",
        ],
      },
      {
        q: "When does a customer pay for a portal booking?",
        steps: [
          "Nothing is paid at booking: \"You'll pay after the service is completed.\"",
          "Later, the booking's Payment box shows the invoice and, if the company takes cards, a Pay button.",
        ],
      },
    ],
    fixes: [
      {
        problem: "Booking refused with a message such as outside the service area",
        fix: "The server's reason is shown under the button (\"Couldn't create booking. Please try again.\" if none). An address outside the company's service area can't be booked online; contact the company.",
      },
      {
        problem: "Confirm booking is greyed out",
        fix: "Choose a time slot and enter a service address first.",
      },
    ],
    keywords: ["book", "schedule appointment", "pick a time", "time slot"],
  },

  // ─────────────────────────────────────────────────── customer portal list
  {
    id: "customer.portal.bookings",
    title: "Customer portal — My bookings",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer portal → Work Orders",
    route: "/app/bookings",
    summary: "A list of the {customer}'s bookings with service, status, time, address, price and Paid / Unpaid.",
    controls: [
      { label: "Booking row", does: "Tap to open the booking's tracking page." },
      { label: "Paid / Unpaid", does: "Payment state of each booking." },
      { label: "Book a service", does: "Shown when there are no bookings; goes to Home." },
    ],
    tasks: [
      {
        q: "How does a customer see their past and upcoming bookings?",
        steps: ["Open Work Orders in the portal menu.", "Tap a booking to see its details, progress and payment."],
      },
      {
        q: "How does a customer check whether a booking is paid?",
        steps: ["Open Work Orders.", "Read Paid or Unpaid under the price on each booking."],
      },
      {
        q: "How does a customer track a booking from the list?",
        steps: ["Open Work Orders.", "Tap the booking to open its live map and progress."],
      },
      {
        q: "The customer has no bookings yet. How do they start?",
        steps: ["On Work Orders, press Book a service.", "Pick a service on Home and book it."],
      },
    ],
    keywords: ["my bookings", "appointments", "history", "work orders"],
  },

  // ─────────────────────────────────────────────────── customer portal track
  {
    id: "customer.portal.track",
    title: "Customer portal — Booking tracking and changes",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer portal → Work Orders → tap a booking",
    route: "/app/track/:id",
    summary:
      "The signed-in view of one booking: live map, progress, the assigned pro, payment, and the \"Need to change this?\" card where the {customer} moves the time or asks to cancel.",
    controls: [
      { label: "All bookings", does: "Back to the list." },
      { label: "Map with status", does: "Live position of the assigned pro and the address." },
      { label: "Phone button", does: "Calls the assigned pro while the booking is active." },
      { label: "Progress", does: "Confirmed, Pro assigned, On the way, Arrived, In progress, Completed, with \"• now\" on the current step." },
      { label: "Running about N minutes late (banner)", does: "Shown once the office has sent a late notice, while the booking hasn't started." },
      { label: "Change my appointment time / Request a new time", does: "Opens the time picker. \"Change\" moves it straight away; \"Request\" (inside the company's cutoff) sends it to the office to confirm." },
      { label: "Need to cancel?", does: "Opens \"Request a cancellation\". It never cancels by itself; it sends a request." },
      { label: "Anything we should know? (optional)", does: "Reason for the time change." },
      { label: "Confirm new time / Send request / Back", does: "Footer buttons of the time picker." },
      { label: "Why do you need to cancel? / Send request / Keep my appointment", does: "Cancellation request form; a reason is required." },
      { label: "Pay {amount}", does: "Opens \"Pay securely\" to pay the invoice by card, when the company takes cards." },
      { label: "Paid · invoice number / Amount due · invoice number", does: "Payment state. Without card payments it says payment is arranged directly with the company." },
    ],
    tasks: [
      {
        q: "How does a customer reschedule?",
        steps: [
          "In the portal open Work Orders and tap the booking.",
          "Under \"Need to change this?\" press \"Change my appointment time\" (or \"Request a new time\").",
          "Pick a day and time.",
          "Optionally fill in \"Anything we should know? (optional)\".",
          "Press \"Confirm new time\" (or \"Send request\").",
        ],
        note: "Outside the company's cutoff (12 hours before by default) the move is immediate and a confirmation is sent. Inside the cutoff it becomes a request the office confirms.",
      },
      {
        q: "How does a customer cancel an appointment?",
        steps: [
          "Open the booking and press \"Need to cancel?\".",
          "Fill in \"Why do you need to cancel?\".",
          "Press Send request.",
          "The card shows \"Cancellation requested\" until the office decides.",
        ],
        note: "Customers can only request a cancellation; the office always confirms it.",
      },
      {
        q: "What does the customer see after asking for a change?",
        steps: [
          "The card shows \"Change requested\" or \"Cancellation requested\" with their reason.",
          "The appointment stays as booked until the office confirms.",
          "They get a text/email when it is moved (\"Your … appointment is now …\") or declined (\"We weren't able to make that change …\").",
        ],
      },
      {
        q: "How does a customer pay in the portal?",
        steps: [
          "Open the booking.",
          "In Payment press \"Pay {amount}\".",
          "Enter the card in \"Pay securely\" and press \"Pay {amount}\".",
          "\"Payment received\" confirms it.",
        ],
        note: "The Pay button only appears when the company has connected card payments.",
      },
    ],
    fixes: [
      {
        problem: "\"Your technician is already on the way — please call the office so we can help right away.\"",
        fix: "Once the pro is on the way, on site or working, changes can't be made online. Call the office.",
      },
      {
        problem: "\"This appointment is closed, so it can no longer be changed.\"",
        fix: "Completed or cancelled bookings can't be changed.",
      },
      {
        problem: "\"We can't change this appointment online — please contact the office.\"",
        fix: "The booking has no usable scheduled time. Contact the office.",
      },
      {
        problem: "No 'Need to change this?' card",
        fix: "The company has switched off both online rescheduling and cancellation requests.",
      },
      {
        problem: "\"We couldn't find that booking\"",
        fix: "It may have been cancelled, or the link is out of date. Press \"See my bookings\".",
      },
    ],
    keywords: ["reschedule", "cancel", "change appointment", "move booking", "pay invoice", "cutoff"],
  },

  // ─────────────────────────────────────────────────── customer portal profile
  {
    id: "customer.portal.profile",
    title: "Customer portal — Profile",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Customer portal → Profile",
    route: "/app/profile",
    summary: "Shows the {customer}'s name, email, phone and account type, and signs out.",
    controls: [
      { label: "Email / Phone / Account type", does: "Read-only account details. Phone shows \"Not set\" if empty." },
      { label: "Sign out", does: "Signs out on this device and returns to sign in, even if the server can't be reached." },
    ],
    tasks: [
      { q: "How does a customer sign out?", steps: ["Open Profile.", "Press Sign out."] },
      { q: "Where does a customer see the email on their account?", steps: ["Open Profile.", "Read Email."] },
      { q: "Where does a customer see the phone number on their account?", steps: ["Open Profile.", "Read Phone (\"Not set\" if there isn't one)."] },
      {
        q: "Sign out didn't seem to reach the server — is the customer still signed in?",
        steps: ["No. Sign out always clears the login on this device.", "The page returns to sign in."],
      },
    ],
    keywords: ["profile", "log out", "sign out", "account"],
  },

  // ──────────────────────────────────────────────── texts and emails customers get
  {
    id: "customer.messages",
    title: "Texts and emails your customers get",
    surface: "customer",
    platforms: ["web"],
    roles: ["customer"],
    path: "Sent automatically on {job} events; each company can change channels and wording in its notification settings",
    summary:
      "The messages a {customer} receives and what triggers them. Defaults are below; the company can turn each channel (in-app, email, text) on or off per event and rewrite the wording, and its industry may start with different defaults. Emails are branded with the company's logo and name.",
    controls: [
      { label: "Request received (created) — email by default", does: "When a {job} is created (office, request form or portal). \"{company}: We've received your request for {service}. We'll confirm a technician shortly.\" No link." },
      { label: "Tech assigned — email by default", does: "When a {worker} is assigned. \"{company}: {worker name} has been assigned to your {service} appointment.\" No link." },
      { label: "Tech accepts — in-app only by default", does: "\"{company}: {worker name} accepted your {service} job and is scheduled for {when}.\"" },
      { label: "On the way (enroute) — text and email by default", does: "When the {worker} sets off. \"{company}: Your technician {name} is on the way! ETA ~N min. Track live, see ETA & message them: {tracking link}\". Starts the 24-hour live-link window." },
      { label: "Arrived — text and email by default", does: "\"{company}: {name} has arrived at your location.\" No link." },
      { label: "Job started — in-app only by default", does: "\"{company}: {name} has started your {service}.\"" },
      { label: "Running late (delayed) — text by default", does: "When the {job} is projected to miss its time by more than the company's threshold (15 minutes by default), or the office sends it. \"… we're running about N minutes behind, so {name} should reach you closer to {time}. Sorry to hold you up. Live status: {tracking link}\"" },
      { label: "Job completed — email by default", does: "\"{company}: Your {service} is complete. Thank you! Your record (photos, work done) + feedback: {tracking link}\" plus \"Full history for this address: {property link}\" when the address has one." },
      { label: "Review request — text", does: "About 2 hours after completion by default, if no review yet and the company hasn't turned it off: \"{company}: thanks again for choosing us! How did we do? Rate your visit in 10 seconds: {tracking link}\"." },
      { label: "Payment receipt — email", does: "When a card payment succeeds: receipt email and in-app notice (\"Receipt {number} — ${amount} paid.\")." },
      { label: "Pay link — text (sent by staff)", does: "Only when staff choose to text it: \"{company}: your total is ${total}. Pay securely by card, Apple Pay or Google Pay: {pay link}\"." },
      { label: "Change request received — email by default", does: "When the {customer} asks to move or cancel: \"… The office will confirm shortly — nothing has changed yet.\"" },
      { label: "Rescheduled — email by default", does: "When the appointment moves: \"{company}: Your {service} appointment is now {when}. Details: {tracking link}\"." },
      { label: "Change declined — email by default", does: "\"{company}: We weren't able to make that change — your {service} appointment stays as booked for {when}. Call us if that doesn't work.\"" },
      { label: "Cancelled — email by default", does: "\"{company}: {job} #{number} ({service}) was cancelled.\"" },
    ],
    tasks: [
      {
        q: "What texts does a customer get by default?",
        steps: [
          "On the way (with the tracking link).",
          "Arrived.",
          "Running late (with the tracking link), if the {job} slips.",
          "The review request after completion (with the tracking link).",
          "The pay link, only if staff choose to text it.",
        ],
        note: "Some industries start with extra texts (for example request received, accepted and cancelled for emergency trades). The company can change any of it.",
      },
      {
        q: "Which messages contain the tracking link?",
        steps: [
          "On the way, Running late, Job completed, Rescheduled and the review request.",
          "The completion message also has the property history link when there is one.",
        ],
      },
      {
        q: "When does the customer get the on-the-way text?",
        steps: [
          "When the {worker} marks the {job} as on the way (en route).",
          "The text includes the ETA when known and the tracking link.",
        ],
      },
      {
        q: "When does the customer get asked for a review?",
        steps: [
          "After the {job} is marked complete, a text is scheduled (2 hours later by default).",
          "It is skipped if the {customer} already left a rating, the {job} is no longer complete, there's no phone number, or the company turned review requests off.",
        ],
      },
      {
        q: "Do customer emails come from my company?",
        steps: [
          "Emails carry the company's logo and name.",
          "A custom from-address is used only once the company's sending domain is verified; otherwise a shared sender is used.",
        ],
      },
      {
        q: "Why didn't my customer get a text? (office)",
        steps: [
          "Check the event has text switched on for the {customer} in the notification settings.",
          "Check the {customer} has a phone number on the {job} or their profile.",
          "Check texting is enabled for the company and not inside quiet hours.",
        ],
      },
    ],
    fixes: [
      {
        problem: "Customer didn't get any text",
        fix: "Texts need a phone number on the {job} or {customer}, the rule's text channel on, and the company's text channel allowed (quiet hours can hold them). The delivery log records sent, failed or skipped (\"sms not configured\").",
      },
      {
        problem: "Customer got a tracking link that says it expired",
        fix: "The live link lasts 24 hours from when the {worker} set off. Completed {jobs}' links never expire.",
      },
    ],
    keywords: ["SMS", "text messages", "emails", "notifications", "on the way text", "review request", "receipt email", "customer notifications"],
  },

  // ─────────────────────────────────────────────────────────── account: signup
  {
    id: "account.signup",
    title: "Start a free trial (company signup)",
    surface: "account",
    platforms: ["web"],
    roles: ["anyone"],
    path: "Website → Get started",
    route: "/get-started",
    summary:
      "Self-serve signup for a new company in four steps: Website, Your company, You, Trial. ArrivePing reads the website to prefill details, then takes a card for after the 30-day free trial and opens the dashboard.",
    controls: [
      { label: "Company website / Scan my site", does: "Enter the website; scanning starts by itself once it looks like a domain, or press Scan my site." },
      { label: "Skip this step", does: "\"No website?\" — go straight to entering details by hand." },
      { label: "Yes, that's us / Fix something", does: "After the scan: accept what was found, or edit it." },
      { label: "Fill in my details by hand instead", does: "Shown when the site couldn't be read." },
      { label: "Company name / What kind of business is this? / Describe your business", does: "Required company name and industry (\"Other\" asks for a short description)." },
      { label: "Business phone / Business address / Contact email", does: "Prefilled from the site where found; gaps are flagged." },
      { label: "Looks right — continue / Continue", does: "Moves to the You step." },
      { label: "Different website / I do have a website / Re-scan my site", does: "Go back to the website step or read the site again." },
      { label: "First name / Last name / Mobile number / Your work email", does: "The admin's details." },
      { label: "Password (min. 8 characters) / Confirm password", does: "Password for a new login." },
      { label: "Your existing ArrivePing password / Sign in and continue", does: "Shown when the email already has a login; signs in and adds the new company to it." },
      { label: "Forgot it, or never set one? Reset it by email", does: "Opens the forgot-password page in a new tab." },
      { label: "Card form / Start my 30-day free trial", does: "Saves a card through Stripe (not charged today), creates the company and signs in." },
      { label: "Back / ← Back", does: "Previous step." },
      { label: "Sign in", does: "\"Already set up?\" — go to sign in." },
      { label: "Cookie preferences", does: "Opens cookie consent settings." },
    ],
    tasks: [
      {
        q: "How do I sign up my company?",
        steps: [
          "Go to Get started and type your website in Company website (or press Skip this step).",
          "Check what was found and press \"Yes, that's us\" or \"Fix something\".",
          "Fill in Company name and the kind of business, then Continue.",
          "Enter your name, mobile, work email and a password, then Continue.",
          "Enter a card and press \"Start my 30-day free trial\".",
          "Wait while the workspace is set up; you land in the office dashboard.",
        ],
        note: "Nothing is charged for 30 days; cancel any time in the first 30 days and you're never billed. After that: $49/month plus drivers at the published rates.",
      },
      {
        q: "I already have an ArrivePing login. How do I add a new company to it?",
        steps: [
          "On the You step, enter the email you already use.",
          "Press Continue; the page says \"You already have an ArrivePing login\".",
          "Type \"Your existing ArrivePing password\" and press \"Sign in and continue\".",
          "Add the card and start the trial; the new company is added to the same login.",
        ],
        note: "You then switch between companies from one account.",
      },
      {
        q: "Will my card be charged when I sign up?",
        steps: [
          "No. The card is saved for after the 30-day trial and isn't charged today.",
          "Cancel any time in the first 30 days and you'll never be billed.",
        ],
      },
      {
        q: "My company has no website. Can I still sign up?",
        steps: ["Press Skip this step on the website screen.", "Fill in the company details by hand and continue."],
      },
    ],
    fixes: [
      {
        problem: "\"This email already has an ArrivePing login. Sign in with it to add your new company to that login.\"",
        fix: "Enter that login's existing password in the box shown, or use \"Forgot it, or never set one? Reset it by email\".",
      },
      {
        problem: "\"That password doesn't match this login. Try again, or reset it.\"",
        fix: "The existing login's password was wrong. Retry or reset it by email.",
      },
      {
        problem: "Card declined / \"We couldn't save that card. Please check the details.\"",
        fix: "Stripe's message is shown under the card. Check the details or use another card.",
      },
      {
        problem: "\"We couldn't start your free trial with that card. Please try again.\"",
        fix: "The trial subscription couldn't be started with the saved card. Try again or use another card.",
      },
      {
        problem: "\"This card is already used by another ArrivePing company.\"",
        fix: "Each card can only start one company. Use a different card.",
      },
      {
        problem: "\"Those passwords don't match. Please type them again.\" / password rules",
        fix: "Both password boxes must match and be at least 8 characters.",
      },
      {
        problem: "\"Couldn't read that site — you can still sign up and fill this in yourself.\"",
        fix: "Press \"Fill in my details by hand instead\" and continue.",
      },
      {
        problem: "\"We need your company name to set up your account.\" / \"Tell us in a few words what your business does.\"",
        fix: "Fill in Company name, and the description when the industry is Other.",
      },
    ],
    keywords: ["sign up", "free trial", "get started", "create company", "register", "30 days", "website scan"],
  },

  // ─────────────────────────────────────────────────────────── account: sign in
  {
    id: "account.sign-in",
    title: "Sign in",
    surface: "account",
    platforms: ["web"],
    roles: ["anyone"],
    path: "Website → Sign in",
    route: "/sign-in",
    summary:
      "Email and password sign in for everyone. After signing in, office staff go to the dashboard, {workers} to the technician app and {customers} to the customer portal.",
    controls: [
      { label: "Email address", does: "Login email." },
      { label: "Password", does: "Login password." },
      { label: "Forgot password?", does: "Opens the reset page." },
      { label: "Sign in", does: "Signs in and opens your home: /admin (office), /rider ({workers}) or /app ({customers})." },
      { label: "Create one", does: "\"New to ArrivePing?\" — opens customer account sign-up." },
    ],
    tasks: [
      {
        q: "How do I sign in?",
        steps: ["Open Sign in.", "Enter Email address and Password.", "Press Sign in."],
      },
      {
        q: "I forgot my password. What do I do?",
        steps: ["On Sign in press \"Forgot password?\".", "Enter your email and press Send reset link.", "Open the email and choose a new password."],
      },
      {
        q: "I belong to more than one company. How do I sign in?",
        steps: ["Sign in once with your login.", "Switch between companies from the menu."],
      },
      {
        q: "Where does sign in take me?",
        steps: [
          "Office staff (admin, manager, dispatcher, project manager) go to the office dashboard.",
          "{workers} go to the technician app; {customers} go to the customer portal.",
        ],
      },
    ],
    fixes: [
      {
        problem: "Error banner after pressing Sign in",
        fix: "The email or password didn't match. Check them, or press \"Forgot password?\" to reset.",
      },
    ],
    keywords: ["log in", "login", "sign in", "password"],
  },

  // ───────────────────────────────────────────────────── account: customer signup
  {
    id: "account.sign-up",
    title: "Create a customer account",
    surface: "account",
    platforms: ["web"],
    roles: ["customer"],
    path: "Sign in → Create one",
    route: "/sign-up",
    summary:
      "Creates a customer login for the customer portal. {workers} cannot sign up here; they join by invitation.",
    controls: [
      { label: "Full name / Email address / Phone number / Password", does: "Account details; phone is optional." },
      { label: "Create account", does: "Creates the customer login and opens the customer portal." },
      { label: "Sign in", does: "\"Already have an account?\" — go to sign in." },
    ],
    tasks: [
      {
        q: "How does a customer create a portal account?",
        steps: ["Open Sign in and press Create one.", "Fill in Full name, Email address, Phone number (optional) and Password.", "Press Create account."],
      },
      {
        q: "How does a technician get an account?",
        steps: ["Technicians join by invitation only.", "Ask the office to send an invite link, then open it to set up the account."],
      },
      {
        q: "Does a customer need an account to track a job?",
        steps: [
          "No. The tracking, pay, selections and property links all work without a login.",
          "An account is only needed for the customer portal (booking, rescheduling, payment history).",
        ],
      },
      {
        q: "What happens after the customer presses Create account?",
        steps: ["The account is created and signed in.", "The customer portal Home opens."],
      },
    ],
    fixes: [
      {
        problem: "Account creation error shown in red",
        fix: "Usually the email already has an account (sign in instead) or the password is shorter than 8 characters.",
      },
    ],
    keywords: ["create account", "register", "customer sign up"],
  },

  // ───────────────────────────────────────────────────── account: forgot password
  {
    id: "account.forgot-password",
    title: "Forgot password",
    surface: "account",
    platforms: ["web"],
    roles: ["anyone"],
    path: "Sign in → Forgot password?",
    route: "/forgot-password",
    summary: "Sends a password reset link to the email entered.",
    controls: [
      { label: "Email address", does: "The login email." },
      { label: "Send reset link", does: "Emails a reset link if an account exists. The page then shows \"Check your inbox\"." },
      { label: "Back to sign in", does: "Returns to sign in." },
    ],
    tasks: [
      {
        q: "How do I reset my password?",
        steps: [
          "Open Sign in and press \"Forgot password?\".",
          "Enter your Email address and press Send reset link.",
          "Open the \"Reset your … password\" email and press its button.",
          "Choose a new password and press Reset password.",
        ],
        note: "The reset link expires in 1 hour.",
      },
      {
        q: "I never set a password (I was added by a company). How do I get one?",
        steps: [
          "Open Forgot password and enter the email the company used.",
          "Press Send reset link and use the email to choose a password.",
        ],
      },
      {
        q: "How long is the reset link good for?",
        steps: ["1 hour from when it was sent.", "It works once; request a new one if it has expired."],
      },
      {
        q: "How do I get back to sign in?",
        steps: ["Press Back to sign in.", "It is on the form and on the \"Check your inbox\" screen."],
      },
    ],
    fixes: [
      {
        problem: "Reset email didn't arrive",
        fix: "The page says the same thing whether or not an account exists. Check the spelling of the email and the spam folder, then try again.",
      },
    ],
    keywords: ["reset password", "forgot password", "can't log in"],
  },

  // ───────────────────────────────────────────────────── account: reset password
  {
    id: "account.reset-password",
    title: "Choose a new password",
    surface: "account",
    platforms: ["web"],
    roles: ["anyone"],
    path: "Open the link in the reset email (or a welcome email from your company)",
    route: "/reset-password?token=…",
    summary:
      "Sets a new password from a reset link. The same page sets a first password from a welcome email sent when a company adds you.",
    controls: [
      { label: "New password / Confirm new password", does: "The new password, twice." },
      { label: "Reset password / Set password", does: "Saves it. \"Set password\" appears when the link came from a welcome email." },
      { label: "Request new link", does: "Shown when the link is invalid or expired; opens Forgot password." },
      { label: "Back to sign in", does: "Returns to sign in." },
    ],
    tasks: [
      {
        q: "How do I set my first password from a welcome email?",
        steps: ["Open the link in the welcome email.", "Enter the password twice.", "Press Set password."],
        note: "Field staff are then told to get the ArrivePing app from the App Store and sign in with their email and this password.",
      },
      {
        q: "What are the password rules?",
        steps: ["At least 8 characters.", "Both boxes must match."],
      },
      {
        q: "How do I reset my password from the email link?",
        steps: [
          "Open the link in the reset email.",
          "Type it in New password and Confirm new password.",
          "Press Reset password; you're taken to sign in.",
        ],
      },
      {
        q: "The page says the link is invalid. What now?",
        steps: ["Press Request new link.", "Enter your email and use the new link within 1 hour."],
      },
    ],
    fixes: [
      {
        problem: "\"Invalid or expired link\" / \"This reset link has already been used or has expired. Request a new one.\"",
        fix: "Reset links work once and expire after 1 hour. Press Request new link.",
      },
      {
        problem: "Welcome link: \"This link has expired or was replaced by a newer one.\"",
        fix: "Ask the office to send a new sign-in link, or request a reset yourself.",
      },
      {
        problem: "\"Password must be at least 8 characters.\" / \"Passwords do not match.\"",
        fix: "Use 8 or more characters and type the same password in both boxes.",
      },
    ],
    keywords: ["new password", "set password", "welcome email", "reset link"],
  },

  // ───────────────────────────────────────────────────── account: join (new login)
  {
    id: "account.join-invite",
    title: "Accept an invite (set up your account)",
    surface: "account",
    platforms: ["web"],
    roles: ["technician", "dispatcher", "manager"],
    path: "Open the invite link the office sent",
    route: "/join/:token",
    summary:
      "Where an invited {worker} or office team member creates their login (or sets the password on an account the company already made) and is signed in.",
    controls: [
      { label: "Full name", does: "Your name (prefilled from the invite when known)." },
      { label: "Mobile phone", does: "Your mobile number." },
      { label: "Create a password", does: "The password for your login (at least 8 characters)." },
      { label: "Activate my account / Set password & sign in", does: "Creates the account (or sets the password) and signs you in: {workers} go to the technician app, office staff to the dashboard." },
      { label: "Sign in", does: "\"Already set up?\" — go to sign in." },
    ],
    tasks: [
      {
        q: "How do I accept an invite?",
        steps: [
          "Open the invite link from your email or text.",
          "Check the email shown under \"For\".",
          "Fill in Full name and Mobile phone, and Create a password.",
          "Press \"Activate my account\" (or \"Set password & sign in\").",
        ],
      },
      {
        q: "Which email will my login use?",
        steps: [
          "The email the office invited, shown under the heading (\"For …\").",
          "It can't be changed on this page; ask the office to re-invite a different email.",
        ],
      },
      {
        q: "Where do I go after activating my account?",
        steps: [
          "You're signed in automatically.",
          "{workers} go to the technician app; office team members go to the dashboard.",
        ],
      },
      {
        q: "I already set up my account. How do I get back in?",
        steps: ["Press Sign in under \"Already set up?\".", "Sign in with your email and password."],
      },
    ],
    fixes: [
      {
        problem: "\"Invite not available\" / \"This invitation link is invalid, expired, or already used.\"",
        fix: "The invite was already accepted or was revoked. If you already set it up, Sign in; otherwise ask the office for a new invite.",
      },
      {
        problem: "\"Account already exists — please sign in\"",
        fix: "That email already has a login. Sign in instead, and ask the office to add your existing login to the company.",
      },
      {
        problem: "\"Password must be at least 8 characters\"",
        fix: "Use a longer password.",
      },
    ],
    keywords: ["invite", "join", "activate account", "technician invite", "onboarding link"],
  },

  // ───────────────────────────────────────────── account: join with existing login
  {
    id: "account.join-company",
    title: "Join another company with your existing login",
    surface: "account",
    platforms: ["web"],
    roles: ["anyone"],
    path: "Open the \"join company\" link sent to an email that already has an ArrivePing login",
    route: "/join-company/:membershipId",
    summary:
      "For someone who already has an ArrivePing login being added to another company. There is no password to set; you accept while signed in as that login, and keep your existing password.",
    controls: [
      { label: "Accept & join {company}", does: "Shown when signed in; adds the company to your login and switches to it." },
      { label: "Sign in to continue", does: "Shown when signed out; opens sign in." },
      { label: "Go to sign in", does: "Shown when the invite is no longer valid." },
    ],
    tasks: [
      {
        q: "How do I join a second company with the login I already have?",
        steps: [
          "Open the join link.",
          "If asked, press \"Sign in to continue\" and sign in as the invited email.",
          "Open the join link again and press \"Accept & join {company}\".",
          "You're taken into that company; switch companies any time from the menu.",
        ],
        note: "Joining doesn't give the new company access to your work at any other company.",
      },
      {
        q: "Do I need a new password to join?",
        steps: ["No. Keep your existing password.", "You accept while signed in as the login you already have."],
      },
      {
        q: "What role will I have in the new company?",
        steps: [
          "The page says \"would like to add you to their team as a …\" with the role.",
          "Roles: Admin, Manager, Dispatcher, Project manager, Technician or Client.",
        ],
      },
      {
        q: "How do I switch between my companies?",
        steps: ["After joining you're taken into the new company.", "Switch companies any time from the menu."],
      },
    ],
    fixes: [
      {
        problem: "\"This invite is no longer valid\"",
        fix: "The invite was already accepted or withdrawn. Ask the company to invite you again.",
      },
      {
        problem: "\"This invite belongs to a different account\"",
        fix: "You're signed in as a different login. Sign out and sign in as the invited email.",
      },
      {
        problem: "After signing in I didn't land back on the invite",
        fix: "Sign in opens your usual home page. Open the join link again to accept.",
      },
    ],
    keywords: ["join company", "second company", "existing account", "multiple companies", "add company"],
  },
];
