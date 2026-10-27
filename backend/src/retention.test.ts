import { describe, expect, it } from "vitest";
import { retentionCutoffs } from "./retention.js";

describe("retentionCutoffs", () => {
  it("applique les durées annoncées dans la politique de confidentialité", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const cut = retentionCutoffs(now);
    expect(cut.codes.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(cut.driverLocations.toISOString()).toBe("2026-07-29T12:00:00.000Z");
    expect(cut.rejectedApplications.toISOString()).toBe("2025-10-27T12:00:00.000Z");
  });
});
