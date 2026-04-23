import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { apiPost } from "@/api/client";
import { getUser } from "@/api/auth";
import { Building2, Users, Wallet, CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";

const STEPS = [
  { icon: Building2, label: "Organization" },
  { icon: Wallet, label: "Salary Structure" },
  { icon: Users, label: "First Employee" },
  { icon: CheckCircle2, label: "Done" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [structureId, setStructureId] = useState("");

  async function createOrg(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await apiPost<any>("/organizations", {
        name: fd.get("name"),
        legalName: fd.get("legalName"),
        pan: fd.get("pan"),
        tan: fd.get("tan"),
        gstin: fd.get("gstin") || undefined,
        registeredAddress: {
          line1: fd.get("address") as string,
          city: fd.get("city") as string,
          state: fd.get("state") as string,
          pincode: fd.get("pincode") as string,
        },
        state: fd.get("state"),
      });
      setOrgId(res.data.id);
      toast.success("Organization created");
      setStep(1);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function createStructure(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiPost<any>("/salary-structures", {
        name: "Standard CTC Structure",
        description: "Default salary structure",
        isDefault: true,
        components: [
          {
            name: "Basic Salary",
            code: "BASIC",
            type: "earning",
            calculationType: "percentage",
            value: 40,
            percentageOf: "CTC",
            isTaxable: true,
            sortOrder: 1,
          },
          {
            name: "HRA",
            code: "HRA",
            type: "earning",
            calculationType: "percentage",
            value: 50,
            percentageOf: "BASIC",
            isTaxable: true,
            sortOrder: 2,
          },
          {
            name: "Special Allowance",
            code: "SA",
            type: "earning",
            calculationType: "balance",
            value: 0,
            isTaxable: true,
            sortOrder: 3,
          },
        ],
      });
      setStructureId(res.data.id);
      toast.success("Salary structure created");
      setStep(2);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Setup Your Payroll"
          description="Let's get your organization ready in 3 easy steps"
        />

        {/* Stepper */}
        <div className="my-8 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <div className={`h-0.5 w-8 ${done ? "bg-brand-500" : "bg-gray-200"}`} />}
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                    active
                      ? "bg-brand-600 text-white"
                      : done
                        ? "bg-brand-100 text-brand-700"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 0: Organization */}
        {step === 0 && (
          <Card>
            <CardContent className="py-6">
              <h3 className="mb-4 text-lg font-semibold">Organization Details</h3>
              <form onSubmit={createOrg} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    id="name"
                    name="name"
                    label="Company Name"
                    placeholder="TechNova Solutions"
                    required
                  />
                  <Input
                    id="legalName"
                    name="legalName"
                    label="Legal Name"
                    placeholder="TechNova Solutions Pvt. Ltd."
                    required
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Input id="pan" name="pan" label="PAN" placeholder="AABCT1234F" required />
                  <Input id="tan" name="tan" label="TAN" placeholder="BLRT12345A" required />
                  <Input
                    id="gstin"
                    name="gstin"
                    label="GSTIN (optional)"
                    placeholder="29AABCT1234F1ZP"
                  />
                </div>
                <Input
                  id="address"
                  name="address"
                  label="Address"
                  placeholder="42, HSR Layout"
                  required
                />
                <div className="grid grid-cols-3 gap-4">
                  <Input id="city" name="city" label="City" placeholder="Bengaluru" required />
                  <SelectField
                    id="state"
                    name="state"
                    label="State"
                    options={[
                      { value: "KA", label: "Karnataka" },
                      { value: "MH", label: "Maharashtra" },
                      { value: "TN", label: "Tamil Nadu" },
                      { value: "DL", label: "Delhi" },
                      { value: "TS", label: "Telangana" },
                      { value: "GJ", label: "Gujarat" },
                      { value: "WB", label: "West Bengal" },
                      { value: "UP", label: "Uttar Pradesh" },
                    ]}
                  />
                  <Input
                    id="pincode"
                    name="pincode"
                    label="Pincode"
                    placeholder="560102"
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" loading={loading}>
                    Next <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Salary Structure */}
        {step === 1 && (
          <Card>
            <CardContent className="py-6">
              <h3 className="mb-4 text-lg font-semibold">Default Salary Structure</h3>
              <p className="mb-4 text-sm text-gray-500">
                We'll create a standard Indian CTC structure with Basic (40%), HRA (50% of Basic),
                and Special Allowance.
              </p>
              <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="py-1 text-gray-500">Basic Salary</td>
                      <td className="py-1 text-right">40% of CTC</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-gray-500">HRA</td>
                      <td className="py-1 text-right">50% of Basic</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-gray-500">Special Allowance</td>
                      <td className="py-1 text-right">Balance</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <form onSubmit={createStructure}>
                <div className="flex justify-between">
                  <Button variant="outline" type="button" onClick={() => setStep(0)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button type="submit" loading={loading}>
                    Create & Next <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Skip or add employee */}
        {step === 2 && (
          <Card>
            <CardContent className="py-6">
              <h3 className="mb-4 text-lg font-semibold">Add Employees</h3>
              <p className="mb-6 text-sm text-gray-500">
                You can add employees now or skip and do it later from the Employees page.
              </p>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(3)}>
                    Skip for now
                  </Button>
                  <Button
                    onClick={() => {
                      navigate("/employees/new");
                    }}
                  >
                    <Users className="h-4 w-4" /> Add First Employee
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <Card>
            <CardContent className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
              <h3 className="mt-4 text-xl font-bold text-gray-900">You're all set!</h3>
              <p className="mt-2 text-gray-500">
                Your organization is ready. Start by adding employees and running your first
                payroll.
              </p>
              <Button className="mt-6" onClick={() => navigate("/dashboard")}>
                Go to Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
