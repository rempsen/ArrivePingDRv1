import type { LegalDoc } from "./types";

/**
 * Help & Support — https://arriveping.com/support
 *
 * The support URL every app store listing requires, and the page the
 * technician app's Profile → "Help & Support" link opens. Written for the two
 * people who land here: a technician with the app on their phone, and an
 * office admin running dispatch. Rendered by the same component as the legal
 * documents so it shares their table of contents and deep-link anchors.
 */
export const support: LegalDoc = {
  eyebrow: "Help",
  title: "Help & Support",
  updated: "October 16, 2026",
  path: "/support",
  intro: [
    "ArrivePing is made by NVC360 in Winnipeg, Manitoba. Email is the fastest way to reach a real person: [support@nvc360.com](mailto:support@nvc360.com). We answer within one business day, Monday to Friday, 8:00 am to 6:00 pm Central Time, and sooner for anything that stops a crew from working.",
  ],
  sections: [
    {
      id: "contact",
      title: "Contact us",
      blocks: [
        {
          type: "ul",
          items: [
            "**Support (technicians and dispatchers):** [support@nvc360.com](mailto:support@nvc360.com)",
            "**Billing and account changes:** [support@nvc360.com](mailto:support@nvc360.com) — include your company name.",
            "**Privacy requests (access, correction, deletion):** [privacy@nvc360.com](mailto:privacy@nvc360.com)",
            "**Sales and demos:** [contact@nvc360.com](mailto:contact@nvc360.com)",
          ],
        },
        {
          type: "p",
          text: "When you write, tell us which company you work for, whether you are using the technician app or the web dashboard, and your phone model if the question is about the app. A screenshot helps.",
        },
      ],
    },
    {
      id: "technician-app",
      title: "Technician app",
      blocks: [
        { type: "h3", text: "Signing in" },
        {
          type: "p",
          text: "Your company adds you to its roster and ArrivePing emails you an invitation. Sign in with that email and the password you set from the invitation. There is no public sign-up for technicians: if you have not received an invitation, ask your dispatcher or office admin to add you.",
        },
        {
          type: "p",
          text: "Forgotten your password? Tap **Forgot password?** on the sign-in screen or go to [arriveping.com/forgot-password](/forgot-password). The reset link is valid for one hour.",
        },
        { type: "h3", text: "Location sharing" },
        {
          type: "p",
          text: "ArrivePing shares your live location with dispatch only while you are **On the clock** (the switch at the top of the Profile tab). When you go offline the app stops sharing and tells iOS to stop tracking. The app asks for the \"Always\" location permission because your ETA must keep updating while the phone is in your pocket or mounted in the van; if you prefer \"While Using\", tracking will pause whenever the app is in the background and customers will see a stale ETA.",
        },
        {
          type: "p",
          text: "To check or change the permission: iPhone **Settings → ArrivePing → Location**. Choose **Always** and turn on **Precise Location** for accurate ETAs.",
        },
        { type: "h3", text: "Notifications and Live Activities" },
        {
          type: "p",
          text: "New job offers, messages from dispatch and schedule changes arrive as push notifications. On iPhone the current job also appears as a Live Activity on the Lock Screen and in the Dynamic Island. If notifications stop, check **Settings → ArrivePing → Notifications** and make sure the app is allowed to use Background App Refresh.",
        },
        { type: "h3", text: "Photos, signatures and voice notes" },
        {
          type: "p",
          text: "Job photos and customer signatures are stored with the job and visible to your company's office. Voice notes are short recordings you dictate on site; they are transcribed for the office and kept with the job. The camera and microphone are only used when you tap those buttons.",
        },
        { type: "h3", text: "Working for more than one company" },
        {
          type: "p",
          text: "If two companies have added you, the Profile tab shows both and lets you switch. Your jobs, messages and earnings are kept separate per company, and only the company you are on shift for can see your location.",
        },
      ],
    },
    {
      id: "delete-account",
      title: "Deleting your account",
      blocks: [
        {
          type: "p",
          text: "You can delete your ArrivePing account yourself at any time, from inside the app: **Profile → Delete my account**. You will be asked to type DELETE to confirm.",
        },
        {
          type: "p",
          text: "What happens: you are signed out everywhere and can no longer sign in; your name, email, phone number, photo and licence details are erased; any jobs still assigned to you go back to the dispatch board; and the companies you worked for keep their job records (invoices, photos, time on site) with your name removed, as described in our [Privacy Policy](/privacy#retention-of-personal-information). Pay you are owed is settled by your employer outside the app.",
        },
        {
          type: "p",
          text: "If you are the only administrator of a company you must make someone else an administrator first (web dashboard → **Settings → Team**), or ask us to close the company. If you cannot get into the app, email [privacy@nvc360.com](mailto:privacy@nvc360.com) from the address on your account and we will delete it for you within 30 days.",
        },
      ],
    },
    {
      id: "dispatch-dashboard",
      title: "Dispatch dashboard (office)",
      blocks: [
        {
          type: "ul",
          items: [
            "**Adding technicians:** Technicians → Invite. Each active technician is a seat on your plan; the invitation email lets them set a password and install the app.",
            "**Deactivating or removing technicians:** Technicians → Deactivate keeps their history and frees the seat; Billing → change the number of users walks you through choosing who comes off the plan.",
            "**Customer notifications:** Settings → Notifications controls the SMS and email customers receive when a job is booked, when the technician is on the way, and when they arrive.",
            "**Billing:** Settings → Billing shows your plan, seat count and next invoice, and lets you change the card on file.",
          ],
        },
      ],
    },
    {
      id: "status-and-security",
      title: "Service status and security",
      blocks: [
        {
          type: "p",
          text: "If ArrivePing appears to be down, email [support@nvc360.com](mailto:support@nvc360.com) and we will confirm whether it is a platform issue or a device issue. To report a security concern, write to [privacy@nvc360.com](mailto:privacy@nvc360.com); please do not post details publicly until we have responded.",
        },
      ],
    },
  ],
};
