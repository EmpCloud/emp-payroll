import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { useCreateEmployee, useDepartments } from "@/api/hooks";
import { ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";

// Today's date (local) as YYYY-MM-DD — used to cap the DOB <input type="date" max=".."/>
function todayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Bank name: letters (including accented/i18n), spaces, and . , & -
// Pure numeric or any embedded digit is rejected.
const BANK_NAME_REGEX = /^[\p{L}\s.,&-]+$/u;

// Person name — letters, spaces, apostrophes, hyphens, periods. No digits. (#11)
const PERSON_NAME_REGEX = /^[\p{L}\s.'-]+$/u;
// Phone — digits, +, spaces, hyphens, parentheses. No alphabets. (#11)
const PHONE_REGEX = /^[+\d][\d\s()-]{0,19}$/;

export function EmployeeCreatePage() {
  const navigate = useNavigate();
  const mutation = useCreateEmployee();
  const { data: deptRes } = useDepartments();
  const departments: { id: string; name: string }[] = deptRes?.data || [];
  const maxDob = todayISO();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => fd.get(k) as string;

    // ---- Client-side validation (server re-validates) ----
    const dobStr = get("dob");
    if (dobStr) {
      const dob = new Date(dobStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dob.setHours(0, 0, 0, 0);
      if (Number.isNaN(dob.getTime()) || dob.getTime() >= today.getTime()) {
        toast.error("Date of birth must be in the past");
        return;
      }
    }

    const bankName = get("bank_name");
    if (bankName && !BANK_NAME_REGEX.test(bankName)) {
      toast.error("Bank name must only contain letters, spaces, and . , & -");
      return;
    }

    // Name + phone validation — mirrors the server schemas so we fail fast (#11).
    const firstName = get("first_name");
    const lastName = get("last_name");
    if (firstName && !PERSON_NAME_REGEX.test(firstName)) {
      toast.error("First name must not contain numbers or special characters");
      return;
    }
    if (lastName && !PERSON_NAME_REGEX.test(lastName)) {
      toast.error("Last name must not contain numbers or special characters");
      return;
    }
    const phone = get("phone");
    if (phone && !PHONE_REGEX.test(phone)) {
      toast.error("Phone must only contain digits, spaces, and + - ( )");
      return;
    }

    try {
      await mutation.mutateAsync({
        employeeCode: get("employee_id"),
        firstName: get("first_name"),
        lastName: get("last_name"),
        email: get("email"),
        phone: get("phone") || undefined,
        dateOfBirth: get("dob"),
        gender: get("gender"),
        dateOfJoining: get("date_of_joining"),
        employmentType: get("employment_type"),
        department: get("department"),
        designation: get("designation"),
        bankDetails: {
          accountNumber: get("account_number"),
          ifscCode: get("ifsc"),
          bankName: get("bank_name"),
          branchName: "",
        },
        taxInfo: {
          pan: get("pan"),
          regime: get("tax_regime") || "new",
          uan: get("uan") || undefined,
        },
        pfDetails: {
          pfNumber: get("uan") || undefined,
          isOptedOut: false,
          contributionRate: 12,
        },
      });
      toast.success("Employee created successfully");
      navigate("/employees");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to create employee");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Employee"
        actions={
          <Button variant="ghost" onClick={() => navigate("/employees")}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="first_name"
                name="first_name"
                label="First Name"
                placeholder="Arjun"
                required
                // HTML5 pattern only supports ASCII ranges; the handleSubmit
                // guard uses \p{L} regex for full i18n coverage.
                pattern="[A-Za-z\u00C0-\u024F\s.'\-]+"
                title="Letters, spaces, apostrophes, hyphens and periods only"
              />
              <Input
                id="last_name"
                name="last_name"
                label="Last Name"
                placeholder="Sharma"
                required
                pattern="[A-Za-z\u00C0-\u024F\s.'\-]+"
                title="Letters, spaces, apostrophes, hyphens and periods only"
              />
              <Input
                id="email"
                name="email"
                label="Email"
                type="email"
                placeholder="arjun@company.com"
                required
              />
              <Input
                id="phone"
                name="phone"
                label="Phone"
                placeholder="+91 98765 43210"
                pattern="[+0-9][0-9\s()\-]{0,19}"
                title="Digits, spaces, + - ( ) only"
              />
              <Input id="dob" name="dob" label="Date of Birth" type="date" max={maxDob} required />
              <SelectField
                id="gender"
                name="gender"
                label="Gender"
                options={[
                  { value: "", label: "Select..." },
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {/* Employment Details */}
        <Card>
          <CardHeader>
            <CardTitle>Employment Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="employee_id"
                name="employee_id"
                label="Employee ID"
                placeholder="EMP009"
                required
              />
              {/* #48 — Department dropdown populated from the org's
                  organization_departments API. When the org has no
                  departments configured yet we fall back to a free-text
                  input and guide the admin to the Departments page so the
                  form remains usable on a fresh tenant. */}
              {departments.length > 0 ? (
                <SelectField
                  id="department"
                  name="department"
                  label="Department"
                  required
                  options={[
                    { value: "", label: "Select department..." },
                    ...departments.map((d) => ({ value: d.name, label: d.name })),
                  ]}
                />
              ) : (
                <Input
                  id="department"
                  name="department"
                  label="Department"
                  placeholder="Engineering"
                  required
                  title="No departments configured yet — add some from Settings > Departments"
                />
              )}
              <Input
                id="designation"
                name="designation"
                label="Designation"
                placeholder="Software Engineer"
                required
              />
              <Input
                id="date_of_joining"
                name="date_of_joining"
                label="Date of Joining"
                type="date"
                required
              />
              <SelectField
                id="employment_type"
                name="employment_type"
                label="Employment Type"
                options={[
                  { value: "full_time", label: "Full Time" },
                  { value: "part_time", label: "Part Time" },
                  { value: "contract", label: "Contract" },
                  { value: "intern", label: "Intern" },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <CardTitle>Bank Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="bank_name"
                name="bank_name"
                label="Bank Name"
                placeholder="HDFC Bank"
                pattern="^[A-Za-z\u00C0-\u024F\s.,&\-]+$"
                title="Letters, spaces, and . , & - only (no numbers)"
                required
              />
              <Input
                id="account_number"
                name="account_number"
                label="Account Number"
                placeholder="1234567890"
                required
              />
              <Input id="ifsc" name="ifsc" label="IFSC Code" placeholder="HDFC0001234" required />
            </div>
          </CardContent>
        </Card>

        {/* Tax & Statutory */}
        <Card>
          <CardHeader>
            <CardTitle>Tax & Statutory</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input id="pan" name="pan" label="PAN Number" placeholder="ABCPS1234F" required />
              <Input id="uan" name="uan" label="UAN / PF Number" placeholder="BGBNG/12345/009" />
              <SelectField
                id="tax_regime"
                name="tax_regime"
                label="Tax Regime"
                options={[
                  { value: "new", label: "New Regime (Default)" },
                  { value: "old", label: "Old Regime" },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate("/employees")}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save Employee
          </Button>
        </div>
      </form>
    </div>
  );
}
