export interface UaeSchedule {
  lockDaysBeforeDue: number;
  approvalDaysBeforeDue: number;
}

export const DEFAULT_UAE_SCHEDULE: UaeSchedule = { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 };

export function dubaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function uaeCalendar(
  paymentDueDate: string,
  status: string,
  schedule = DEFAULT_UAE_SCHEDULE,
  today = dubaiToday(),
) {
  const before = (days: number) =>
    new Date(Date.parse(`${paymentDueDate}T00:00:00Z`) - days * 86400000)
      .toISOString()
      .slice(0, 10);
  const lockDate = before(schedule.lockDaysBeforeDue);
  const approvalDate = before(schedule.approvalDaysBeforeDue);
  const reminders: string[] = [];
  if (status === "draft" && today >= lockDate)
    reminders.push("Payroll lock cutoff reached: review inputs and lock the run.");
  if (["draft", "locked"].includes(status) && today >= approvalDate)
    reminders.push("Approval cutoff reached: complete review before the payment deadline.");
  if (status !== "paid" && today >= paymentDueDate)
    reminders.push("Payment is due: confirm funds reached employees and record bank evidence.");
  return {
    lockDate,
    approvalDate,
    paymentDueDate,
    reminders,
    isOverdue: status !== "paid" && today > paymentDueDate,
  };
}
