// =============================================================================
// Cloud HRMS Proxy Service
// =============================================================================
// Fetches attendance and leave data from EMP Cloud's HRMS APIs instead of the
// local payroll database. Activated when USE_CLOUD_HRMS=true.
//
// EMP Cloud API endpoints used:
//   GET /api/v1/attendance/monthly-report?month=&year=&user_id=
//   GET /api/v1/leave/balances?user_id=&year=
//   GET /api/v1/leave/applications?user_id=&status=approved
// =============================================================================

import { config } from "../config";

const CLOUD_API = config.cloudHrms.apiUrl;

interface CloudAttendanceRecord {
  user_id: number;
  total_days: number;
  present_days: number;
  absent_days: number;
  half_days: number;
  paid_leave: number;
  unpaid_leave: number;
  holidays: number;
  weekoffs: number;
  lop_days: number;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number;
}

interface CloudLeaveBalance {
  leave_type_id: number;
  leave_type_name: string;
  entitled: number;
  used: number;
  balance: number;
}

interface CloudLeaveApplication {
  id: number;
  user_id: number;
  leave_type_id: number;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  is_half_day: boolean;
}

/**
 * Fetch the monthly attendance report from Cloud HRMS for a specific user.
 * Maps to: GET /api/v1/attendance/monthly-report?month=&year=&user_id=
 *
 * Returns null on failure so payroll can fall back to local data.
 */
export async function getMonthlyAttendance(
  orgId: number,
  userId: number,
  month: number,
  year: number,
  token: string,
): Promise<CloudAttendanceRecord | null> {
  try {
    const url = `${CLOUD_API}/attendance/monthly-report?month=${month}&year=${year}&user_id=${userId}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      return null;
    }

    const json: any = await res.json();
    // Cloud returns { success: true, data: { ... } } or paginated data
    const report = json.data;

    if (!report) return null;

    // The monthly-report endpoint may return an array (org-wide) or a single record
    // when filtered by user_id. Normalize to a single record.
    const record = Array.isArray(report) ? report.find((r: any) => r.user_id === userId) : report;

    if (!record) return null;

    return {
      user_id: userId,
      total_days: record.total_days ?? record.working_days ?? 30,
      present_days: record.present_days ?? 0,
      absent_days: record.absent_days ?? 0,
      half_days: record.half_days ?? 0,
      paid_leave: record.paid_leave ?? 0,
      unpaid_leave: record.unpaid_leave ?? 0,
      holidays: record.holidays ?? 0,
      weekoffs: record.weekoffs ?? 0,
      lop_days: record.lop_days ?? record.unpaid_leave ?? 0,
      overtime_hours: record.overtime_hours ?? 0,
      overtime_rate: record.overtime_rate ?? 0,
      overtime_amount: record.overtime_amount ?? 0,
    };
  } catch {
    // Network error or unexpected failure — return null so caller can fall back
    return null;
  }
}

/**
 * Fetch leave balances from Cloud HRMS for a specific user.
 * Maps to: GET /api/v1/leave/balances?user_id=&year=
 */
export async function getLeaveBalances(
  orgId: number,
  userId: number,
  year: number,
  token: string,
): Promise<CloudLeaveBalance[] | null> {
  try {
    const url = `${CLOUD_API}/leave/balances?user_id=${userId}&year=${year}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;

    const json: any = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch approved leave applications from Cloud HRMS for a specific user.
 * Maps to: GET /api/v1/leave/applications?user_id=&status=approved
 */
export async function getLeaveApplications(
  orgId: number,
  userId: number,
  startDate: string,
  endDate: string,
  token: string,
): Promise<CloudLeaveApplication[] | null> {
  try {
    const url = `${CLOUD_API}/leave/applications?user_id=${userId}&status=approved`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;

    const json: any = await res.json();
    const applications: CloudLeaveApplication[] = json.data ?? [];

    // Filter to only those overlapping with the requested period
    return applications.filter((app) => {
      return app.start_date <= endDate && app.end_date >= startDate;
    });
  } catch {
    return null;
  }
}

/**
 * Convert Cloud attendance data to the format expected by payroll computation.
 * Returns an object matching the shape of a local attendance_summaries row.
 */
export function toLocalAttendanceFormat(cloud: CloudAttendanceRecord): Record<string, any> {
  return {
    empcloud_user_id: cloud.user_id,
    total_days: cloud.total_days,
    present_days: cloud.present_days,
    absent_days: cloud.absent_days,
    half_days: cloud.half_days,
    paid_leave: cloud.paid_leave,
    unpaid_leave: cloud.unpaid_leave,
    holidays: cloud.holidays,
    weekoffs: cloud.weekoffs,
    lop_days: cloud.lop_days,
    overtime_hours: cloud.overtime_hours,
    overtime_rate: cloud.overtime_rate,
    overtime_amount: cloud.overtime_amount,
  };
}
