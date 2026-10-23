import { describe, expect, it } from "vitest";
import { pfDetailsSchema, updatePfDetailsSchema } from "./index";

describe("PF membership input", () => {
  it("preserves membership history and existing profile metadata", () => {
    const details = {
      pfMembershipDate: "2026-09-17",
      epsMembershipDate: "2026-09-17",
      exclusionReason: "wage_ceiling",
      isEpsMember: false,
      membershipWages: 20000,
      contributionRate: 10,
      legacyReference: "existing-record",
    };
    expect(updatePfDetailsSchema.parse({ params: { id: "12" }, body: details }).body).toEqual(
      details,
    );
  });

  it.each(["2026-02-30", "2026-09-31", "17-09-2026", "2026-09-17T00:00:00Z"])(
    "rejects invalid membership date %s",
    (date) => {
      expect(pfDetailsSchema.safeParse({ pfMembershipDate: date }).success).toBe(false);
      expect(pfDetailsSchema.safeParse({ epsMembershipDate: date }).success).toBe(false);
    },
  );

  it.each([
    { contributionRate: -1 },
    { contributionRate: 101 },
    { employerContributionRate: Infinity },
    { vpfRate: -1 },
    { membershipWages: -1 },
    { membershipWages: "20000" },
    { exclusionReason: "other" },
    { isEpsMember: "false" },
    { epsExclusionReason: "exempt" },
  ])("rejects invalid PF values %j", (details) => {
    expect(pfDetailsSchema.safeParse(details).success).toBe(false);
  });

  it("allows optional membership values to be cleared without replacing the profile", () => {
    expect(
      pfDetailsSchema.safeParse({
        pfMembershipDate: null,
        epsMembershipDate: null,
        membershipWages: null,
        exclusionReason: null,
        epsExclusionReason: null,
        isEpsMember: null,
      }).success,
    ).toBe(true);
  });
});
