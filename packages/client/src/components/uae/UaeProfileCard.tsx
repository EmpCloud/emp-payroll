import { useState } from "react";
import type { UaeEmployeeProfile } from "@emp-payroll/shared";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { apiPut } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { assertUaeProfile, filsToAed, uaeRequestError } from "@/lib/uae-payroll";
import { newUaeProfile, UAE_JURISDICTIONS, UaeProfileForm } from "./UaeProfileForm";
import { UaeEmployeeLink } from "./UaeEmployeeLink";

export function UaeProfileCard({
  employee,
}: {
  employee: {
    id: string;
    start_date: string;
    empcloud_user_id?: number | null;
    uae_profile?: UaeEmployeeProfile | null;
    uae_profile_history?: UaeEmployeeProfile[];
  };
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<UaeEmployeeProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkedUserId, setLinkedUserId] = useState<number | null>(
    employee.empcloud_user_id ? Number(employee.empcloud_user_id) : null,
  );
  const profile = employee.uae_profile;
  const save = async () => {
    if (!draft) return;
    try {
      assertUaeProfile(draft);
      setSaving(true);
      await apiPut(`/global/employees/${employee.id}`, {
        uaeProfile: draft,
        salaryAmount:
          draft.basicSalary + draft.allowances.reduce((sum, line) => sum + line.amount, 0),
        salaryFrequency: "monthly",
        salaryCurrency: "AED",
        empcloudUserId: linkedUserId,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["global-employee", employee.id] }),
        qc.invalidateQueries({ queryKey: ["global-employees"] }),
        qc.invalidateQueries({ queryKey: ["global-employees-for-runs"] }),
      ]);
      setDraft(null);
      toast.success("UAE payroll profile saved");
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">UAE payroll profile</h3>
          <Button
            variant="outline"
            onClick={() => {
              setLinkedUserId(employee.empcloud_user_id ? Number(employee.empcloud_user_id) : null);
              setDraft(
                profile
                  ? structuredClone(profile)
                  : newUaeProfile(employee.start_date?.slice(0, 10)),
              );
            }}
          >
            {profile ? "Edit UAE profile" : "Configure UAE payroll"}
          </Button>
        </div>
        {profile ? (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {[
              [
                "Jurisdiction",
                UAE_JURISDICTIONS.find((item) => item.value === profile.jurisdiction)?.label,
              ],
              ["Effective from", profile.effectiveFrom],
              ["Nationality", profile.nationality],
              ["Monthly basic", `AED ${filsToAed(profile.basicSalary)}`],
              [
                "Monthly allowances",
                `AED ${filsToAed(profile.allowances.reduce((sum, row) => sum + row.amount, 0))}`,
              ],
              ["Pension scheme", profile.pension?.scheme?.replaceAll("_", " ") || "None"],
              [
                "Registered pension salary",
                profile.pension?.contributionSalary == null
                  ? "Not registered"
                  : `AED ${filsToAed(profile.pension.contributionSalary)} (${profile.pension.salaryYear || "year missing"})`,
              ],
              ["ILOE", profile.iloe.mode.replaceAll("_", " ")],
              ["Savings scheme", profile.savings.scheme.replaceAll("_", " ")],
              ["Employer health insurance", `AED ${filsToAed(profile.healthInsuranceEmployer)}`],
              [
                "WPS employee ID",
                profile.wps.employeeId ||
                  (profile.wps.exemption ? "Documented exemption" : "Not configured"),
              ],
              [
                "WPS account",
                profile.wps.accountNumber
                  ? `••••${profile.wps.accountNumber.slice(-4)}`
                  : "Not configured",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-medium capitalize">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            Needs configuration. Add jurisdiction, salary, pension and benefit details before
            running UAE payroll.
          </p>
        )}
        {!!employee.uae_profile_history?.length && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Profile history ({employee.uae_profile_history.length})
            </summary>
            <ul className="mt-2 space-y-2 text-sm">
              {employee.uae_profile_history.map((version, index) => (
                <li key={`${version.effectiveFrom}-${index}`}>
                  {version.effectiveFrom} · {version.jurisdiction.toUpperCase()} · Basic AED{" "}
                  {filsToAed(version.basicSalary)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Modal
          open={!!draft}
          onClose={() => !saving && setDraft(null)}
          title="UAE payroll profile"
          className="max-w-3xl"
        >
          {draft && (
            <div className="space-y-4">
              <UaeEmployeeLink value={linkedUserId} onChange={setLinkedUserId} />
              <UaeProfileForm value={draft} onChange={setDraft} />
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </Modal>
      </CardContent>
    </Card>
  );
}
