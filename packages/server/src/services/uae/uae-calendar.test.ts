import { describe, expect, it } from "vitest";
import { dubaiToday, uaeCalendar } from "./uae-calendar";

describe("UAE payroll review calendar", () => {
  it("calculates review deadlines across a year boundary and reminds only when reached", () => {
    const before = uaeCalendar(
      "2027-01-01",
      "draft",
      { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 },
      "2026-12-26",
    );
    expect(before).toMatchObject({
      lockDate: "2026-12-27",
      approvalDate: "2026-12-29",
      paymentDueDate: "2027-01-01",
      reminders: [],
      isOverdue: false,
    });
    expect(uaeCalendar("2027-01-01", "draft", undefined, "2026-12-27").reminders).toHaveLength(1);
    expect(uaeCalendar("2027-01-01", "draft", undefined, "2026-12-29").reminders).toHaveLength(2);
  });
  it("distinguishes due today from overdue and clears paid-run reminders", () => {
    const due = uaeCalendar("2026-11-01", "approved", undefined, "2026-11-01");
    expect(due.isOverdue).toBe(false);
    expect(due.reminders).toEqual([expect.stringContaining("Payment is due")]);
    expect(uaeCalendar("2026-11-01", "approved", undefined, "2026-11-02").isOverdue).toBe(true);
    expect(uaeCalendar("2026-11-01", "paid", undefined, "2026-11-02")).toMatchObject({
      isOverdue: false,
      reminders: [],
    });
    expect(uaeCalendar("2026-11-01", "locked", undefined, "2026-10-29").reminders).toEqual([
      expect.stringContaining("Approval cutoff"),
    ]);
  });
  it("uses the UAE local date when UTC is still the previous day", () => {
    expect(dubaiToday(new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
    expect(dubaiToday(new Date("2026-10-31T19:59:59Z"))).toBe("2026-10-31");
  });
});
