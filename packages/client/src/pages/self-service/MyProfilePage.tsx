import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useMyProfile } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SelectField } from "@/components/ui/SelectField";
import { User, Building2, CreditCard, Shield, Loader2, Key, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function MyProfilePage() {
  const { t, i18n } = useTranslation();
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
  if (!emp) return <div className="p-8 text-gray-500">{t("myProfile.notFound")}</div>;

  const bankDetails =
    typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
  const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
  const pfDetails =
    typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};
  const formatProfileDate = (date: string | Date) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || "en", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(date));
  const genderKey = String(emp.gender || "other")
    .toLowerCase()
    .replace(/[ -]/g, "_");
  const employmentTypeKey = String(emp.employment_type || "").toLowerCase();

  return (
    <div className="space-y-6">
      <PageHeader title={t("myProfile.title")} />

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
                  {emp.is_active ? t("myProfile.status.active") : t("myProfile.status.inactive")}
                </Badge>
                <Badge variant={taxInfo.regime === "new" ? "approved" : "pending"}>
                  {taxInfo.regime === "new"
                    ? t("myProfile.taxRegime.new")
                    : t("myProfile.taxRegime.old")}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" /> {t("myProfile.sections.personalDetails")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t("myProfile.fields.email"), emp.email],
              [t("myProfile.fields.phone"), emp.phone || "—"],
              [
                t("myProfile.fields.dateOfBirth"),
                emp.date_of_birth ? formatProfileDate(emp.date_of_birth) : "—",
              ],
              [
                t("myProfile.fields.gender"),
                emp.gender
                  ? t(`myProfile.values.gender.${genderKey}`, { defaultValue: emp.gender })
                  : "—",
              ],
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
            <Building2 className="h-5 w-5" /> {t("myProfile.sections.employment")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t("myProfile.fields.employeeCode"), emp.employee_code],
              [t("myProfile.fields.department"), emp.department],
              [t("myProfile.fields.designation"), emp.designation],
              [
                t("myProfile.fields.employmentType"),
                emp.employment_type
                  ? t(`myProfile.values.employmentTypes.${employmentTypeKey}`, {
                      defaultValue: emp.employment_type.replace("_", " "),
                    })
                  : "",
              ],
              [
                t("myProfile.fields.dateOfJoining"),
                emp.date_of_joining ? formatProfileDate(emp.date_of_joining) : "",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-500">{label}</dt>
                {/* Show an em-dash for missing values so the field reads as
                    "not set" instead of silently rendering blank or, worse,
                    a default like "HR" the user never entered (#250). */}
                <dd className="mt-1 text-sm font-medium capitalize text-gray-900">
                  {value || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> {t("myProfile.sections.bankDetails")}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setBankReqOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> {t("myProfile.requestUpdate")}
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t("myProfile.fields.bank"), bankDetails.bankName || "—"],
              [t("myProfile.fields.accountNumber"), bankDetails.accountNumber || "—"],
              [t("myProfile.fields.ifsc"), bankDetails.ifscCode || "—"],
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
                {t("myProfile.pendingBankRequest")}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> {t("myProfile.sections.statutoryDetails")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t("myProfile.fields.pan"), taxInfo.pan || "—"],
              [t("myProfile.fields.uan"), taxInfo.uan || "—"],
              [t("myProfile.fields.pfNumber"), pfDetails.pfNumber || t("myProfile.notAvailable")],
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
            <Key className="h-5 w-5" /> {t("myProfile.sections.security")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{t("myProfile.fields.password")}</p>
              <p className="text-xs text-gray-500">{t("myProfile.security.changePasswordHelp")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
              {t("myProfile.security.changePassword")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bank Update Request Modal */}
      <Modal
        open={bankReqOpen}
        onClose={() => setBankReqOpen(false)}
        title={t("myProfile.bankModal.title")}
        className="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            // #354 — IFSC: 11 chars, 4 letters + "0" + 6 alphanumeric, all caps.
            const ifscRaw = (fd.get("ifscCode") as string) || "";
            const ifscCode = ifscRaw.toUpperCase().trim();
            if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
              toast.error(t("myProfile.bankModal.ifscValidation"));
              return;
            }
            setBankReqLoading(true);
            try {
              await apiPost("/self-service/bank-update-request", {
                currentDetails: bankDetails,
                requestedDetails: {
                  bankName: fd.get("bankName") as string,
                  accountNumber: fd.get("accountNumber") as string,
                  ifscCode,
                  accountType: fd.get("accountType") as string,
                },
                reason: fd.get("reason") as string,
              });
              toast.success(t("myProfile.bankModal.success"));
              setBankReqOpen(false);
              qc.invalidateQueries({ queryKey: ["my-bank-requests"] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || t("myProfile.bankModal.failure"));
            } finally {
              setBankReqLoading(false);
            }
          }}
        >
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {t("myProfile.bankModal.reviewNotice")}
          </div>
          <Input
            id="bankName"
            name="bankName"
            label={t("myProfile.bankModal.newBankName")}
            defaultValue={bankDetails.bankName || ""}
            placeholder={t("myProfile.bankModal.bankPlaceholder")}
            required
          />
          <Input
            id="accountNumber"
            name="accountNumber"
            label={t("myProfile.bankModal.newAccountNumber")}
            placeholder={t("myProfile.bankModal.accountPlaceholder")}
            required
          />
          <Input
            id="ifscCode"
            name="ifscCode"
            label={t("myProfile.bankModal.newIfscCode")}
            placeholder={t("myProfile.bankModal.ifscPlaceholder")}
            // #354 — Enforce IFSC format on the input itself: 11 chars,
            // 4 letters + "0" + 6 letters/digits, all caps.
            pattern="^[A-Z]{4}0[A-Z0-9]{6}$"
            maxLength={11}
            minLength={11}
            title={t("myProfile.bankModal.ifscValidation")}
            onChange={(e) => {
              e.currentTarget.value = e.currentTarget.value.toUpperCase();
            }}
            required
          />
          <SelectField
            id="accountType"
            name="accountType"
            label={t("myProfile.bankModal.accountType")}
            defaultValue={bankDetails.accountType || "savings"}
            options={[
              { value: "savings", label: t("myProfile.bankModal.accountTypes.savings") },
              { value: "current", label: t("myProfile.bankModal.accountTypes.current") },
              { value: "salary", label: t("myProfile.bankModal.accountTypes.salary") },
            ]}
          />
          <Input
            id="reason"
            name="reason"
            label={t("myProfile.bankModal.reason")}
            placeholder={t("myProfile.bankModal.reasonPlaceholder")}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setBankReqOpen(false)}>
              {t("myProfile.cancel")}
            </Button>
            <Button type="submit" loading={bankReqLoading}>
              {t("myProfile.bankModal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={t("myProfile.passwordModal.title")}
        className="max-w-sm"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const newPw = fd.get("newPassword") as string;
            const confirmPw = fd.get("confirmPassword") as string;
            if (newPw !== confirmPw) {
              toast.error(t("myProfile.passwordModal.mismatch"));
              return;
            }
            setPwLoading(true);
            try {
              await apiPost("/auth/change-password", {
                currentPassword: fd.get("currentPassword"),
                newPassword: newPw,
              });
              toast.success(t("myProfile.passwordModal.success"));
              setPwOpen(false);
            } catch (err: any) {
              toast.error(
                err.response?.data?.error?.message || t("myProfile.passwordModal.failure"),
              );
            } finally {
              setPwLoading(false);
            }
          }}
          className="space-y-4"
        >
          <Input
            id="currentPassword"
            name="currentPassword"
            label={t("myProfile.passwordModal.currentPassword")}
            type="password"
            required
          />
          <Input
            id="newPassword"
            name="newPassword"
            label={t("myProfile.passwordModal.newPassword")}
            type="password"
            required
          />
          <Input
            id="confirmPassword"
            name="confirmPassword"
            label={t("myProfile.passwordModal.confirmNewPassword")}
            type="password"
            required
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setPwOpen(false)}>
              {t("myProfile.cancel")}
            </Button>
            <Button type="submit" loading={pwLoading}>
              {t("myProfile.passwordModal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
