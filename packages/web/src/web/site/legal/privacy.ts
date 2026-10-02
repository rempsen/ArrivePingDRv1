import type { LegalDoc } from "./types";

/**
 * ArrivePing Privacy Policy.
 *
 * Adapted from the NVC360 Inc. privacy policy (nvc360.com/privacy-policy,
 * March 13, 2026) for the ArrivePing product and arriveping.com. NVC360 Inc.
 * remains the legal entity and data controller; "ArrivePing" is the platform.
 */
export const privacy: LegalDoc = {
  eyebrow: "Legal",
  title: "Privacy Policy",
  updated: "October 2, 2026",
  path: "/privacy",
  intro: [
    "NVC360 Inc. (\"NVC360\", \"we\", \"us\" or \"our\") operates ArrivePing, the appointment scheduling, technician arrival tracking and customer update platform available at arriveping.com and through the ArrivePing mobile app. We are committed to protecting the privacy of our clients, their technicians, their customers and visitors to our website.",
    "This Privacy Policy explains how we collect, use, disclose and safeguard personal information when you use ArrivePing or visit arriveping.com.",
  ],
  sections: [
    {
      id: "who-we-are",
      title: "Who We Are",
      blocks: [
        {
          type: "p",
          text: "NVC360 Inc. is a field operations and customer communication software company based in Winnipeg, Manitoba, Canada. ArrivePing is our platform for businesses that send technicians to customers' homes and job sites. It helps them schedule appointments, dispatch technicians, see where technicians are while they travel, and keep customers informed about arrival times.",
        },
        {
          type: "p",
          text: "Data controller: NVC360 Inc., Winnipeg, Manitoba, Canada. Email: [privacy@nvc360.com](mailto:privacy@nvc360.com).",
        },
      ],
    },
    {
      id: "permissions",
      title: "Permissions",
      blocks: [
        {
          type: "p",
          text: "The ArrivePing mobile app, used by technicians, may request access to certain device permissions. These permissions are used solely to provide the core functionality of the platform.",
        },
        {
          type: "ul",
          items: [
            "Location services: used to share a technician's position with their dispatch team while they are travelling to a job, to calculate estimated arrival times and to detect arrival at the job site. See Section 3 for full details.",
            "Camera and photo library: used to attach job-site photos and proof-of-completion images to a job.",
            "Notifications: used for job assignments, schedule changes and dispatch messages.",
          ],
        },
        {
          type: "note",
          title: "Your control",
          text: "All permissions are optional and can be managed through your device settings at any time. Disabling a permission may limit certain features of the app.",
        },
        {
          type: "p",
          text: "Customers of ArrivePing clients do not need to install an app or create an account. They receive appointment confirmations and arrival updates by text message or email, with a link to a web page showing the technician's estimated arrival time.",
        },
      ],
    },
    {
      id: "location-data",
      title: "Location Data",
      blocks: [
        {
          type: "p",
          text: "The ArrivePing mobile app collects and processes device location information from technicians to enable core features of the platform.",
        },
        { type: "h3", text: "3.1 What location data we collect" },
        {
          type: "ul",
          items: [
            "Precise location data (GPS coordinates).",
            "Approximate location data derived from network sources such as Wi-Fi or cellular networks.",
            "Background location data when the app is running in the background during an active shift or job, if background location permission is granted.",
          ],
        },
        {
          type: "note",
          title: "Consent required",
          text: "Location data is only collected when the technician grants permission through the device operating system.",
        },
        { type: "h3", text: "3.2 How location data is used" },
        {
          type: "p",
          text: "Location information is used solely to support the operational functionality of ArrivePing, including:",
        },
        {
          type: "ul",
          items: [
            "Showing the dispatch team where a technician is while travelling to a job.",
            "Calculating and updating the estimated arrival time shown to the customer.",
            "Detecting arrival at the job site so the customer can be notified automatically (with a manual confirmation available to the technician).",
            "Real-time job dispatching and routing decisions.",
            "Location-based notifications and job updates.",
          ],
        },
        { type: "h3", text: "3.3 When location data is collected" },
        {
          type: "ul",
          items: [
            "When the app is actively being used.",
            "When the app is running in the background during an active shift or job, if background location permission is granted.",
            "While a technician is travelling to a job. Sharing with the customer stops once the technician has arrived.",
          ],
        },
        {
          type: "p",
          text: "Technicians may disable location access at any time through their device settings.",
        },
        { type: "h3", text: "3.4 How location data is shared" },
        {
          type: "p",
          text: "Location data is not sold or shared with third parties for advertising purposes. Location data may be shared only with:",
        },
        {
          type: "ul",
          items: [
            "The technician's employer or organization using ArrivePing, and its authorized administrators and dispatchers.",
            "The customer for the active job, who sees the technician's position and estimated arrival time on their arrival page only while the technician is travelling to them.",
            "Service providers necessary to operate the platform, such as our cloud hosting, database and mapping providers.",
          ],
        },
        {
          type: "p",
          text: "All data is processed in accordance with applicable privacy and data protection laws.",
        },
        { type: "h3", text: "3.5 Technician control over location data" },
        {
          type: "ul",
          items: [
            "Enable or disable location services through device settings.",
            "Restrict location access to \"While Using the App\" only.",
            "Revoke location permission at any time.",
          ],
        },
        {
          type: "note",
          title: "Important",
          text: "Disabling location services limits functionality within the ArrivePing app, including live arrival estimates and automatic arrival detection.",
        },
        { type: "h3", text: "3.6 Location data security" },
        {
          type: "p",
          text: "We implement reasonable technical and organizational safeguards to protect location information from unauthorized access, alteration, disclosure or destruction.",
        },
      ],
    },
    {
      id: "data-we-collect",
      title: "Data We Collect",
      blocks: [
        { type: "p", text: "We collect the following categories of information:" },
        { type: "h3", text: "4.1 Information you provide" },
        {
          type: "ul",
          items: [
            "Demo and contact requests: name, company name, email address, phone number, team size and anything you write in your message.",
            "Account registration: name, email address, password (stored hashed) and company details.",
            "Support requests: communications, attachments and issue descriptions.",
            "Payment information: processed by our payment processor (Stripe). We do not store full card numbers.",
          ],
        },
        { type: "h3", text: "4.2 Information our clients enter about their customers" },
        {
          type: "p",
          text: "Businesses using ArrivePing enter information about their own customers so that appointments can be scheduled and arrival updates delivered: customer name, service address, phone number, email address, appointment details and job notes. We process this information on behalf of the business, which remains responsible for it. See Section 7 of our [Terms](/terms).",
        },
        { type: "h3", text: "4.3 Information collected automatically" },
        {
          type: "ul",
          items: [
            "Log data: IP address, browser type, pages visited, time and date of visits, referring URL.",
            "Device data: device type, operating system, app version.",
            "Usage data: features used, frequency of use and error reports within the platform.",
            "Delivery data: whether notifications, text messages and emails were delivered and whether arrival links were opened.",
          ],
        },
      ],
    },
    {
      id: "how-we-use",
      title: "How We Use Your Information",
      blocks: [
        { type: "p", text: "We use your information to:" },
        {
          type: "ul",
          items: [
            "Provide, operate and improve ArrivePing and arriveping.com.",
            "Respond to demo requests and inquiries.",
            "Deliver appointment confirmations, arrival updates and other messages on behalf of our clients.",
            "Send transactional emails (confirmations, account notices, support replies).",
            "Send marketing communications, only with your consent, which you can withdraw at any time.",
            "Analyze usage to improve features, fix bugs and enhance security.",
            "Comply with legal obligations under Canadian and other applicable law.",
            "Enforce our Terms and protect against fraud or abuse.",
          ],
        },
        {
          type: "note",
          title: "Legal basis (PIPEDA / Canadian law)",
          text: "We process personal information based on consent, contractual necessity or legitimate business interests. You may withdraw consent at any time.",
        },
      ],
    },
    {
      id: "sharing",
      title: "Data Sharing & Disclosure",
      blocks: [
        { type: "p", text: "We do not sell your personal information. We may share data with:" },
        {
          type: "ul",
          items: [
            "Service providers: cloud hosting and database infrastructure, file storage, email delivery (Resend), text message delivery (Twilio), payment processing (Stripe), map rendering (Google Maps Platform) and error monitoring (Sentry). Each is bound by data processing terms and may only use the data to provide its service to us.",
            "Our clients: information about a technician's location and job activity is shared with the business that employs or contracts them, as described in Section 3.",
            "Legal requirements: if required by law, court order or to protect the safety of our users or the public.",
            "Business transfers: in the event of a merger or acquisition, with the same privacy protections applied.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "Data Retention",
      blocks: [
        {
          type: "p",
          text: "We retain personal information only as long as necessary for the purposes outlined in this policy:",
        },
        {
          type: "ul",
          items: [
            "Demo and contact form submissions: up to 3 years from the submission date.",
            "Account data: for the duration of the account plus 2 years after closure.",
            "Technician location history: kept for the client's operational records and deleted with the client's account data.",
            "Log data: up to 12 months.",
            "Financial records: 7 years, as required by Canadian tax law.",
          ],
        },
        { type: "p", text: "You may request deletion of your data at any time. See Section 8." },
      ],
    },
    {
      id: "your-rights",
      title: "Your Rights",
      blocks: [
        {
          type: "p",
          text: "Under PIPEDA and applicable Canadian privacy law, you have the right to:",
        },
        {
          type: "ul",
          items: [
            "Access: request a copy of the personal information we hold about you.",
            "Correction: request correction of inaccurate or incomplete information.",
            "Deletion: request deletion of your personal information, subject to legal obligations.",
            "Withdrawal of consent: withdraw consent for marketing communications at any time.",
            "Portability: request your data in a portable, machine-readable format.",
            "Complaint: file a complaint with the Office of the Privacy Commissioner of Canada at priv.gc.ca.",
          ],
        },
        {
          type: "note",
          title: "Submit a data request",
          text: "Email [privacy@nvc360.com](mailto:privacy@nvc360.com). We will respond within 30 days. If you are a customer of a business that uses ArrivePing, we may refer your request to that business, since it controls the information it entered about you.",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies & Tracking Technologies",
      blocks: [
        {
          type: "p",
          text: "ArrivePing uses essential cookies only. These are required for signing in and keeping your session secure and cannot be disabled without breaking the platform.",
        },
        {
          type: "p",
          text: "We do not currently use advertising or marketing cookies on arriveping.com. If we introduce analytics or marketing cookies in the future, we will update this policy and ask for your consent where required.",
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        {
          type: "p",
          text: "We implement industry-standard security measures to protect your information, including:",
        },
        {
          type: "ul",
          items: [
            "TLS encryption for all data in transit.",
            "Encrypted storage for sensitive account data.",
            "Access controls so that each business can only see its own data.",
            "Regular security review and dependency updates.",
          ],
        },
        {
          type: "p",
          text: "No method of transmission over the Internet is 100% secure. If you believe your data has been compromised, contact us immediately at [privacy@nvc360.com](mailto:privacy@nvc360.com).",
        },
      ],
    },
    {
      id: "children",
      title: "Children's Privacy",
      blocks: [
        {
          type: "p",
          text: "ArrivePing and arriveping.com are not directed to individuals under 16 years of age. We do not knowingly collect personal information from children. If you become aware that a child has provided us with personal information, contact us and we will take steps to delete it.",
        },
      ],
    },
    {
      id: "pipeda",
      title: "PIPEDA Compliance (Canada)",
      blocks: [
        {
          type: "p",
          text: "NVC360 Inc. is subject to the Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy legislation. We are committed to the ten fair information principles:",
        },
        {
          type: "ul",
          items: [
            "Accountability: a designated Privacy Officer oversees compliance.",
            "Identifying purposes: we identify why information is collected before or at the time of collection.",
            "Consent: we obtain meaningful consent before collecting, using or disclosing information.",
            "Limiting collection: we collect only what is necessary.",
            "Limiting use, disclosure and retention: information is used only for stated purposes.",
            "Accuracy: we keep information accurate and up to date.",
            "Safeguards: appropriate security measures are in place.",
            "Openness: our privacy practices are publicly available.",
            "Individual access: individuals can access and correct their information.",
            "Challenging compliance: individuals can challenge our compliance with PIPEDA.",
          ],
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to This Policy",
      blocks: [
        {
          type: "p",
          text: "We may update this Privacy Policy from time to time. When we make material changes, we will update the \"Last updated\" date at the top of this page and, where appropriate, notify you by email or a prominent notice on our website. Your continued use of the platform after changes are posted constitutes your acceptance of the revised policy.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact Us",
      blocks: [
        {
          type: "p",
          text: "For privacy inquiries, data requests or to exercise your rights, contact our Privacy Officer at [privacy@nvc360.com](mailto:privacy@nvc360.com). We respond within 30 days.",
        },
        {
          type: "p",
          text: "Mailing address: NVC360 Inc., Privacy Officer, Winnipeg, Manitoba, Canada.",
        },
      ],
    },
  ],
};
