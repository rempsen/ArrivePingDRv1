import { LegalPage } from "../site/components/LegalPage";
import { terms } from "../site/legal/terms";

/** Public Terms & Conditions — https://arriveping.com/terms */
export default function TermsPage() {
  return <LegalPage doc={terms} />;
}
