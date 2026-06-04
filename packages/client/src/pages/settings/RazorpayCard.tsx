import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { apiGet, apiPut, apiPost } from "@/api/client";
import { Banknote, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";

// Phase 1A — Connect & Test the org's RazorpayX account from the Settings
// page. No payouts yet. Secrets are write-only: the server never echoes them
// back; the UI receives only "hasKeySecret"/"hasWebhookSecret" booleans + a
// masked Key ID for confidence.

interface Cfg {
  enabled: boolean;
  keyId: string;
  keyIdMasked: string;
  accountNumber: string;
  defaultMode: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  verifiedAt: string | null;
}

export function RazorpayCard({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["razorpay-config", orgId],
    queryFn: () => apiGet<Cfg>(`/organizations/${orgId}/razorpay`),
    enabled: !!orgId,
  });
  const cfg = (data as any)?.data as Cfg | undefined;

  // Local form mirror. Secrets default to empty — typing a value rotates it;
  // leaving them blank preserves whatever's already saved on the server.
  const [enabled, setEnabled] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [defaultMode, setDefaultMode] = useState("IMPS");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    null | { ok: true; mode: string; verifiedAt: string } | { ok: false; message: string }
  >(null);

  // Hydrate the form whenever the config query refreshes.
  useEffect(() => {
    if (!cfg) return;
    setEnabled(cfg.enabled);
    setKeyId(cfg.keyId || "");
    setAccountNumber(cfg.accountNumber || "");
    setDefaultMode(cfg.defaultMode || "IMPS");
    setKeySecret("");
    setWebhookSecret("");
    setTestResult(null);
  }, [
    cfg?.enabled,
    cfg?.keyId,
    cfg?.accountNumber,
    cfg?.defaultMode,
    cfg?.hasKeySecret,
    cfg?.hasWebhookSecret,
    cfg?.verifiedAt,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const mode = inferMode(keyId);

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, any> = {
        enabled,
        keyId,
        accountNumber,
        defaultMode,
      };
      // Only send a secret field when the user actually typed something —
      // blank means "don't change", a non-empty string rotates the secret.
      if (keySecret) body.keySecret = keySecret;
      if (webhookSecret) body.webhookSecret = webhookSecret;
      await apiPut(`/organizations/${orgId}/razorpay`, body);
      toast.success("Razorpay settings saved");
      setKeySecret("");
      setWebhookSecret("");
      await qc.invalidateQueries({ queryKey: ["razorpay-config", orgId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Could not save Razorpay settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res: any = await apiPost(`/organizations/${orgId}/razorpay/test`, {});
      const data = res?.data || {};
      setTestResult({ ok: true, mode: data.mode || "unknown", verifiedAt: data.verifiedAt });
      toast.success(`Razorpay connected (${data.mode} mode)`);
      await qc.invalidateQueries({ queryKey: ["razorpay-config", orgId] });
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || "Razorpay connection test failed";
      setTestResult({ ok: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  const modeWarning =
    enabled && mode === "live" ? "Live keys detected — actual payouts will be triggered." : "";
  const cantTest = !cfg?.hasKeySecret && !keySecret;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5" /> Razorpay Payouts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="text-brand-600 h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-gray-500">
              Connect your organization's RazorpayX account. After a payroll run is computed,
              salaries can be pushed to Razorpay for approval and payout. (Phase 1A — connect &amp;
              test only; payouts are not enabled yet.)
            </p>

            {/* Enable toggle */}
            <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="text-brand-600 focus:ring-brand-500 mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">
                Enable Razorpay payouts for this organization
                <span className="mt-0.5 block text-xs text-gray-500">
                  When off, the Push-to-Razorpay button on payroll runs is hidden.
                </span>
              </span>
            </label>

            {/* Mode banner */}
            {mode !== "unknown" && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  mode === "live"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-blue-200 bg-blue-50 text-blue-800"
                }`}
              >
                {mode === "live" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                )}
                <span>
                  <strong>{mode === "live" ? "Live mode" : "Test mode"}</strong> — detected from the
                  Key ID prefix. {modeWarning}
                </span>
              </div>
            )}

            {/* Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                id="rzp_key_id"
                label="Key ID"
                placeholder="rzp_test_XXXXXXXXXXXX"
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
              />
              <Input
                id="rzp_account_number"
                label="Source Account Number"
                placeholder="e.g. 7878780080316316"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
              <Input
                id="rzp_key_secret"
                label={cfg?.hasKeySecret ? "Key Secret (rotate)" : "Key Secret"}
                type="password"
                placeholder={
                  cfg?.hasKeySecret ? "•••••• (saved — leave blank to keep)" : "Paste secret"
                }
                value={keySecret}
                onChange={(e) => setKeySecret(e.target.value)}
                autoComplete="off"
              />
              <Input
                id="rzp_webhook_secret"
                label={cfg?.hasWebhookSecret ? "Webhook Secret (rotate)" : "Webhook Secret"}
                type="password"
                placeholder={
                  cfg?.hasWebhookSecret ? "•••••• (saved — leave blank to keep)" : "Paste secret"
                }
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                autoComplete="off"
              />
              <SelectField
                id="rzp_mode"
                label="Default payout mode"
                value={defaultMode}
                onChange={(e) => setDefaultMode(e.target.value)}
                options={[
                  { value: "IMPS", label: "IMPS (instant, up to ₹5L)" },
                  { value: "NEFT", label: "NEFT" },
                  { value: "RTGS", label: "RTGS (≥ ₹2L)" },
                ]}
              />
              <div />
            </div>

            {/* Test result strip */}
            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                )}
                <span>
                  {testResult.ok
                    ? `Connected — ${testResult.mode} mode${
                        testResult.verifiedAt
                          ? `, verified at ${new Date(testResult.verifiedAt).toLocaleString()}`
                          : ""
                      }.`
                    : testResult.message}
                </span>
              </div>
            )}

            {/* Last verified badge */}
            {cfg?.verifiedAt && !testResult && (
              <p className="text-xs text-gray-500">
                Last verified: {new Date(cfg.verifiedAt).toLocaleString()}
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-4">
              <Button
                variant="outline"
                type="button"
                disabled={testing || cantTest}
                onClick={handleTest}
                title={cantTest ? "Save a Key Secret first, then test." : ""}
              >
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                Test Connection
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Razorpay settings
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function inferMode(keyId: string): "test" | "live" | "unknown" {
  const k = (keyId || "").trim();
  if (k.startsWith("rzp_test_")) return "test";
  if (k.startsWith("rzp_live_")) return "live";
  return "unknown";
}
