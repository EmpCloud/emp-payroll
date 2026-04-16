import nodemailer from "nodemailer";
import { config } from "../config";
import { getDB } from "../db/adapters";
import { findUserById, findOrgById } from "../db/empcloud";
import { logger } from "../utils/logger";
import { PayslipPDFService } from "./payslip-pdf.service";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter;
  private db = getDB();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: config.email.user ? {
        user: config.email.user,
        pass: config.email.password,
      } : undefined,
    });
  }

  /**
   * Returns true when the SMTP transport has enough config to actually send mail.
   * Used by callers (e.g. the payroll routes) to surface a clear "email provider
   * not configured" error instead of the generic "Failed to send emails".
   */
  isConfigured(): boolean {
    return Boolean(config.email.host && config.email.user && config.email.password);
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: `"EMP Payroll" <${config.email.from}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      logger.info(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send email to ${options.to}:`, error);
      return false;
    }
  }

  async sendRaw(options: { to: string; subject: string; html: string }): Promise<boolean> {
    return this.sendEmail(options);
  }

  async sendPayslipEmail(payslipId: string): Promise<boolean> {
    const payslip = await this.db.findById<any>("payslips", payslipId);
    if (!payslip) return false;

    // Resolve employee identity. The payroll DB no longer owns the employees
    // table — identity lives in EmpCloud. Newly-created payslips stamp
    // `employee_id = '00000000-...'` as a placeholder and carry the real user
    // reference in `empcloud_user_id`. Old payslips may have a real UUID in
    // `employee_id` that points at the legacy payroll employees table.
    const placeholderUuid = "00000000-0000-0000-0000-000000000000";
    let employee: { first_name?: string; email?: string; org_id?: string | number } | null =
      null;
    let orgIdForOrgLookup: string | number | null = null;

    if (payslip.empcloud_user_id) {
      const ecUser = await findUserById(Number(payslip.empcloud_user_id));
      if (ecUser) {
        employee = {
          first_name: ecUser.first_name,
          email: ecUser.email,
          org_id: ecUser.organization_id,
        };
        orgIdForOrgLookup = ecUser.organization_id;
      }
    }

    if (!employee && payslip.employee_id && payslip.employee_id !== placeholderUuid) {
      // Fallback to legacy local employees table (pre-EmpCloud migration)
      const legacy = await this.db.findById<any>("employees", payslip.employee_id);
      if (legacy) {
        employee = legacy;
        orgIdForOrgLookup = legacy.org_id;
      }
    }

    if (!employee || !employee.email) {
      logger.warn(
        `sendPayslipEmail: no employee/email resolved for payslip ${payslipId} (empcloud_user_id=${payslip.empcloud_user_id}, employee_id=${payslip.employee_id})`,
      );
      return false;
    }

    // Resolve org — may live in EmpCloud (bigint id) or the legacy local table
    let org: any = null;
    if (typeof orgIdForOrgLookup === "number") {
      org = await findOrgById(orgIdForOrgLookup);
    } else if (orgIdForOrgLookup) {
      org = await this.db.findById<any>("organizations", String(orgIdForOrgLookup));
    }

    const monthNames = ["", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const period = `${monthNames[payslip.month]} ${payslip.year}`;

    const fmt = (n: number) => new Intl.NumberFormat("en-IN", {
      style: "currency", currency: "INR", maximumFractionDigits: 0,
    }).format(n);

    const earnings = typeof payslip.earnings === "string" ? JSON.parse(payslip.earnings) : payslip.earnings || [];
    const deductions = typeof payslip.deductions === "string" ? JSON.parse(payslip.deductions) : payslip.deductions || [];

    const earningsHtml = earnings.map((e: any) =>
      `<tr><td style="padding:8px 16px;border-bottom:1px solid #f3f4f6">${e.name || e.code}</td><td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:right">${fmt(e.amount)}</td></tr>`
    ).join("");

    const deductionsHtml = deductions.map((d: any) =>
      `<tr><td style="padding:8px 16px;border-bottom:1px solid #f3f4f6">${d.name || d.code}</td><td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:right;color:#dc2626">${fmt(d.amount)}</td></tr>`
    ).join("");

    const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f9fafb">
<div style="max-width:600px;margin:0 auto;padding:40px 20px">
  <div style="background:#4f46e5;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="margin:0;font-size:20px">${org?.name || "EMP Payroll"}</h1>
    <p style="margin:8px 0 0;opacity:0.8;font-size:14px">Payslip for ${period}</p>
  </div>

  <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none">
    <p style="margin:0 0 16px;color:#374151">Hi ${employee.first_name},</p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">Your payslip for ${period} is ready. Here's a summary:</p>

    <div style="display:flex;gap:12px;margin-bottom:24px">
      <div style="flex:1;background:#f0fdf4;padding:16px;border-radius:8px;text-align:center">
        <p style="margin:0;font-size:12px;color:#16a34a">Gross Pay</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#15803d">${fmt(payslip.gross_earnings)}</p>
      </div>
      <div style="flex:1;background:#fef2f2;padding:16px;border-radius:8px;text-align:center">
        <p style="margin:0;font-size:12px;color:#dc2626">Deductions</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#b91c1c">${fmt(payslip.total_deductions)}</p>
      </div>
      <div style="flex:1;background:#eef2ff;padding:16px;border-radius:8px;text-align:center">
        <p style="margin:0;font-size:12px;color:#4f46e5">Net Pay</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#4338ca">${fmt(payslip.net_pay)}</p>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
      <tr style="background:#f0fdf4"><td colspan="2" style="padding:8px 16px;font-weight:600;font-size:13px;color:#16a34a">Earnings</td></tr>
      ${earningsHtml}
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr style="background:#fef2f2"><td colspan="2" style="padding:8px 16px;font-weight:600;font-size:13px;color:#dc2626">Deductions</td></tr>
      ${deductionsHtml}
    </table>

    <p style="margin:0;color:#6b7280;font-size:13px">Log in to your employee portal to view the full payslip and download the PDF.</p>
  </div>

  <div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;border-radius:0 0 12px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none">
    This is an automated email from ${org?.name || "EMP Payroll"}. Do not reply.
  </div>
</div>
</body></html>`;

    return this.sendEmail({
      to: employee.email,
      subject: `Your Payslip for ${period} — ${org?.name || "EMP Payroll"}`,
      html,
    });
  }

  async sendPayslipsForRun(runId: string): Promise<{ sent: number; failed: number }> {
    const payslips = await this.db.findMany<any>("payslips", {
      filters: { payroll_run_id: runId },
      limit: 10000,
    });

    let sent = 0;
    let failed = 0;

    for (const ps of payslips.data) {
      const success = await this.sendPayslipEmail(ps.id);
      if (success) {
        sent++;
        await this.db.update("payslips", ps.id, { sent_at: new Date() });
      } else {
        failed++;
      }
    }

    return { sent, failed };
  }
}
