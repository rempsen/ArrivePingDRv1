import type { LegalDoc } from "./types";

/**
 * ArrivePing Privacy Policy — 10161758 Manitoba Ltd. dba NVC360.
 *
 * Source: "ArrivePing_Privacy_Policy_Draft_2.docx" (supplied by Dan Rosenblat,
 * published October 16, 2026).
 *
 * Text is reproduced exactly from the approved draft; only links were added
 * (email addresses, priv.gc.ca, cross-links between the two documents).
 * `**bold**` marks the lead-in labels the draft sets in bold.
 */
export const privacy: LegalDoc = {
  eyebrow: "Legal",
  title: "Privacy Policy",
  updated: "October 18, 2026",
  path: "/privacy",
  intro: [
    "10161758 Manitoba Ltd. dba NVC360 (\"arriveping.com by NVC360\", \"we\", \"us\", or \"our\") is committed to protecting the privacy of our clients, users, and website visitors (collectively, \"you\", \"yours\", or \"user(s)\"). This Privacy Policy explains how we collect, use, disclose, and safeguard your organization's data (your \"Data\") and any information you provide us about an identifiable individual (your \"Personal Information\") when you use the arriveping.com by NVC360 platform, mobile app, website (arriveping.com), and any associated services (collectively, the \"Services\")."
  ],
  sections: [
    {
      id: "who-we-are",
      title: "Who We Are",
      blocks: [
        {
          type: "p",
          text: "arriveping.com by NVC360 is a field operations and client communication platform headquartered in Winnipeg, Manitoba, Canada. We provide software solutions to businesses that deploy field technicians, helping them manage dispatch, scheduling, real-time tracking, and automated client communications."
        }
      ]
    },
    {
      id: "permissions",
      title: "Permissions",
      blocks: [
        {
          type: "p",
          text: "arriveping.com by NVC360 may request access to certain device permissions including location services, camera, and notifications. These permissions are used to provide the Services that you request from us."
        },
        {
          type: "ul",
          items: [
            "**Location Services:** Used for technician tracking, dispatch routing, and estimated arrival times. See Section 3 for full details.",
            "**Camera:** Used for capturing job-site photos, and proof-of-completion images.",
            "**Notifications:** Used for real-time job alerts, dispatch updates, and customer communication notifications.",
            "**Microphone:** Used to create voice notes or memos, if microphone permissions are enabled in device settings."
          ]
        },
        {
          type: "note",
          title: "Your Control",
          text: "All permissions are optional and can be managed through your device settings at any time. Disabling permissions may limit certain features of the application."
        }
      ]
    },
    {
      id: "location-data",
      title: "Location Information",
      blocks: [
        {
          type: "p",
          text: "arriveping.com by NVC360 may collect and process device location information to enable core features of the Services."
        },
        {
          type: "h3",
          text: "3.1 What Location Information We Collect"
        },
        {
          type: "p",
          text: "arriveping.com by NVC360 may collect the following types of location information from a user's mobile device:"
        },
        {
          type: "ul",
          items: [
            "Precise location data (GPS coordinates).",
            "Approximate location data derived from network sources such as Wi-Fi or cellular networks.",
            "Background location data when the application is running in the background."
          ]
        },
        {
          type: "note",
          title: "Consent Required",
          text: "Location information is only collected when the user grants permission through the device operating system."
        },
        {
          type: "h3",
          text: "3.2 How Location Information Is Used"
        },
        {
          type: "p",
          text: "Location information may be used to support the operational functionality of the Services, including:"
        },
        {
          type: "ul",
          items: [
            "Tracking the location of field technicians and vehicles.",
            "Providing real-time job dispatching and routing.",
            "Displaying technician estimated arrival times.",
            "Improving operational visibility for businesses managing mobile workforces.",
            "Enabling location-based notifications and job updates."
          ]
        },
        {
          type: "h3",
          text: "3.3 When Location Information Is Collected"
        },
        {
          type: "p",
          text: "Location information may be collected:"
        },
        {
          type: "ul",
          items: [
            "When the app is actively being used.",
            "When the app is running in the background (if background location permission is granted).",
            "When a work session or job tracking feature is active."
          ]
        },
        {
          type: "p",
          text: "Users may disable location access at any time through their device settings."
        },
        {
          type: "h3",
          text: "3.4 How Location Information Is Shared"
        },
        {
          type: "p",
          text: "Location information may be shared with:"
        },
        {
          type: "ul",
          items: [
            "The user's employer, organization, or authorized administrators.",
            "Third-party service providers necessary to provide the Services that you request from us (such as secure cloud hosting providers)."
          ]
        },
        {
          type: "h3",
          text: "3.5 User Control Over Location Information"
        },
        {
          type: "p",
          text: "Users have the ability to manage location permissions and may:"
        },
        {
          type: "ul",
          items: [
            "Enable or disable location services through their device settings.",
            "Restrict location access to \"While Using the App\" only."
          ]
        },
        {
          type: "note",
          title: "Important",
          text: "Disabling location permissions may limit certain functionality within the arriveping.com by NVC360 application. It may be the case that when certain features are enabled, such as real-time tracking and automated dispatch routing, location information is required and cannot be disabled until those features are stopped."
        },
        {
          type: "h3",
          text: "3.6 Location Information Security"
        },
        {
          type: "p",
          text: "arriveping.com by NVC360 implements reasonable technical and organizational safeguards to protect location information from unauthorized access, alteration, disclosure, or destruction."
        }
      ]
    },
    {
      id: "data-and-personal-information-we-collect",
      title: "Data and Personal Information We Collect",
      blocks: [
        {
          type: "p",
          text: "In addition to the other methods of collection described in this Privacy Policy, we may collect the following categories of Data and Personal Information from users, through the following means:"
        },
        {
          type: "h3",
          text: "4.1 Information You Provide"
        },
        {
          type: "ul",
          items: [
            "**Beta / Contact Forms:** First name, last name, company name, email address, phone number, team size, and industry.",
            "**Account Registration:** Name, email, password (hashed), company details.",
            "**Information from your website:** We may collect public business information (logo, services, terminology, service area) and contact details published on the website of the user's organization.",
            "**Support Requests:** Communications, attachments, and issue descriptions from the user.",
            "**Payment Information:** Processed by third-party processors (e.g., Stripe). We do not store full card numbers."
          ]
        },
        {
          type: "h3",
          text: "4.2 Information Collected Automatically"
        },
        {
          type: "ul",
          items: [
            "**Log Data:** IP address, browser type, pages visited, time and date of visits, referring URL.",
            "**Device Data:** Device type, operating system, screen resolution.",
            "**Cookies & Tracking:** Session cookies, preference cookies, and analytics cookies. See Section 9.",
            "**Usage Data:** Features used, frequency of use, error reports within the platform."
          ]
        },
        {
          type: "h3",
          text: "4.3 Information from Third Parties"
        },
        {
          type: "ul",
          items: [
            "Analytics providers.",
            "Optional integrations, where available."
          ]
        },
        {
          type: "p",
          text: "You acknowledge and agree that you are solely responsible for providing all necessary notices and collecting all necessary consents for your collection, use, and disclosure through the Services of any Personal Information or other data from your sub-contractors or end-customers, including, but not limited to, location information."
        }
      ]
    },
    {
      id: "how-we-use-your-information",
      title: "How We Use Your Information",
      blocks: [
        {
          type: "p",
          text: "We may use the Personal Information collected from you for the following purposes:"
        },
        {
          type: "ul",
          items: [
            "To provide, operate, and improve the Services.",
            "To process beta access requests and respond to inquiries.",
            "Transactional emails (confirmations, account notices, support replies).",
            "Opt-in marketing communications.",
            "To analyze usage to improve features, fix bugs, and enhance security.",
            "Where permitted or required under applicable law.",
            "To enforce our [Terms of Service](/terms) and protect against fraud or abuse.",
            "For any other purpose that you may consent to, from time to time."
          ]
        },
        {
          type: "p",
          text: "We process Personal Information based on consent, contractual necessity, or legitimate business interests. You may withdraw consent at any time."
        }
      ]
    },
    {
      id: "data-sharing-and-disclosure-of-personal-information",
      title: "Data Sharing & Disclosure of Personal Information",
      blocks: [
        {
          type: "p",
          text: "We may disclose your Data or Personal information to third parties for the following purposes:"
        },
        {
          type: "ul",
          items: [
            "**Third-Party Service Providers:** Hosting, email delivery, payment processing, analytics.",
            "**Integration Partners:** Only Data and Personal Information you explicitly authorize when connecting third-party tools.",
            "**Legal Requirements:** If required by law, court order, or to protect the safety of our users or the public.",
            "**Business Transfers:** In the event of a merger or acquisition, with the same privacy protections applied."
          ]
        },
        {
          type: "p",
          text: "If we disclose your Data or Personal Information, we will not disclose more information than is required for the purpose for which the information is being disclosed. We will also, whenever it is reasonable and practicable to do so, enter into privacy agreements with third parties to whom we disclose Data or Personal Information."
        }
      ]
    },
    {
      id: "retention-of-personal-information",
      title: "Retention of Personal Information",
      blocks: [
        {
          type: "p",
          text: "We retain Data and Personal Information only as long as necessary for the purposes outlined in this Privacy Policy, or as otherwise required by law. Data and Personal Information that is no longer necessary or required to be retained is destroyed, erased or made anonymous, as appropriate in the circumstances."
        },
        {
          type: "p",
          text: "You may request deletion of your Personal Information at any time, subject to legal and contractual restrictions. See Section 8."
        }
      ]
    },
    {
      id: "your-rights",
      title: "Your Rights",
      blocks: [
        {
          type: "p",
          text: "Under applicable privacy laws, you have the following rights with respect to our collection, use, and disclosure of your Personal Information:"
        },
        {
          type: "ul",
          items: [
            "**Access:** Request a copy of the Personal Information we hold about you.",
            "**Correction:** Request correction of inaccurate or incomplete information.",
            "**Deletion:** Request deletion of your Personal Information, subject to legal obligations.",
            "**Withdrawal of Consent:** Withdraw consent for marketing communications at any time.",
            "**Portability:** Request your Personal Information in a portable, machine-readable format.",
            "**Complaint:** File a complaint with the Office of the Privacy Commissioner of Canada (OPC) at [priv.gc.ca](https://www.priv.gc.ca)."
          ]
        },
        {
          type: "note",
          title: "Submit a Personal Information Request",
          text: "You may request your Personal Information at any time. To request your Personal Information, email [privacy@nvc360.com](mailto:privacy@nvc360.com). We will respond within 30 days."
        }
      ]
    },
    {
      id: "cookies-and-tracking-technologies",
      title: "Cookies & Tracking Technologies",
      blocks: [
        {
          type: "p",
          text: "We may use the following types of cookies, for the following purposes:"
        },
        {
          type: "ul",
          items: [
            "**Essential Cookies:** Required for the Services to function. Cannot be disabled.",
            "**Preference Cookies:** Used to remember your settings and preferences.",
            "**Analytics Cookies:** HubSpot's cookies, used on our marketing website to understand how visitors find and use it (pages visited, how you arrived). Only with your consent; see below.",
            "**Marketing Cookies:** The same HubSpot cookies also connect your visits to a sign-up or a request to be contacted, so we can follow up. They are covered by the same consent."
          ]
        },
        {
          type: "p",
          text: "We use these analytics and marketing cookies only on our marketing website (the homepage, product, pricing, blog, support and sign-up pages). We don't use them inside the ArrivePing app, on job tracking links sent to your customers, or on booking and intake forms."
        },
        {
          type: "p",
          text: "They're set only if you choose \"Accept\" in the cookie notice; until then, and if you choose \"Decline\", they're off. You can change your choice at any time with \"Cookie preferences\" in the website footer; turning them off removes HubSpot's cookies. If your browser sends a Global Privacy Control signal, we treat it as declining. You can also block or delete cookies in your browser settings. Note that disabling essential cookies may affect platform functionality."
        }
      ]
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        {
          type: "p",
          text: "We implement industry-standard security measures to protect your Data and Personal Information, including:"
        },
        {
          type: "ul",
          items: [
            "SSL/TLS encryption for all data in transit.",
            "Encrypted storage for sensitive account data.",
            "Access controls limiting who can access Personal Information.",
            "Regular security assessments and vulnerability testing."
          ]
        },
        {
          type: "p",
          text: "No method of transmission over the Internet is 100% secure. If you believe your Data or Personal Information has been compromised, contact us immediately at [privacy@nvc360.com](mailto:privacy@nvc360.com)."
        },
        {
          type: "p",
          text: "Only our employees who require access for legitimate reasons or whose duties reasonably so require, are granted access to Personal Information."
        }
      ]
    },
    {
      id: "childrens-privacy",
      title: "Children's Privacy",
      blocks: [
        {
          type: "p",
          text: "The Services are not directed to individuals under 18 years of age. We do not knowingly collect Personal Information from children. If you become aware that a child has provided us with Personal Information, contact us and we will take steps to delete it."
        }
      ]
    },
    {
      id: "pipeda-compliance-canada",
      title: "PIPEDA Compliance (Canada)",
      blocks: [
        {
          type: "p",
          text: "arriveping.com by NVC360 is subject to the Personal Information Protection and Electronic Documents Act (PIPEDA) and other applicable privacy laws. We are committed to the ten fair information principles surrounding the collection, use or disclosure of your personal information:"
        },
        {
          type: "ul",
          items: [
            "**Accountability —** A designated Privacy Officer oversees compliance.",
            "**Identifying Purposes —** We identify why Personal Information is collected before or at time of collection.",
            "**Consent —** We obtain meaningful consent before collecting, using, or disclosing Personal Information.",
            "**Limiting Collection —** We collect only what is necessary to fulfil the business purposes for which it was collected.",
            "**Limiting Use, Disclosure, and Retention —** Personal Information is used only for the purposes stated at collection or in this Privacy Policy.",
            "**Accuracy —** We keep Personal Information accurate and up to date.",
            "**Safeguards —** Appropriate security measures are in place.",
            "**Openness —** Our privacy practices are publicly available.",
            "**Individual Access —** Individuals can access and correct their Personal Information.",
            "**Challenging Compliance —** Individuals can challenge our compliance with PIPEDA."
          ]
        }
      ]
    },
    {
      id: "changes-to-this-policy",
      title: "Changes to This Policy",
      blocks: [
        {
          type: "p",
          text: "We may update this Privacy Policy from time to time. When we make material changes, we will update the \"Last Updated\" date at the top of this page and, where appropriate, notify you by email or a prominent notice on our website. Your continued use of the Services after changes are posted constitutes your acceptance of the revised policy."
        }
      ]
    },
    {
      id: "contact-us",
      title: "Contact Us",
      blocks: [
        {
          type: "p",
          text: "For privacy inquiries, data requests, or to exercise your rights, contact our Privacy Officer:"
        },
        {
          type: "p",
          text: "**Email:** [privacy@nvc360.com](mailto:privacy@nvc360.com)"
        },
        {
          type: "p",
          text: "**Response Time:** Within 30 days"
        },
        {
          type: "p",
          text: "**Mailing Address:** 10161758 Manitoba Ltd. dba NVC360, Privacy Officer, 423 Main St., 8th Floor, Winnipeg, Manitoba R3B 1B3, Canada"
        }
      ]
    }
  ]
};
