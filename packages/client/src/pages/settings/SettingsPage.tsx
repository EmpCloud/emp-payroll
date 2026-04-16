import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { useOrganization, useOrgSettings } from "@/api/hooks";
import { apiPut } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
import { Building2, CreditCard, Shield, Bell, Loader2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

export function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const user = getUser();
  const orgId = user?.orgId ? String(user.orgId) : "";
  const { data: orgRes, isLoading } = useOrganization(orgId);
  const { data: settingsRes } = useOrgSettings(orgId);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const org = orgRes?.data;
  const settings = settingsRes?.data;
  // Server returns camelCase `registeredAddress`; legacy shape used snake_case
  // `registered_address`. Accept either so we don't ship a half-broken UI if
  // the API moves underneath us.
  const rawAddress = org?.registeredAddress ?? org?.registered_address;
  const address =
    rawAddress && typeof rawAddress === "string"
      ? (() => {
          try {
            return JSON.parse(rawAddress);
          } catch {
            // Not JSON — treat as a single line1
            return { line1: rawAddress };
          }
        })()
      : rawAddress || {};

  // #27 — Join only non-empty parts with ", " so the default shown in the
  // Registered Address field never carries stray leading/trailing commas
  // when some segments are missing. Previously we did
  //   `${line1}, ${city}` — which produced e.g. ", Bengaluru" or "HSR, "
  // and that exact string was what got saved back on submit, which is why
  // the extra comma reappeared after refresh.
  const addressDisplay = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.pincode,
    address.country,
  ]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter((p) => p.length > 0)
    .join(", ");

  // #24 — Settings save used to POST everything to
  // `PUT /organizations/:id/settings`, but that endpoint (OrgService.updateSettings)
  // only persists payFrequency / payDay / state / PF / ESI / PT fields and
  // silently discards the rest (name, GSTIN, address, etc.) — so the UI
  // toasted "saved" but nothing changed.
  //
  // Fix: split the payload. Org-identity fields (name, legal, GSTIN, state,
  // registered address) go to `PUT /organizations/:id` (OrgService.update,
  // which writes both EmpCloud and payroll_settings). Pay/statutory fields
  // stay on the settings endpoint.
  async function handleSave() {
    const val = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";

    const orgName = val("org_name").trim();
    const orgGstin = val("org_gstin").trim();
    const orgStateVal = val("org_state");
    const orgAddressStr = val("org_address").trim();
    const pfEstab = val("pf_estab").trim();
    const esiEstab = val("esi_estab").trim();
    const payFreq = val("pay_frequency");
    const payDay = val("pay_day");

    // Parse the comma-separated address back into the JSON shape the API
    // expects. Empty segments are dropped so we don't round-trip a
    // trailing comma (see #27).
    const addressParts = orgAddressStr
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const registeredAddress =
      addressParts.length > 0
        ? {
            line1: addressParts[0] || "",
            line2: addressParts[1] || "",
            city: addressParts[2] || "",
            state: addressParts[3] || "",
            pincode: addressParts[4] || "",
            country: addressParts[5] || "",
          }
        : null;

    const orgPayload: Record<string, any> = {};
    if (orgName) orgPayload.name = orgName;
    if (orgGstin) orgPayload.gstin = orgGstin;
    if (orgStateVal) orgPayload.state = orgStateVal;
    if (pfEstab) orgPayload.pfEstablishmentCode = pfEstab;
    if (esiEstab) orgPayload.esiEstablishmentCode = esiEstab;
    if (registeredAddress) orgPayload.registeredAddress = registeredAddress;

    const settingsPayload: Record<string, any> = {};
    if (payFreq) settingsPayload.payFrequency = payFreq;
    if (payDay) settingsPayload.payDay = parseInt(payDay, 10);
    if (pfEstab) settingsPayload.pfEstablishmentCode = pfEstab;
    if (esiEstab) settingsPayload.esiEstablishmentCode = esiEstab;
    if (orgStateVal) settingsPayload.state = orgStateVal;

    setSaving(true);
    try {
      if (Object.keys(orgPayload).length > 0) {
        await apiPut(`/organizations/${orgId}`, orgPayload);
      }
      if (Object.keys(settingsPayload).length > 0) {
        await apiPut(`/organizations/${orgId}/settings`, settingsPayload);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["organization", orgId] }),
        qc.invalidateQueries({ queryKey: ["org-settings", orgId] }),
      ]);
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization and payroll configuration" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Organization
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input id="org_name" label="Company Name" defaultValue={org?.name || ""} />
            <Input
              id="org_legal"
              label="Legal Name"
              defaultValue={org?.legalName || org?.legal_name || ""}
              disabled
            />
            <Input id="org_pan" label="PAN" defaultValue={org?.pan || ""} disabled />
            <Input id="org_tan" label="TAN" defaultValue={org?.tan || ""} disabled />
            <Input id="org_gstin" label="GSTIN" defaultValue={org?.gstin || ""} />
            <Input id="org_address" label="Registered Address" defaultValue={addressDisplay} />
            <SelectField
              id="org_state"
              label="State (for PT)"
              defaultValue={org?.state || "KA"}
              options={[
                { value: "AP", label: "Andhra Pradesh" },
                { value: "AS", label: "Assam" },
                { value: "BR", label: "Bihar" },
                { value: "CG", label: "Chhattisgarh" },
                { value: "DL", label: "Delhi (No PT)" },
                { value: "GA", label: "Goa" },
                { value: "GJ", label: "Gujarat" },
                { value: "HR", label: "Haryana (No PT)" },
                { value: "HP", label: "Himachal Pradesh (No PT)" },
                { value: "JH", label: "Jharkhand" },
                { value: "JK", label: "Jammu & Kashmir (No PT)" },
                { value: "KA", label: "Karnataka" },
                { value: "KL", label: "Kerala" },
                { value: "MP", label: "Madhya Pradesh" },
                { value: "MH", label: "Maharashtra" },
                { value: "MN", label: "Manipur" },
                { value: "ML", label: "Meghalaya" },
                { value: "OD", label: "Odisha" },
                { value: "PB", label: "Punjab" },
                { value: "RJ", label: "Rajasthan" },
                { value: "SK", label: "Sikkim" },
                { value: "TN", label: "Tamil Nadu" },
                { value: "TS", label: "Telangana" },
                { value: "TR", label: "Tripura" },
                { value: "UP", label: "Uttar Pradesh (No PT)" },
                { value: "UK", label: "Uttarakhand (No PT)" },
                { value: "WB", label: "West Bengal" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Statutory Registration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="pf_estab"
              label="PF Establishment Code"
              defaultValue={
                org?.pfEstablishmentCode ||
                org?.pf_establishment_code ||
                settings?.pfEstablishmentCode ||
                ""
              }
            />
            <Input
              id="esi_estab"
              label="ESI Code"
              defaultValue={
                org?.esiEstablishmentCode ||
                org?.esi_establishment_code ||
                settings?.esiEstablishmentCode ||
                ""
              }
            />
            <SelectField
              id="pf_restrict"
              label="PF Wage Ceiling"
              defaultValue="15000"
              options={[
                { value: "15000", label: "Restricted to ₹15,000" },
                { value: "actual", label: "Actual Basic (no ceiling)" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Payment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              id="pay_frequency"
              label="Pay Frequency"
              defaultValue={settings?.payFrequency || "monthly"}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "bi_weekly", label: "Bi-weekly" },
                { value: "weekly", label: "Weekly" },
              ]}
            />
            <Input
              id="pay_day"
              label="Pay Day (day of month)"
              type="number"
              defaultValue={settings?.payDay?.toString() || "7"}
            />
            <Input id="currency" label="Currency" defaultValue={org?.currency || "INR"} disabled />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                id: "notify_payslip",
                label: "Email payslips to employees after payroll approval",
                checked: true,
              },
              {
                id: "notify_tax",
                label: "Notify employees of tax regime selection deadline",
                checked: true,
              },
              { id: "notify_pf", label: "Alert when PF/ESI filing is due", checked: false },
            ].map((item) => (
              <label key={item.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  defaultChecked={item.checked}
                  className="text-brand-600 focus:ring-brand-500 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{item.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button loading={saving} onClick={handleSave}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
