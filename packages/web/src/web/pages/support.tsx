import { LegalPage } from "../site/components/LegalPage";
import { support } from "../site/legal/support";

/** Public Help & Support page — https://arriveping.com/support (the App Store support URL). */
export default function SupportPage() {
  return <LegalPage doc={support} />;
}
