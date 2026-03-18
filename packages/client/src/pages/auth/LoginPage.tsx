import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DollarSign } from "lucide-react";
import { useLogin } from "@/api/hooks";
import { saveAuth } from "@/api/auth";
import toast from "react-hot-toast";

export function LoginPage() {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [email, setEmail] = useState("ananya@technova.in");
  const [password, setPassword] = useState("Welcome@123");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await loginMutation.mutateAsync({ email, password });
      if (res.success) {
        saveAuth(res.data);
        toast.success(`Welcome back, ${res.data.user.first_name}!`);
        const role = res.data.user.role;
        navigate(role === "hr_admin" || role === "hr_manager" ? "/dashboard" : "/my");
      } else {
        toast.error(res.error?.message || "Login failed");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Login failed. Check your credentials.");
    }
  }

  return (
    <div>
      {/* Mobile logo */}
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600">
          <DollarSign className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-bold text-gray-900">EMP Payroll</span>
      </div>

      <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
      <p className="mt-1 text-sm text-gray-500">Sign in to manage your payroll</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <Input
          id="email"
          label="Email address"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-gray-600">Remember me</span>
          </label>
          <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </button>
        </div>
        <Button type="submit" loading={loginMutation.isPending} className="w-full">
          Sign in
        </Button>
      </form>

      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
        <p className="font-medium">Demo credentials:</p>
        <p>ananya@technova.in / Welcome@123</p>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don't have an account?{" "}
        <button type="button" className="font-medium text-brand-600 hover:text-brand-700">
          Contact your HR admin
        </button>
      </p>
    </div>
  );
}
