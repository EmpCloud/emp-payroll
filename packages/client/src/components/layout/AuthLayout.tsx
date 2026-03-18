import { Outlet } from "react-router-dom";
import { DollarSign } from "lucide-react";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden w-1/2 flex-col justify-between bg-brand-600 p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
            <DollarSign className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white">EMP Payroll</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight text-white">
            India's Open-Source<br />Payroll Engine
          </h1>
          <p className="mt-4 max-w-md text-lg text-brand-200">
            PF, ESI, TDS, and Professional Tax — all built in. Run payroll for your entire team in minutes.
          </p>
        </div>
        <p className="text-sm text-brand-300">Part of the EmpCloud ecosystem</p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
