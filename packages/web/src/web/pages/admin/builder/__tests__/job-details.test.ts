import { describe, expect, it } from "bun:test";
import { duplicatesJobDetail } from "../../../../components/forms/job-details-strip";

describe("questions that repeat a built-in job detail", () => {
  it("are spotted", () => {
    expect(duplicatesJobDetail("Client name")).toBe("the client's name");
    expect(duplicatesJobDetail("Customer")).toBe("the client's name");
    expect(duplicatesJobDetail("Site address")).toBe("the address");
    expect(duplicatesJobDetail("Phone number")).toBe("the client's phone number");
    expect(duplicatesJobDetail("Appointment date")).toBe("the date and time");
    expect(duplicatesJobDetail("Date")).toBe("the date and time");
  });
  it("leave real questions alone", () => {
    for (const l of ["Customer signature", "Customer present?", "Customer's concern", "Install date", "Model number", "Photo field", "Text field"]) {
      expect(duplicatesJobDetail(l)).toBeNull();
    }
  });
});
