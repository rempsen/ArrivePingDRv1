/**
 * Super admins are ArrivePing staff. Emails about their own account (password
 * reset, welcome) must carry ArrivePing's brand even when their user row still
 * points at a customer company — Dan's reset arrived BMD-branded in Nov 2026
 * because his super admin row had company_id "bmd-materials".
 */
import { describe, expect, it } from "bun:test";
import { brandCompanyFor, PLATFORM_COMPANY_ID } from "../email";

describe("brandCompanyFor", () => {
  it("brands super admin account emails as ArrivePing, whatever company the row points at", () => {
    expect(brandCompanyFor({ role: "superadmin", companyId: "bmd-materials" })).toBe(PLATFORM_COMPANY_ID);
    expect(brandCompanyFor({ role: "superadmin", companyId: undefined })).toBe(PLATFORM_COMPANY_ID);
  });

  it("keeps everyone else on their own company's brand", () => {
    expect(brandCompanyFor({ role: "admin", companyId: "bmd-materials" })).toBe("bmd-materials");
    expect(brandCompanyFor({ role: "rider", companyId: "valley-fiber" })).toBe("valley-fiber");
    expect(brandCompanyFor({ companyId: null })).toBeUndefined();
  });

  it("uses ArrivePing's own company record", () => {
    expect(PLATFORM_COMPANY_ID).toBe("default");
  });
});
