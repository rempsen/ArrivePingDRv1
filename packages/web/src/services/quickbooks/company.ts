/**
 * QuickBooks Online company lookup used right after the OAuth handshake,
 * before the integration row is complete (so it takes a raw access token).
 */
export function qboApiBase(): string {
  return process.env.QUICKBOOKS_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export async function quickbooksCompanyName(realmId: string, accessToken: string): Promise<string> {
  if (!realmId) return "";
  try {
    const r = await fetch(`${qboApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!r.ok) return "";
    const j = (await r.json()) as { CompanyInfo?: { CompanyName?: string } };
    return j.CompanyInfo?.CompanyName ?? "";
  } catch {
    return "";
  }
}
