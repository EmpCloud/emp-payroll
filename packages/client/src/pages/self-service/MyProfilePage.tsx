import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { useMyProfile } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SelectField } from "@/components/ui/SelectField";
import { User, Building2, CreditCard, Shield, Loader2, Key, Pencil } from "lucide-react";
import toast from "react-hot-toast";

export function MyProfilePage() {
  const { data: res, isLoading } = useMyProfile();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [bankReqOpen, setBankReqOpen] = useState(false);
  const [bankReqLoading, setBankReqLoading] = useState(false);
  const qc = useQueryClient();
  const { data: bankReqRes } = useQuery({
    queryKey: ["my-bank-requests"],
    queryFn: () => apiGet<any>("/self-service/bank-update-requests"),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const emp = res?.data;
  if (!emp) return <div className="p-8 text-gray-500">Profile not found</div>;

  const bankDetails =
    typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
  const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
  const pfDetails =
    typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" />

      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-6">
            <Avatar name={`${emp.first_name} ${emp.last_name}`} size="lg" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {emp.first_name} {emp.last_name}
              </h2>
              <p className="text-sm text-gray-500">
                {emp.employee_code} &middot; {emp.designation} &middot; {emp.department}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge variant={emp.is_active ? "active" : "inactive"}>
                  {emp.is_active ? "Active" : "Inactive"}
                </Badge>
                <Badge variant={taxInfo.regime === "new" ? "approved" : "pending"}>
                  {taxInfo.regime === "new" ? "New Tax Regime" : "Old Tax Regime"}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" /> Personal Details
          </CardTitle>
        </CardHeader>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Employment
          </CardTitle>
        </CardHeader>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Bank Details
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setBankReqOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Request Update
          </Button>
        </CardHeader>
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
          {/* Show pending requests */}
          {(() => {
            const reqs = bankReqRes?.data?.data || [];
            const pending = reqs.filter((r: any) => r.status === "pending");
            if (pending.length === 0) return null;
            return (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                You have a pending bank update request awaiting admin approval.
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Statutory Details
          </CardTitle>
        </CardHeader>
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

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Password</p>
              <p className="text-xs text-gray-500">Change your account password</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bank Update Request Modal */}
      <Modal
        open={bankReqOpen}
        onClose={() => setBankReqOpen(false)}
        title="Request Bank Details Update"
        className="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBankReqLoading(true);
            const fd = new FormData(e.currentTarget);
            try {
              await apiPost("/self-service/bank-update-request", {
                currentDetails: bankDetails,
                requestedDetails: {
                  bankName: fd.get("bankName") as string,
                  accountNumber: fd.get("accountNumber") as string,
                  ifscCode: fd.get("ifscCode") as string,
                  accountType: fd.get("accountType") as string,
                },
                reason: fd.get("reason") as string,
              });
              toast.success("Bank update request submitted for approval");
              setBankReqOpen(false);
              qc.invalidateQueries({ queryKey: ["my-bank-requests"] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed to submit request");
            } finally {
              setBankReqLoading(false);
            }
          }}
        >
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Your request will be reviewed by HR/Admin before the changes take effect.
          </div>
          <Input
            id="bankName"
            name="bankName"
            label="New Bank Name"
            defaultValue={bankDetails.bankName || ""}
            placeholder="e.g. HDFC Bank"
            required
          />
          <Input
            id="accountNumber"
            name="accountNumber"
            label="New Account Number"
            placeholder="e.g. 1234567890"
            required
          />
          <Input
            id="ifscCode"
            name="ifscCode"
            label="New IFSC Code"
            placeholder="e.g. HDFC0001234"
            required
          />
          <SelectField
            id="accountType"
            name="accountType"
            label="Account Type"
            defaultValue={bankDetails.accountType || "savings"}
            options={[
              { value: "savings", label: "Savings" },
              { value: "current", label: "Current" },
              { value: "salary", label: "Salary Account" },
            ]}
          />
          <Input
            id="reason"
            name="reason"
            label="Reason for Change"
            placeholder="e.g. Switched to new bank"
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setBankReqOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={bankReqLoading}>
              Submit Request
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change Password"
        className="max-w-sm"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const newPw = fd.get("newPassword") as string;
            const confirmPw = fd.get("confirmPassword") as string;
            if (newPw !== confirmPw) {
              toast.error("Passwords don't match");
              return;
            }
            setPwLoading(true);
            try {
              await apiPost("/auth/change-password", {
                currentPassword: fd.get("currentPassword"),
                newPassword: newPw,
              });
              toast.success("Password changed");
              setPwOpen(false);
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed to change password");
            } finally {
              setPwLoading(false);
            }
          }}
          className="space-y-4"
        >
          <Input
            id="currentPassword"
            name="currentPassword"
            label="Current Password"
            type="password"
            required
          />
          <Input
            id="newPassword"
            name="newPassword"
            label="New Password"
            type="password"
            required
          />
          <Input
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm New Password"
            type="password"
            required
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pwLoading}>
              Change Password
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
