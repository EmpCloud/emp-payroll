import type { PFDetails } from "@emp-payroll/shared";
import { Input } from "./Input";
import { SelectField } from "./SelectField";

export function readPFMembershipFields(form: FormData) {
  const value = (key: string) => String(form.get(key) || "");
  return {
    employerContributionRate: Number(value("employerContributionRate") || 12),
    exclusionReason: value("pfExclusionReason") || null,
    epsExclusionReason: value("epsExclusionReason") || null,
    isEpsMember: value("isEpsMember") === "" ? null : value("isEpsMember") === "true",
    pfMembershipDate: value("pfMembershipDate") || null,
    epsMembershipDate: value("epsMembershipDate") || null,
    membershipWages: value("membershipWages") === "" ? null : Number(value("membershipWages")),
  };
}

export function PFMembershipFields({ details = {} }: { details?: Partial<PFDetails> }) {
  return (
    <>
      <SelectField
        id="employerContributionRate"
        name="employerContributionRate"
        label="Employer PF rate"
        defaultValue={String(details.employerContributionRate ?? 12)}
        options={[
          { value: "12", label: "12% (standard)" },
          { value: "10", label: "10% (notified establishment only)" },
        ]}
      />
      <SelectField
        id="pfExclusionReason"
        name="pfExclusionReason"
        label="PF exclusion reason"
        defaultValue={details.exclusionReason || ""}
        options={[
          { value: "", label: "None / not recorded" },
          { value: "wage_ceiling", label: "Wages above entry ceiling" },
          { value: "exempt", label: "Verified exemption" },
        ]}
      />
      <SelectField
        id="isEpsMember"
        name="isEpsMember"
        label="Recorded EPS membership"
        defaultValue={details.isEpsMember == null ? "" : String(details.isEpsMember)}
        options={[
          { value: "", label: "Use existing membership rules" },
          { value: "true", label: "Recorded EPS member" },
          { value: "false", label: "Recorded EPS exclusion" },
        ]}
      />
      <SelectField
        id="epsExclusionReason"
        name="epsExclusionReason"
        label="EPS exclusion reason"
        defaultValue={details.epsExclusionReason || ""}
        options={[
          { value: "", label: "None / not recorded" },
          { value: "wage_ceiling", label: "Wages above entry ceiling" },
          { value: "ineligible", label: "Other verified ineligibility" },
        ]}
      />
      <Input
        id="pfMembershipDate"
        name="pfMembershipDate"
        label="PF membership start"
        type="date"
        defaultValue={details.pfMembershipDate || ""}
      />
      <Input
        id="epsMembershipDate"
        name="epsMembershipDate"
        label="EPS membership start"
        type="date"
        defaultValue={details.epsMembershipDate || ""}
      />
      <Input
        id="membershipWages"
        name="membershipWages"
        label="Monthly PF wages at eligibility review (₹)"
        type="number"
        min="0"
        step="0.01"
        defaultValue={details.membershipWages ?? ""}
      />
      <p className="col-span-full text-xs text-gray-500">
        For a wage-ceiling exclusion, record monthly statutory wages at the 17 September 2026
        review, or at entry for a later hire. Keep this value when wages rise so membership history
        remains accurate. Previously wage-ceiling-excluded employees whose review wages are above
        ₹15,000 and up to ₹25,000 are covered from 17 September 2026 (or their later joining date),
        even while the earlier exclusion remains recorded. September uses ₹15,000 through 16
        September and ₹25,000 from 17 September.
      </p>
    </>
  );
}
