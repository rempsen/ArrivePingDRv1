import type { LegalDoc } from "./types";

/**
 * ArrivePing Terms & Conditions.
 *
 * Adapted from the NVC360 Inc. terms (nvc360.com/terms-conditions, March 1,
 * 2026) for the ArrivePing product and arriveping.com. NVC360 Inc. remains the
 * contracting legal entity; "ArrivePing" is the platform.
 */
export const terms: LegalDoc = {
  eyebrow: "Legal",
  title: "Terms & Conditions",
  updated: "October 2, 2026",
  path: "/terms",
  intro: [
    "Please read these Terms & Conditions carefully before using ArrivePing or arriveping.com. By accessing or using our services, you agree to be bound by these terms. If you do not agree, do not use our services.",
  ],
  sections: [
    {
      id: "acceptance",
      title: "Acceptance of Terms",
      blocks: [
        {
          type: "p",
          text: "By accessing or using the ArrivePing platform, the ArrivePing mobile app, arriveping.com or any associated services (collectively, the \"Services\"), you agree to be bound by these Terms & Conditions and our [Privacy Policy](/privacy). These Terms constitute a legally binding agreement between you and NVC360 Inc. (\"NVC360\", \"we\", \"us\" or \"our\"), the company that operates ArrivePing.",
        },
        {
          type: "p",
          text: "If you are using the Services on behalf of a company or organization, you represent that you have authority to bind that entity to these Terms.",
        },
      ],
    },
    {
      id: "services",
      title: "Description of Services",
      blocks: [
        {
          type: "p",
          text: "ArrivePing is a cloud-based appointment scheduling, technician arrival tracking and customer communication platform for businesses that send technicians to customers' homes and job sites. The Services include:",
        },
        {
          type: "ul",
          items: [
            "Appointment scheduling and a dispatch board for assigning jobs to technicians.",
            "A mobile app for technicians (iOS and Android) that shares their location with dispatch while travelling to a job.",
            "Automated customer communication by text message and email, including arrival pages with live estimated arrival times.",
            "Reporting and operational dashboards.",
          ],
        },
        {
          type: "p",
          text: "NVC360 reserves the right to modify, suspend or discontinue any aspect of the Services at any time with reasonable notice.",
        },
      ],
    },
    {
      id: "accounts",
      title: "Accounts & Registration",
      blocks: [
        { type: "p", text: "To access certain features of the Services, you must create an account. You agree to:" },
        {
          type: "ul",
          items: [
            "Provide accurate, current and complete information during registration.",
            "Maintain the security of your account credentials.",
            "Notify us immediately of any unauthorized use of your account.",
            "Accept responsibility for all activities that occur under your account, including those of technicians and staff you invite.",
            "Not share your account credentials with unauthorized third parties.",
          ],
        },
        {
          type: "p",
          text: "NVC360 reserves the right to suspend or terminate accounts that violate these Terms or that we believe have been compromised.",
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable Use",
      blocks: [
        { type: "p", text: "You agree not to use the Services to:" },
        {
          type: "ul",
          items: [
            "Violate any applicable law, regulation or third-party rights, including laws governing commercial text messages and email.",
            "Send messages to customers who have not requested your services or have asked you to stop contacting them.",
            "Transmit any material that is unlawful, harmful, threatening, abusive or defamatory.",
            "Interfere with or disrupt the integrity, performance or security of the Services.",
            "Attempt to gain unauthorized access to any part of the Services or its infrastructure.",
            "Use automated means (bots, scrapers) to access the Services without prior written consent.",
            "Reverse engineer, decompile or disassemble any component of the platform.",
            "Use the Services to send unsolicited commercial communications (spam).",
            "Misrepresent your identity or affiliation with any person or organization.",
          ],
        },
        {
          type: "note",
          title: "Violation",
          text: "Violations of this Acceptable Use policy may result in immediate suspension or termination of your account without refund.",
        },
      ],
    },
    {
      id: "billing",
      title: "Payment & Billing",
      blocks: [
        {
          type: "p",
          text: "ArrivePing is a paid subscription, billed per vehicle per month according to the plan you select. By subscribing, you agree to:",
        },
        {
          type: "ul",
          items: [
            "Pay all applicable fees as described in your subscription plan.",
            "Provide accurate billing information and maintain valid payment details.",
            "Authorize NVC360 to charge your payment method on a recurring basis for your subscription.",
            "Understand that fees are non-refundable except as expressly stated in writing by NVC360.",
          ],
        },
        {
          type: "p",
          text: "Early access: before general availability, access may be provided free of charge or at a discounted rate. NVC360 will provide reasonable notice before transitioning early-access users to paid plans.",
        },
        {
          type: "p",
          text: "Price changes: NVC360 reserves the right to change subscription pricing with at least 30 days' notice. Continued use after the effective date constitutes acceptance of the new pricing.",
        },
      ],
    },
    {
      id: "ip",
      title: "Intellectual Property",
      blocks: [
        {
          type: "p",
          text: "The ArrivePing platform, including all software, design, trademarks, logos, content and documentation, is the exclusive property of NVC360 Inc. and protected by Canadian and international intellectual property laws.",
        },
        {
          type: "p",
          text: "License grant: subject to these Terms, NVC360 grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Services for your internal business purposes.",
        },
        {
          type: "p",
          text: "Restrictions: you may not copy, modify, distribute, sell or lease any part of our Services, nor may you reverse engineer or attempt to extract the source code of our software.",
        },
        {
          type: "p",
          text: "Your content: you retain ownership of all data and content you upload to the platform. By uploading content, you grant NVC360 a limited license to use that content solely to provide the Services to you.",
        },
      ],
    },
    {
      id: "your-data",
      title: "Your Data",
      blocks: [
        {
          type: "p",
          text: "NVC360 processes your data in accordance with our [Privacy Policy](/privacy). As a client, you are the data controller for the personal information of your employees, contractors and customers that you process through ArrivePing, including customer contact details and technician location data.",
        },
        {
          type: "p",
          text: "NVC360 acts as a data processor on your behalf and will process such data only in accordance with your instructions and applicable law. You are responsible for having a lawful basis to collect that information and to send your customers appointment and arrival messages through the Services.",
        },
        {
          type: "p",
          text: "Data portability: upon request and upon termination of your account, we will provide you with an export of your data in a portable format within 30 days.",
        },
        {
          type: "p",
          text: "Data deletion: after account termination, your data will be retained for 90 days before permanent deletion, unless we are legally required to retain it longer.",
        },
      ],
    },
    {
      id: "confidentiality",
      title: "Confidentiality",
      blocks: [
        {
          type: "p",
          text: "Each party agrees to keep confidential all non-public information received from the other party that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information. This obligation does not apply to information that:",
        },
        {
          type: "ul",
          items: [
            "Is or becomes publicly available through no breach of this agreement.",
            "Was rightfully in the receiving party's possession before disclosure.",
            "Is independently developed without use of confidential information.",
            "Is required to be disclosed by law or court order.",
          ],
        },
      ],
    },
    {
      id: "liability",
      title: "Limitation of Liability",
      blocks: [
        {
          type: "note",
          title: "Important",
          text: "To the maximum extent permitted by applicable law, NVC360 shall not be liable for any indirect, incidental, special, consequential or punitive damages, including loss of profits, data or business opportunities. Estimated arrival times are estimates only and depend on traffic, device connectivity and technician behaviour; NVC360 is not liable for missed or late appointments.",
        },
        {
          type: "p",
          text: "Our total liability to you for any claims arising out of or related to these Terms or the Services shall not exceed the greater of (a) the amount you paid to NVC360 in the 12 months preceding the claim, or (b) CAD $100.",
        },
        {
          type: "p",
          text: "Some jurisdictions do not allow the exclusion or limitation of certain warranties or liabilities, so some of the above limitations may not apply to you.",
        },
      ],
    },
    {
      id: "warranties",
      title: "Disclaimer of Warranties",
      blocks: [
        {
          type: "p",
          text: "THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT.",
        },
        {
          type: "p",
          text: "NVC360 does not warrant that the Services will be uninterrupted, error-free or completely secure, or that text messages, emails or location updates will be delivered without delay. We make no warranty regarding the accuracy or reliability of any information obtained through the Services.",
        },
      ],
    },
    {
      id: "termination",
      title: "Termination",
      blocks: [
        {
          type: "p",
          text: "By you: you may terminate your account at any time by contacting us at [support@nvc360.com](mailto:support@nvc360.com). Termination does not entitle you to a refund of prepaid fees.",
        },
        {
          type: "p",
          text: "By NVC360: we may suspend or terminate your account immediately if you breach these Terms, fail to pay applicable fees, or if we determine your use poses a security risk. We will provide notice where reasonably practicable.",
        },
        {
          type: "p",
          text: "Effect of termination: upon termination, your right to use the Services ceases. Sections 6, 8, 9, 10 and 12 survive termination.",
        },
      ],
    },
    {
      id: "governing-law",
      title: "Governing Law & Dispute Resolution",
      blocks: [
        {
          type: "p",
          text: "These Terms are governed by the laws of the Province of Manitoba and the federal laws of Canada applicable therein, without regard to conflict of law principles.",
        },
        {
          type: "p",
          text: "Any dispute arising out of or in connection with these Terms shall first be attempted to be resolved through good-faith negotiation between the parties. If unresolved within 30 days, disputes shall be submitted to binding arbitration in Winnipeg, Manitoba, Canada, under the applicable arbitration rules.",
        },
        {
          type: "p",
          text: "Nothing in this section prevents either party from seeking emergency injunctive relief from a court of competent jurisdiction.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to These Terms",
      blocks: [
        {
          type: "p",
          text: "NVC360 reserves the right to modify these Terms at any time. We will provide at least 30 days' notice of material changes via email or a prominent notice on our website. Your continued use of the Services after the effective date of the revised Terms constitutes your acceptance.",
        },
        {
          type: "p",
          text: "We encourage you to review these Terms periodically. The most current version will always be available at arriveping.com/terms.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact Us",
      blocks: [
        {
          type: "p",
          text: "For questions about these Terms & Conditions, email [legal@nvc360.com](mailto:legal@nvc360.com).",
        },
        {
          type: "p",
          text: "Registered address: NVC360 Inc., Winnipeg, Manitoba, Canada.",
        },
      ],
    },
  ],
};
