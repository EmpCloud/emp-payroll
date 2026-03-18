import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { useMyProfile } from "@/api/hooks";
import { User, Building2, CreditCard, Shield, Loader2 } from "lucide-react";

export function MyProfilePage() {
  const { data: res, isLoading } = useMyProfile();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const emp = res?.data;
  if (!emp) return <div className="p-8 text-gray-500">Profile not found</div>;

  const bankDetails = typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
  const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
  const pfDetails = typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" />

      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-6">
            <Avatar name={`${emp.first_name} ${emp.last_name}`} size="lg" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">{emp.first_name} {emp.last_name}</h2>
              <p className="text-sm text-gray-500">{emp.employee_code} &middot; {emp.designation} &middot; {emp.department}</p>
              <div className="mt-2 flex gap-2">
                <Badge variant={emp.is_active ? "active" : "inactive"}>{emp.is_active ? "Active" : "Inactive"}</Badge>
                <Badge variant={taxInfo.regime === "new" ? "approved" : "pending"}>
                  {taxInfo.regime === "new" ? "New Tax Regime" : "Old Tax Regime"}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Personal Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Email", emp.email],
              ["Phone", emp.phone || "—"],
              ["Date of Birth", emp.date_of_birth ? formatDate(emp.date_of_birth) : "—"],
              ["Gender", emp.gender],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium capitalize text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Employment</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Employee Code", emp.employee_code],
              ["Department", emp.department],
              ["Designation", emp.designation],
              ["Employment Type", (emp.employment_type || "full_time").replace("_", " ")],
              ["Date of Joining", formatDate(emp.date_of_joining)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium capitalize text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Bank Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Bank", bankDetails.bankName || "—"],
              ["Account Number", bankDetails.accountNumber || "—"],
              ["IFSC", bankDetails.ifscCode || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Statutory Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["PAN", taxInfo.pan || "—"],
              ["UAN", taxInfo.uan || "—"],
              ["PF Number", pfDetails.pfNumber || "N/A"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
