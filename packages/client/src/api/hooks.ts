import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDelete } from "./client";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export function useLogin() {
  return useMutation({
    mutationFn: (data: { email: string; password: string }) => apiPost<any>("/auth/login", data),
  });
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
export function useEmployees(params?: Record<string, any>) {
  return useQuery({
    queryKey: ["employees", params],
    queryFn: () => apiGet<any>("/employees", params),
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: ["employee", id],
    queryFn: () => apiGet<any>(`/employees/${id}`),
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost<any>("/employees", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPut<any>(`/employees/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee", id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Salary Structures
// ---------------------------------------------------------------------------
export function useSalaryStructures() {
  return useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => apiGet<any>("/salary-structures"),
  });
}

export function useEmployeeSalary(empId: string) {
  return useQuery({
    queryKey: ["employee-salary", empId],
    queryFn: () => apiGet<any>(`/salary-structures/employee/${empId}`),
    enabled: !!empId,
  });
}

export function useBulkAssignSalary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      employeeIds: string[];
      structureId: string;
      ctc: number;
      components: { code: string; name: string; monthlyAmount: number; annualAmount: number }[];
      effectiveFrom: string;
    }) => apiPost<any>("/salary-structures/bulk-assign", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-salary"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Payroll Runs
// ---------------------------------------------------------------------------
export function usePayrollRuns() {
  return useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => apiGet<any>("/payroll"),
  });
}

export function usePayrollRun(id: string) {
  return useQuery({
    queryKey: ["payroll-run", id],
    queryFn: () => apiGet<any>(`/payroll/${id}`),
    enabled: !!id,
  });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost<any>("/payroll", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-runs"] }),
  });
}

export function useComputePayroll(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>(`/payroll/${id}/compute`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["payroll-run", id] });
    },
  });
}

export function useApprovePayroll(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>(`/payroll/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["payroll-run", id] });
    },
  });
}

export function usePayPayroll(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>(`/payroll/${id}/pay`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["payroll-run", id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------
export function usePayslips(params?: Record<string, any>) {
  return useQuery({
    queryKey: ["payslips", params],
    queryFn: () => apiGet<any>("/payslips", params),
  });
}

export function usePayslip(id: string) {
  return useQuery({
    queryKey: ["payslip", id],
    queryFn: () => apiGet<any>(`/payslips/${id}`),
    enabled: !!id,
  });
}

export function useRunPayslips(runId: string) {
  return useQuery({
    queryKey: ["run-payslips", runId],
    queryFn: () => apiGet<any>(`/payroll/${runId}/payslips`),
    enabled: !!runId,
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export function useAttendanceBulk(month: number, year: number) {
  return useQuery({
    queryKey: ["attendance-bulk", month, year],
    queryFn: () => apiGet<any>("/attendance/summary/bulk", { month, year }),
    enabled: !!month && !!year,
  });
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
export function useOrganization(id: string) {
  return useQuery({
    queryKey: ["organization", id],
    queryFn: () => apiGet<any>(`/organizations/${id}`),
    enabled: !!id,
  });
}

export function useOrgSettings(id: string) {
  return useQuery({
    queryKey: ["org-settings", id],
    queryFn: () => apiGet<any>(`/organizations/${id}/settings`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Departments (#48)
// ---------------------------------------------------------------------------
export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet<any>("/departments"),
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) => apiPost<any>("/departments", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<any>(`/departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }),
  });
}

// ---------------------------------------------------------------------------
// Self-Service
// ---------------------------------------------------------------------------
export function useSelfDashboard() {
  return useQuery({
    queryKey: ["self-dashboard"],
    queryFn: () => apiGet<any>("/self-service/dashboard"),
  });
}

export function useMyPayslips() {
  return useQuery({
    queryKey: ["my-payslips"],
    queryFn: () => apiGet<any>("/self-service/payslips"),
  });
}

export function useMySalary() {
  return useQuery({
    queryKey: ["my-salary"],
    queryFn: () => apiGet<any>("/self-service/salary"),
  });
}

export function useMyTaxComputation() {
  return useQuery({
    queryKey: ["my-tax"],
    queryFn: () => apiGet<any>("/self-service/tax/computation"),
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiGet<any>("/self-service/profile"),
  });
}
