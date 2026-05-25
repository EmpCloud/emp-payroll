import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { useOrganization, useOrgSettings } from "@/api/hooks";
import { apiPut, api } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
import { Building2, CreditCard, Shield, Bell, Loader2, Upload, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

export function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const qc = useQueryClient();
  const user = getUser();
  const orgId = user?.orgId ? String(user.orgId) : "";

  // Company logo upload/remove (reflected on every payslip). Uploaded
  // immediately on select rather than via the main Save button so the
  // multipart request stays separate from the JSON settings payload.
  async function uploadLogo(file: File) {
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/uploads/org/logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await qc.invalidateQueries({ queryKey: ["org-settings", orgId] });
      toast.success("Logo updated — it will appear on payslips");
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Logo upload failed");
    } finally {
      setLogoBusy(false);
    }
  }
  async function removeLogo() {
    setLogoBusy(true);
    try {
      await api.delete("/uploads/org/logo");
      await qc.invalidateQueries({ queryKey: ["org-settings", orgId] });
      toast.success("Logo removed");
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to remove logo");
    } finally {
      setLogoBusy(false);
    }
  }
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
  // Uploaded files are served under the API base (e.g. /api/v1/uploads/...), so
  // the logo preview rides the same nginx /api/ proxy as every other request.
  // `logoPath` already starts with "/uploads/...".
  const apiBase = (import.meta.env.VITE_API_URL as string) || "/api/v1";
  const logoSrc = settings?.logoPath ? `${apiBase}${settings.logoPath}` : "";
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
    const orgPan = val("org_pan").trim().toUpperCase();
    const orgTan = val("org_tan").trim().toUpperCase();
    const currency = val("currency").trim().toUpperCase();
    const pfEstab = val("pf_estab").trim();
    const esiEstab = val("esi_estab").trim();
    const payFreq = val("pay_frequency");
    const payDay = val("pay_day");

    // #126 — Don't let the form save with the Company Name blank. It's the
    // only truly-required field; other org identity fields can remain empty
    // during initial onboarding. Previously we silently stripped empty
    // values and toasted "saved" even when nothing actually persisted.
    if (!orgName) {
      toast.error("Company Name is required");
      return;
    }
    // #156 — Registered Address is required for statutory correspondence
    // (PF/ESI/PT filings). Fire this before PAN/TAN format checks so users
    // see the "missing field" error ahead of the "filled but malformed"
    // error when multiple fields are wrong at once.
    if (!orgAddressStr) {
      toast.error("Registered Address is required");
      return;
    }
    // #124 — Basic shape checks for PAN (AAAAA9999A) and TAN (AAAA99999A).
    // Skip when the user hasn't filled them in yet (they're optional for new
    // tenants), but reject malformed values so bad data doesn't land.
    // #194 — short toast; the Input placeholder shows the expected format,
    // and the long format-explanation message felt scolding to users who
    // were trying to type a valid value.
    if (orgPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(orgPan)) {
      toast.error("Not a valid PAN");
      return;
    }
    if (orgTan && !/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(orgTan)) {
      toast.error("Not a valid TAN");
      return;
    }

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
    if (orgPan) orgPayload.pan = orgPan;
    if (orgTan) orgPayload.tan = orgTan;
    if (currency) orgPayload.currency = currency;
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

    // Tier-1 statutory overrides (migration 029). Each field is opt-in:
    // empty string -> null which clears the override and falls back to
    // the India default constant. Numeric fields are coerced; booleans
    // come from the select value "true" / "false" / "" (default).
    const pfWageMode = val("pf_wage_mode"); // "" (default) | "ceiling" | "actual"
    if (pfWageMode === "ceiling") settingsPayload.pfApplyFullBasic = false;
    else if (pfWageMode === "actual") settingsPayload.pfApplyFullBasic = true;
    else if (pfWageMode === "") settingsPayload.pfApplyFullBasic = null;

    const pfMaxRaw = val("pf_max_contribution").trim();
    settingsPayload.pfMaxEmployeeContribution = pfMaxRaw === "" ? null : Number(pfMaxRaw);

    const pfDefaultRateRaw = val("pf_default_rate").trim();
    settingsPayload.pfDefaultEmployeeRate =
      pfDefaultRateRaw === "" ? null : Number(pfDefaultRateRaw);

    const esiCeilingRaw = val("esi_ceiling").trim();
    settingsPayload.esiWageCeiling = esiCeilingRaw === "" ? null : Number(esiCeilingRaw);

    const roundingRaw = val("rounding_policy");
    settingsPayload.roundingPolicy = roundingRaw === "" ? null : roundingRaw;

    // Migration 032 — Employer PF / ESI included in CTC. Boolean checkbox.
    const employerPfInCtcEl = document.getElementById(
      "employer_pf_in_ctc",
    ) as HTMLInputElement | null;
    settingsPayload.employerPfInCtc = !!employerPfInCtcEl?.checked;

    // Migration 034 — EDLI / PF Admin employer-charge toggles. Both default
    // ON; unchecking either zeroes that charge in the payroll engine and
    // the Salary Revision preview.
    const pfEdliEl = document.getElementById("pf_edli_enabled") as HTMLInputElement | null;
    const pfAdminEl = document.getElementById("pf_admin_enabled") as HTMLInputElement | null;
    settingsPayload.pfEdliEnabled = !!pfEdliEl?.checked;
    settingsPayload.pfAdminEnabled = !!pfAdminEl?.checked;

    // Migration 035 — working-days basis. "all_days" counts weekends as
    // working days in the payroll run; "weekdays" (default) keeps Mon–Fri.
    settingsPayload.includeWeekendsInWorkingDays = val("working_days_basis") === "all_days";

    // Migration 036 — disable Professional Tax org-wide. Checkbox; when on,
    // PT is skipped for every employee regardless of their per-employee flag.
    const ptDisabledEl = document.getElementById("pt_disabled") as HTMLInputElement | null;
    settingsPayload.ptDisabled = !!ptDisabledEl?.checked;

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
            <Input
              id="org_pan"
              label="PAN"
              defaultValue={org?.pan || ""}
              placeholder="ABCDE1234F"
              maxLength={10}
              style={{ textTransform: "uppercase" }}
            />
            <Input
              id="org_tan"
              label="TAN"
              defaultValue={org?.tan || ""}
              placeholder="ABCD12345E"
              maxLength={10}
              style={{ textTransform: "uppercase" }}
            />
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

          {/* Company logo — reflected on every payslip for this org */}
          <div className="mt-6 border-t border-gray-100 pt-5">
            <p className="mb-1 text-sm font-medium text-gray-700">Company Logo</p>
            <p className="mb-3 text-xs text-gray-500">
              Shown at the top of every payslip for this organization. PNG, JPG, or SVG up to 4MB.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt="Company logo"
                    className="max-h-14 max-w-[150px] object-contain"
                  />
                ) : (
                  <span className="text-xs text-gray-400">No logo</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  {logoBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {logoSrc ? "Replace logo" : "Upload logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                    className="hidden"
                    disabled={logoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                {logoSrc && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={logoBusy}
                    onClick={removeLogo}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
            </div>
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
          </div>
        </CardContent>
      </Card>

      {/* key on settings-loaded so the card's defaultChecked / useState
          initialisers re-run once the async settings actually arrive —
          otherwise a default-ON toggle can paint OFF on first mount. */}
      <StatutoryOverridesCard key={settings ? "loaded" : "loading"} settings={settings} />

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
            <SelectField
              id="currency"
              label="Currency"
              defaultValue={org?.currency || "INR"}
              options={[
                { value: "INR", label: "INR — Indian Rupee" },
                { value: "USD", label: "USD — US Dollar" },
                { value: "EUR", label: "EUR — Euro" },
                { value: "GBP", label: "GBP — British Pound" },
                { value: "AED", label: "AED — UAE Dirham" },
                { value: "SGD", label: "SGD — Singapore Dollar" },
              ]}
            />
            {/* Migration 035 — controls the working-days denominator the
                payroll run pro-rates against. "All calendar days" suits
                orgs that operate on weekends (retail, manufacturing). */}
            <div>
              <SelectField
                id="working_days_basis"
                label="Working Days Basis"
                defaultValue={settings?.includeWeekendsInWorkingDays ? "all_days" : "weekdays"}
                options={[
                  { value: "weekdays", label: "Weekdays only (Mon–Fri)" },
                  { value: "all_days", label: "Include weekends (all calendar days)" },
                ]}
              />
              <p className="mt-1 text-xs text-gray-500">
                Sets the Total Working Days each payroll run divides present / paid days by. With
                "Include weekends", Sat/Sun count as paid rest days — they're never treated as Loss
                of Pay. Holidays are subtracted either way.
              </p>
            </div>
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

// ===========================================================================
// Statutory Overrides card — preset-based PF picker that hides the three
// interacting knobs (wage basis / rate / cap) behind one decision most HR
// teams actually make:
//
//   1. "Statutory minimum"  : ceiling ₹15K, 12%, cap ₹1,800
//      (the law-minimum every Indian employer can default to)
//   2. "On Full Basic"      : actual basic, 12%, no cap
//      (typical Indian IT — PF deducted on the full basic, no ceiling)
//   3. "Custom"             : exposes all three inputs explicitly
//
// Plus the new ESI ceiling, payslip rounding, and the migration-032
// "Employer PF inside CTC" toggle. The hidden inputs (pf_wage_mode /
// pf_default_rate / pf_max_contribution / employer_pf_in_ctc / etc.)
// keep their original IDs so the existing handleSave (which reads via
// document.getElementById) doesn't need to know about presets.
// ===========================================================================

type PfPreset = "statutory" | "full_basic" | "custom";

function presetFor(settings: any): PfPreset {
  // Recognise the two named presets; everything else is "custom" so HR
  // can edit the raw fields. NULL fields collapse to statutory because
  // that's what the engine defaults to.
  const basis = settings?.pfApplyFullBasic;
  const rate = settings?.pfDefaultEmployeeRate;
  const cap = settings?.pfMaxEmployeeContribution;
  const isStatutory =
    (basis === false || basis == null) &&
    (rate === 12 || rate == null) &&
    (cap === 1800 || cap == null);
  if (isStatutory) return "statutory";
  const isFullBasic = basis === true && (rate === 12 || rate == null) && cap == null;
  if (isFullBasic) return "full_basic";
  return "custom";
}

function StatutoryOverridesCard({ settings }: { settings: any }) {
  const initialPreset = presetFor(settings);
  const [preset, setPreset] = useState<PfPreset>(initialPreset);
  // The three knobs as React state. When a preset is picked, we set the
  // values to match that preset; in "custom" we let HR type freely. The
  // inputs are still rendered with their original IDs so handleSave can
  // read them via document.getElementById -- only the visual presentation
  // changes.
  const [wageMode, setWageMode] = useState<"" | "ceiling" | "actual">(
    settings?.pfApplyFullBasic === true
      ? "actual"
      : settings?.pfApplyFullBasic === false
        ? "ceiling"
        : "",
  );
  const [defaultRate, setDefaultRate] = useState(
    settings?.pfDefaultEmployeeRate != null ? String(settings.pfDefaultEmployeeRate) : "",
  );
  const [maxCap, setMaxCap] = useState(
    settings?.pfMaxEmployeeContribution != null ? String(settings.pfMaxEmployeeContribution) : "",
  );

  function applyPreset(p: PfPreset) {
    setPreset(p);
    if (p === "statutory") {
      setWageMode("ceiling");
      setDefaultRate("12");
      setMaxCap("1800");
    } else if (p === "full_basic") {
      setWageMode("actual");
      setDefaultRate("12");
      setMaxCap("");
    }
    // "custom" keeps whatever is in state -- HR edits each field directly.
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" /> Statutory Overrides
        </CardTitle>
        <p className="text-sm text-gray-500">
          Pick how PF should be calculated for your organization. Most companies use one of the two
          named presets — open <strong>Custom</strong> only if you need to tune the rate or rupee
          cap independently.
        </p>
      </CardHeader>
      <CardContent>
        {/* PF preset picker */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">PF Calculation Method</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                {
                  key: "statutory",
                  title: "Statutory minimum",
                  body: "12% × min(Basic+DA, ₹15,000) — caps at ₹1,800/month. Law-minimum default.",
                },
                {
                  key: "full_basic",
                  title: "On Full Basic",
                  body: "12% × actual Basic+DA, no ₹15K ceiling, no cap. Typical Indian IT employers.",
                },
                {
                  key: "custom",
                  title: "Custom",
                  body: "Tune rate, wage basis and rupee cap independently below.",
                },
              ] as Array<{ key: PfPreset; title: string; body: string }>
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => applyPreset(opt.key)}
                className={`rounded-lg border p-3 text-left transition ${
                  preset === opt.key
                    ? "border-brand-500 ring-brand-200 bg-brand-50 ring-2"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <p className="text-sm font-semibold text-gray-900">{opt.title}</p>
                <p className="mt-1 text-xs text-gray-500">{opt.body}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Custom inputs — visible always so handleSave can read them, but
            visually subdued unless Custom preset is selected. */}
        <div
          className={`mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3 ${
            preset === "custom" ? "" : "opacity-60"
          }`}
        >
          <div>
            <SelectField
              id="pf_wage_mode"
              label="Wage Basis"
              value={wageMode}
              onChange={(e: any) => {
                setWageMode(e.target.value);
                if (preset !== "custom") setPreset("custom");
              }}
              options={[
                { value: "", label: "Use default (₹15,000 ceiling)" },
                { value: "ceiling", label: "Restrict to ₹15,000 ceiling" },
                { value: "actual", label: "Apply to actual Basic + DA" },
              ]}
            />
          </div>
          <div>
            <Input
              id="pf_default_rate"
              label="Rate (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="12"
              value={defaultRate}
              onChange={(e) => {
                setDefaultRate(e.target.value);
                if (preset !== "custom") setPreset("custom");
              }}
            />
          </div>
          <div>
            <Input
              id="pf_max_contribution"
              label="Max Cap (₹/month)"
              type="number"
              step="1"
              min="0"
              placeholder="1800 — blank = no cap"
              value={maxCap}
              onChange={(e) => {
                setMaxCap(e.target.value);
                if (preset !== "custom") setPreset("custom");
              }}
            />
          </div>
        </div>

        {/* Employer-PF-in-CTC toggle (migration 032) — separate decision
            from the PF rate / basis math. This affects how the offer-letter
            CTC is interpreted, not how PF is computed. */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <label className="flex items-start gap-3">
            <input
              id="employer_pf_in_ctc"
              type="checkbox"
              defaultChecked={!!settings?.employerPfInCtc}
              className="text-brand-600 focus:ring-brand-500 mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Employer PF / ESI is included in CTC
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Tick this if your offer letter's CTC ALREADY bundles the employer's PF, ESI, EDLI
                and admin contributions. The Total Cost to Company on each payslip will then equal
                the gross (no extra "+₹X employer cost on top"). Leave unticked if your offers say
                "CTC + Employer Cost" separately.
              </p>
            </div>
          </label>
        </div>

        {/* Employer EDLI / PF Admin charge toggles (migration 034) — each
            defaults ON. Unticking either zeroes that charge in both the
            payroll engine and the Salary Revision preview. defaultChecked
            uses `!== false` so a not-yet-loaded `settings` paints ON (the
            engine default); the parent also remounts this card via `key`
            once settings arrive. */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">Employer EPF Charges</p>
          <p className="mt-1 text-xs text-gray-500">
            EDLI and PF Admin are employer-side charges added on top of EPF. Untick to exclude them
            for organisations that don't pay them (e.g. exempted / trust-managed PF setups).
          </p>
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-3">
              <input
                id="pf_edli_enabled"
                type="checkbox"
                defaultChecked={settings?.pfEdliEnabled !== false}
                className="text-brand-600 focus:ring-brand-500 mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Include EDLI charges (0.5%)</p>
                <p className="mt-1 text-xs text-gray-500">
                  Employees' Deposit Linked Insurance — 0.5% of PF wages, paid by the employer.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3">
              <input
                id="pf_admin_enabled"
                type="checkbox"
                defaultChecked={settings?.pfAdminEnabled !== false}
                className="text-brand-600 focus:ring-brand-500 mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Include PF Admin charges (0.5%)</p>
                <p className="mt-1 text-xs text-gray-500">
                  EPFO administrative charges — 0.5% of PF wages, paid by the employer.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Professional Tax org-wide toggle (migration 036). */}
        <div className="mt-6 border-t border-gray-100 pt-6">
          <label className="flex items-start gap-3">
            <input
              id="pt_disabled"
              type="checkbox"
              defaultChecked={!!settings?.ptDisabled}
              className="text-brand-600 focus:ring-brand-500 mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Disable Professional Tax for all employees
              </p>
              <p className="mt-1 text-xs text-gray-500">
                When on, no Professional Tax is deducted for ANY employee in this organisation,
                regardless of per-employee settings. Use this for states with no PT (e.g. Delhi,
                Haryana) or if your org doesn't withhold PT. Off (default) keeps PT computing per
                the state slab.
              </p>
            </div>
          </label>
        </div>

        {/* ESI ceiling + rounding policy — independent settings. */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              id="esi_ceiling"
              label="ESI Wage Ceiling (₹/month)"
              type="number"
              step="1"
              min="0"
              placeholder="21000 — blank = use ₹21,000 default"
              defaultValue={settings?.esiWageCeiling != null ? String(settings.esiWageCeiling) : ""}
            />
            <p className="mt-1 text-xs text-gray-500">
              Employees with monthly gross above this ceiling are NOT eligible for ESI. Statutory:
              ₹21,000.
            </p>
          </div>
          <div>
            <SelectField
              id="rounding_policy"
              label="Payslip Rounding"
              defaultValue={settings?.roundingPolicy || ""}
              options={[
                { value: "", label: "Use default (no rounding)" },
                { value: "nearest_1", label: "Round to nearest ₹1" },
                { value: "nearest_10", label: "Round to nearest ₹10" },
                { value: "nearest_100", label: "Round to nearest ₹100" },
              ]}
            />
            <p className="mt-1 text-xs text-gray-500">
              Applied to the gross + total deductions on each payslip; per-component line items stay
              at exact paise precision so the math still adds up.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
