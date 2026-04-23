import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useDepartments } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Loader2, Globe } from "lucide-react";
import toast from "react-hot-toast";

const EMPLOYMENT_TYPES = [
  { value: "", label: "All Types" },
  { value: "eor", label: "EOR" },
  { value: "contractor", label: "Contractor" },
  { value: "direct_hire", label: "Direct Hire" },
];

const CONTRACT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "fixed_term", label: "Fixed-term" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "offboarding", label: "Offboarding" },
  { value: "terminated", label: "Terminated" },
];

const SALARY_FREQ = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "weekly", label: "Weekly" },
  { value: "annual", label: "Annual" },
];

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  active: "active",
  onboarding: "draft",
  offboarding: "draft",
  terminated: "inactive",
};

const TYPE_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  eor: "active",
  contractor: "draft",
  direct_hire: "active",
};

const COUNTRY_FLAGS: Record<string, string> = {
  IN: "\uD83C\uDDEE\uD83C\uDDF3",
  US: "\uD83C\uDDFA\uD83C\uDDF8",
  GB: "\uD83C\uDDEC\uD83C\uDDE7",
  DE: "\uD83C\uDDE9\uD83C\uDDEA",
  FR: "\uD83C\uDDEB\uD83C\uDDF7",
  CA: "\uD83C\uDDE8\uD83C\uDDE6",
  AU: "\uD83C\uDDE6\uD83C\uDDFA",
  SG: "\uD83C\uDDF8\uD83C\uDDEC",
  AE: "\uD83C\uDDE6\uD83C\uDDEA",
  JP: "\uD83C\uDDEF\uD83C\uDDF5",
  BR: "\uD83C\uDDE7\uD83C\uDDF7",
  MX: "\uD83C\uDDF2\uD83C\uDDFD",
  KR: "\uD83C\uDDF0\uD83C\uDDF7",
  NL: "\uD83C\uDDF3\uD83C\uDDF1",
  ES: "\uD83C\uDDEA\uD83C\uDDF8",
  IT: "\uD83C\uDDEE\uD83C\uDDF9",
  SE: "\uD83C\uDDF8\uD83C\uDDEA",
  CH: "\uD83C\uDDE8\uD83C\uDDED",
  IE: "\uD83C\uDDEE\uD83C\uDDEA",
  PL: "\uD83C\uDDF5\uD83C\uDDF1",
  PH: "\uD83C\uDDF5\uD83C\uDDED",
  ID: "\uD83C\uDDEE\uD83C\uDDE9",
  MY: "\uD83C\uDDF2\uD83C\uDDFE",
  TH: "\uD83C\uDDF9\uD83C\uDDED",
  VN: "\uD83C\uDDFB\uD83C\uDDF3",
  ZA: "\uD83C\uDDFF\uD83C\uDDE6",
  NG: "\uD83C\uDDF3\uD83C\uDDEC",
  KE: "\uD83C\uDDF0\uD83C\uDDEA",
  EG: "\uD83C\uDDEA\uD83C\uDDEC",
  SA: "\uD83C\uDDF8\uD83C\uDDE6",
};

export function GlobalEmployeesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // #151 — Seed filters from URL params so drill-in links from the Global
  // Dashboard cards (e.g. `?status=onboarding` / `?employmentType=eor`)
  // actually scope the list instead of silently falling back to "all".
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("employmentType") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [countryFilter, setCountryFilter] = useState(searchParams.get("country") || "");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // #180 — Source the org's department list so the Add Employee form can
  // offer a dropdown instead of a free-text input. Mirrors the pattern in
  // EmployeeCreatePage; falls back to a free-text input when the org has
  // no departments configured yet so a fresh tenant isn't blocked.
  const { data: deptRes } = useDepartments();
  const departments: { id: string; name: string }[] = deptRes?.data || [];

  // Form state
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    countryId: "",
    employmentType: "eor" as string,
    contractType: "full_time" as string,
    jobTitle: "",
    department: "",
    startDate: "",
    salaryAmount: "",
    salaryFrequency: "monthly" as string,
    taxId: "",
    bankName: "",
    bankAccount: "",
    bankRouting: "",
    notes: "",
  });

  const { data: countriesRes } = useQuery({
    queryKey: ["global-countries"],
    queryFn: () => apiGet<any>("/global/countries"),
  });

  const { data: empRes, isLoading } = useQuery({
    queryKey: ["global-employees", search, typeFilter, statusFilter, countryFilter],
    queryFn: () =>
      apiGet<any>("/global/employees", {
        search: search || undefined,
        employmentType: typeFilter || undefined,
        status: statusFilter || undefined,
        countryId: countryFilter || undefined,
      }),
  });

  const countries = countriesRes?.data || [];
  const employees = empRes?.data || [];

  const countryOptions = [
    { value: "", label: "All Countries" },
    ...countries.map((c: any) => ({ value: c.id, label: c.name })),
  ];

  const countrySelectOptions = countries.map((c: any) => ({
    value: c.id,
    label: `${c.name} (${c.currency})`,
  }));

  const handleAdd = async () => {
    if (
      !form.firstName ||
      !form.lastName ||
      !form.email ||
      !form.countryId ||
      !form.jobTitle ||
      !form.startDate ||
      !form.salaryAmount
    ) {
      toast.error("Please fill all required fields");
      return;
    }
    setSaving(true);
    try {
      await apiPost("/global/employees", {
        ...form,
        salaryAmount: Math.round(Number(form.salaryAmount) * 100),
      });
      toast.success("Global employee added");
      setShowAdd(false);
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        countryId: "",
        employmentType: "eor",
        contractType: "full_time",
        jobTitle: "",
        department: "",
        startDate: "",
        salaryAmount: "",
        salaryFrequency: "monthly",
        taxId: "",
        bankName: "",
        bankAccount: "",
        bankRouting: "",
        notes: "",
      });
      qc.invalidateQueries({ queryKey: ["global-employees"] });
      qc.invalidateQueries({ queryKey: ["global-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to add employee");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row: any) => (
        <button
          className="text-brand-600 text-left font-medium hover:underline"
          onClick={() => navigate(`/global-payroll/employees/${row.id}`)}
        >
          {row.first_name} {row.last_name}
        </button>
      ),
    },
    {
      key: "country",
      header: "Country",
      render: (row: any) => (
        <span>
          {COUNTRY_FLAGS[row.country_code] || ""} {row.country_name}
        </span>
      ),
    },
    {
      key: "employment_type",
      header: "Type",
      render: (row: any) => (
        <Badge variant={TYPE_BADGE[row.employment_type] || "draft"}>
          {row.employment_type === "eor"
            ? "EOR"
            : row.employment_type === "direct_hire"
              ? "Direct Hire"
              : "Contractor"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => (
        <Badge variant={STATUS_BADGE[row.status] || "draft"}>
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: "salary",
      header: "Salary",
      render: (row: any) => (
        <span className="font-mono text-sm">
          {row.country_currency_symbol || row.salary_currency}{" "}
          {(Number(row.salary_amount) / 100).toLocaleString()}/
          {row.salary_frequency === "annual" ? "yr" : "mo"}
        </span>
      ),
    },
    {
      key: "job_title",
      header: "Job Title",
    },
    {
      key: "start_date",
      header: "Start Date",
      render: (row: any) => new Date(row.start_date).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Employees"
        description="Manage EOR, contractor, and direct-hire employees worldwide"
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Employee
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-10"
                placeholder="Search by name, email, or country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <SelectField
              className="w-40"
              options={countryOptions}
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
            />
            <SelectField
              className="w-36"
              options={EMPLOYMENT_TYPES}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            />
            <SelectField
              className="w-36"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={employees}
          emptyMessage="No global employees found. Click 'Add Employee' to hire your first international team member."
        />
      )}

      {/* Add Employee Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Global Employee">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name *"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <Input
              label="Last Name *"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
          <Input
            label="Email *"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Country *"
              options={countrySelectOptions}
              value={form.countryId}
              onChange={(e) => setForm({ ...form, countryId: e.target.value })}
            />
            <SelectField
              label="Employment Type *"
              options={EMPLOYMENT_TYPES.filter((t) => t.value)}
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Contract Type"
              options={CONTRACT_TYPES}
              value={form.contractType}
              onChange={(e) => setForm({ ...form, contractType: e.target.value })}
            />
            <Input
              label="Job Title *"
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {departments.length > 0 ? (
              <SelectField
                label="Department"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                options={[
                  { value: "", label: "Select department..." },
                  ...departments.map((d) => ({ value: d.name, label: d.name })),
                ]}
              />
            ) : (
              <Input
                label="Department"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                title="No departments configured yet — add some from Settings > Departments"
              />
            )}
            <Input
              label="Start Date *"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Salary Amount * (in major currency unit)"
              type="number"
              value={form.salaryAmount}
              onChange={(e) => setForm({ ...form, salaryAmount: e.target.value })}
            />
            <SelectField
              label="Pay Frequency"
              options={SALARY_FREQ}
              value={form.salaryFrequency}
              onChange={(e) => setForm({ ...form, salaryFrequency: e.target.value })}
            />
          </div>

          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Banking & Tax (Optional)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Tax ID"
              value={form.taxId}
              onChange={(e) => setForm({ ...form, taxId: e.target.value })}
            />
            <Input
              label="Bank Name"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Bank Account"
              value={form.bankAccount}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
            />
            <Input
              label="Bank Routing"
              value={form.bankRouting}
              onChange={(e) => setForm({ ...form, bankRouting: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Employee
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
