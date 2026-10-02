import { LegalPage } from "../site/components/LegalPage";
import { privacy } from "../site/legal/privacy";

/** Public Privacy Policy — https://arriveping.com/privacy */
export default function PrivacyPage() {
  return <LegalPage doc={privacy} />;
}
