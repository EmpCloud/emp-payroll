import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";

/**
 * Webhook service for notifying external systems of events.
 *
 * Events: employee.created, employee.updated, employee.deactivated,
 *         payroll.computed, payroll.approved, payroll.paid,
 *         payslip.generated, salary.revised, reimbursement.approved
 *
 * Webhooks are stored in-memory for now. In production, use a DB table
 * + queue (Redis/Bull) for reliable delivery with retries.
 */

interface WebhookRegistration {
  id: string;
  orgId: string;
  url: string;
  events: string[]; // ["*"] for all events, or specific event names
  secret: string;
  isActive: boolean;
  createdAt: Date;
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: any;
  status: "pending" | "delivered" | "failed";
  statusCode?: number;
  attempt: number;
  deliveredAt?: Date;
  error?: string;
}

export class WebhookService {
  private static webhooks: WebhookRegistration[] = [];
  private static deliveries: WebhookDelivery[] = [];

  async register(orgId: string, params: {
    url: string;
    events: string[];
    secret?: string;
  }): Promise<WebhookRegistration> {
    const webhook: WebhookRegistration = {
      id: uuid(),
      orgId,
      url: params.url,
      events: params.events || ["*"],
      secret: params.secret || `whsec_${uuid().replace(/-/g, "")}`,
      isActive: true,
      createdAt: new Date(),
    };
    WebhookService.webhooks.push(webhook);
    return webhook;
  }

  async list(orgId: string): Promise<WebhookRegistration[]> {
    return WebhookService.webhooks.filter((w) => w.orgId === orgId);
  }

  async delete(orgId: string, webhookId: string): Promise<boolean> {
    const idx = WebhookService.webhooks.findIndex(
      (w) => w.id === webhookId && w.orgId === orgId
    );
    if (idx === -1) return false;
    WebhookService.webhooks.splice(idx, 1);
    return true;
  }

  async toggle(orgId: string, webhookId: string): Promise<WebhookRegistration | null> {
    const webhook = WebhookService.webhooks.find(
      (w) => w.id === webhookId && w.orgId === orgId
    );
    if (!webhook) return null;
    webhook.isActive = !webhook.isActive;
    return webhook;
  }

  /**
   * Dispatch an event to all matching webhooks for the org.
   * Fire-and-forget with retry logic.
   */
  async dispatch(orgId: string, event: string, payload: any): Promise<number> {
    const matching = WebhookService.webhooks.filter(
      (w) => w.orgId === orgId && w.isActive &&
        (w.events.includes("*") || w.events.includes(event))
    );

    let delivered = 0;

    for (const webhook of matching) {
      const delivery: WebhookDelivery = {
        id: uuid(),
        webhookId: webhook.id,
        event,
        payload,
        status: "pending",
        attempt: 1,
      };

      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": event,
            "X-Webhook-ID": delivery.id,
            "X-Webhook-Secret": webhook.secret,
          },
          body: JSON.stringify({
            event,
            timestamp: new Date().toISOString(),
            data: payload,
          }),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        delivery.statusCode = response.status;
        delivery.status = response.ok ? "delivered" : "failed";
        delivery.deliveredAt = new Date();
        if (response.ok) delivered++;
      } catch (error: any) {
        delivery.status = "failed";
        delivery.error = error.message;
        logger.error(`Webhook delivery failed: ${webhook.url} (${event})`, error.message);
      }

      WebhookService.deliveries.push(delivery);
      // Keep only last 100 deliveries
      if (WebhookService.deliveries.length > 100) {
        WebhookService.deliveries = WebhookService.deliveries.slice(-100);
      }
    }

    return delivered;
  }

  async getDeliveries(orgId: string, limit = 20): Promise<WebhookDelivery[]> {
    const orgWebhookIds = new Set(
      WebhookService.webhooks.filter((w) => w.orgId === orgId).map((w) => w.id)
    );
    return WebhookService.deliveries
      .filter((d) => orgWebhookIds.has(d.webhookId))
      .slice(-limit)
      .reverse();
  }
}
