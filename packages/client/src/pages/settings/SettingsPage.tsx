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
  const address = org?.registered_address
    ? typeof org.registered_address === "string"
      ? JSON.parse(org.registered_address)
      : org.registered_address
    : {};

  async function handleSave() {
    setSaving(true);
    try {
      const formData: Record<string, any> = {};

      // Collect form field values
      const payFreq = (document.getElementById("pay_frequency") as HTMLSelectElement)?.value;
      const pfEstab = (document.getElementById("pf_estab") as HTMLInputElement)?.value;
      const esiEstab = (document.getElementById("esi_estab") as HTMLInputElement)?.value;
      const pfRestrict = (document.getElementById("pf_restrict") as HTMLSelectElement)?.value;
      const orgState = (document.getElementById("org_state") as HTMLSelectElement)?.value;

      const payDay = (document.getElementById("pay_day") as HTMLInputElement)?.value;

      if (payFreq) formData.payFrequency = payFreq;
      if (payDay) formData.payDay = parseInt(payDay, 10);
      if (pfEstab) formData.pfEstablishmentCode = pfEstab;
      if (esiEstab) formData.esiEstablishmentCode = esiEstab;
      if (orgState) formData.state = orgState;

      await apiPut(`/organizations/${orgId}/settings`, formData);
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
              defaultValue={org?.legal_name || ""}
              disabled
            />
            <Input id="org_pan" label="PAN" defaultValue={org?.pan || ""} disabled />
            <Input id="org_tan" label="TAN" defaultValue={org?.tan || ""} disabled />
            <Input id="org_gstin" label="GSTIN" defaultValue={org?.gstin || ""} />
            <Input
              id="org_address"
              label="Registered Address"
              defaultValue={`${address.line1 || ""}, ${address.city || ""}`}
            />
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
              defaultValue={org?.pf_establishment_code || settings?.pfEstablishmentCode || ""}
            />
            <Input
              id="esi_estab"
              label="ESI Code"
              defaultValue={org?.esi_establishment_code || settings?.esiEstablishmentCode || ""}
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
