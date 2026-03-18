import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { useOrganization, useOrgSettings } from "@/api/hooks";
import { apiPut } from "@/api/client";
import { getUser } from "@/api/auth";
import { Building2, CreditCard, Shield, Bell, Loader2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

export function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const user = getUser();
  const orgId = user?.orgId || "";
  const { data: orgRes, isLoading } = useOrganization(orgId);
  const { data: settingsRes } = useOrgSettings(orgId);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const org = orgRes?.data;
  const settings = settingsRes?.data;
  const address = org?.registered_address
    ? (typeof org.registered_address === "string" ? JSON.parse(org.registered_address) : org.registered_address)
    : {};

  async function handleSave() {
    setSaving(true);
    try {
      // In a full implementation this would collect form data and PUT to the API
      await apiPut(`/organizations/${orgId}/settings`, {
        payFrequency: settings?.payFrequency || "monthly",
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization and payroll configuration" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input id="org_name" label="Company Name" defaultValue={org?.name || ""} />
            <Input id="org_legal" label="Legal Name" defaultValue={org?.legal_name || ""} disabled />
            <Input id="org_pan" label="PAN" defaultValue={org?.pan || ""} disabled />
            <Input id="org_tan" label="TAN" defaultValue={org?.tan || ""} disabled />
            <Input id="org_gstin" label="GSTIN" defaultValue={org?.gstin || ""} />
            <Input id="org_address" label="Registered Address" defaultValue={`${address.line1 || ""}, ${address.city || ""}`} />
            <SelectField
              id="org_state"
              label="State (for PT)"
              defaultValue={org?.state || "KA"}
              options={[
                { value: "KA", label: "Karnataka" },
                { value: "MH", label: "Maharashtra" },
                { value: "TN", label: "Tamil Nadu" },
                { value: "TS", label: "Telangana" },
                { value: "WB", label: "West Bengal" },
                { value: "GJ", label: "Gujarat" },
                { value: "DL", label: "Delhi" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Statutory Registration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input id="pf_estab" label="PF Establishment Code" defaultValue={org?.pf_establishment_code || settings?.pfEstablishmentCode || ""} />
            <Input id="esi_estab" label="ESI Code" defaultValue={org?.esi_establishment_code || settings?.esiEstablishmentCode || ""} />
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
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Payment</CardTitle>
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
            <Input id="pay_day" label="Pay Day" type="number" defaultValue="7" />
            <Input id="currency" label="Currency" defaultValue={org?.currency || "INR"} disabled />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { id: "notify_payslip", label: "Email payslips to employees after payroll approval", checked: true },
              { id: "notify_tax", label: "Notify employees of tax regime selection deadline", checked: true },
              { id: "notify_pf", label: "Alert when PF/ESI filing is due", checked: false },
            ].map((item) => (
              <label key={item.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  defaultChecked={item.checked}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-gray-700">{item.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button loading={saving} onClick={handleSave}>Save Settings</Button>
      </div>
    </div>
  );
}
