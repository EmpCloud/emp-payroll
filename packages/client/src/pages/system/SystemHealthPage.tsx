import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Database,
  Server,
  HardDrive,
  Clock,
  RefreshCw,
  Loader2,
  Activity,
  Users,
  FileText,
  Play,
} from "lucide-react";
import { apiGet } from "@/api/client";

export function SystemHealthPage() {
  // #147 — Use the shared axios client so the health check rides on the same
  // base URL + credentials as every other API call. The old raw fetch stripped
  // `/api/v1` from VITE_API_URL and hit `/health/detailed` at the root — which
  // in production isn't routed to the payroll server (only `/api/v1/*` is),
  // so the System tab always showed "Server unreachable". Server also exposes
  // health under `/api/v1/system/health/detailed` to match.
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await apiGet<any>("/system/health/detailed");
      return (res as any)?.data ?? res;
    },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        description="Server status and diagnostics"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-400" />
            <p className="mt-4 text-red-600">Server unreachable</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status banner */}
          <Card
            className={
              data.status === "healthy"
                ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                : "border-red-200 bg-red-50"
            }
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                {data.status === "healthy" ? (
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                ) : (
                  <XCircle className="h-6 w-6 text-red-600" />
                )}
                <div>
                  <p className="font-semibold text-gray-900">
                    System is {data.status === "healthy" ? "Healthy" : "Degraded"}
                  </p>
                  <p className="text-sm text-gray-500">
                    Response time: {data.responseTime} | Environment: {data.environment} | Version:{" "}
                    {data.version}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Database */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
                    <Database className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Database</p>
                    <div className="flex items-center gap-2">
                      <Badge variant={data.checks?.database?.status === "ok" ? "active" : "danger"}>
                        {data.checks?.database?.status || "unknown"}
                      </Badge>
                      {data.checks?.database?.latency && (
                        <span className="text-xs text-gray-400">
                          {data.checks.database.latency}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {data.checks?.database?.provider || "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Memory */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-950">
                    <HardDrive className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Memory</p>
                    <p className="text-sm font-semibold">{data.checks?.memory?.heapUsed || "—"}</p>
                    <p className="text-xs text-gray-400">
                      of {data.checks?.memory?.heapTotal || "—"} heap |{" "}
                      {data.checks?.memory?.rss || "—"} RSS
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Uptime */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-green-50 p-2 dark:bg-green-950">
                    <Clock className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Uptime</p>
                    <p className="text-sm font-semibold">{data.checks?.uptime?.formatted || "—"}</p>
                    <p className="text-xs text-gray-400">
                      {data.checks?.uptime?.process || "—"} seconds
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data counts */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-orange-50 p-2 dark:bg-orange-950">
                    <Activity className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Data</p>
                    <div className="flex gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {data.checks?.data?.employees ?? "—"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Play className="h-3 w-3" /> {data.checks?.data?.payrollRuns ?? "—"}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" /> {data.checks?.data?.payslips ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Raw JSON */}
          <Card>
            <CardHeader>
              <CardTitle>Raw Health Response</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-green-400">
                {JSON.stringify(data, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
