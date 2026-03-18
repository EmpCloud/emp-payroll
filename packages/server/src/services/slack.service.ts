import { logger } from "../utils/logger";

/**
 * Slack/Teams notification service.
 * Sends messages to configured webhook URLs.
 * Configure via SLACK_WEBHOOK_URL or TEAMS_WEBHOOK_URL env vars.
 */

interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: any[];
}

export class SlackService {
  private webhookUrl: string;
  private platform: "slack" | "teams";

  constructor() {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.TEAMS_WEBHOOK_URL || "";
    this.platform = process.env.TEAMS_WEBHOOK_URL ? "teams" : "slack";
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }

  async sendMessage(text: string): Promise<boolean> {
    if (!this.webhookUrl) {
      logger.info(`[Slack/Teams] Not configured. Message: ${text}`);
      return false;
    }

    try {
      const payload = this.platform === "teams"
        ? { "@type": "MessageCard", text }
        : { text };

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        logger.info(`[${this.platform}] Message sent: ${text.slice(0, 100)}`);
        return true;
      }
      logger.error(`[${this.platform}] Failed: ${response.status}`);
      return false;
    } catch (error: any) {
      logger.error(`[${this.platform}] Error: ${error.message}`);
      return false;
    }
  }

  async notifyPayrollComputed(period: string, employeeCount: number, totalGross: number): Promise<boolean> {
    const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    return this.sendMessage(
      `Payroll computed for *${period}* — ${employeeCount} employees, gross ${fmt(totalGross)}. Pending approval.`
    );
  }

  async notifyPayrollApproved(period: string, totalNet: number): Promise<boolean> {
    const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    return this.sendMessage(`Payroll *approved* for *${period}* — net pay ${fmt(totalNet)}. Ready for payment.`);
  }

  async notifyPayrollPaid(period: string, employeeCount: number): Promise<boolean> {
    return this.sendMessage(`Payroll *paid* for *${period}* — ${employeeCount} employees paid. Payslips available.`);
  }

  async notifyNewEmployee(name: string, department: string): Promise<boolean> {
    return this.sendMessage(`New employee joined: *${name}* in ${department}. Welcome!`);
  }
}
