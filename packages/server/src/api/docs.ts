import { Request, Response } from "express";
import { discoveredPaths } from "./route-recorder";

const apiDoc = {
  openapi: "3.0.3",
  info: {
    title: "EMP Payroll API",
    version: "0.1.0",
    description:
      "Open-source payroll management API — India statutory compliance (PF, ESI, PT, TDS)",
  },
  servers: [{ url: "/api/v1", description: "API v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ApiResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "object" },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login",
        security: [],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { email: { type: "string" }, password: { type: "string" } },
                required: ["email", "password"],
              },
            },
          },
        },
        responses: { "200": { description: "JWT tokens + user data" } },
      },
    },
    "/auth/register": {
      post: { tags: ["Auth"], summary: "Register new user", security: [] },
    },
    "/auth/refresh-token": {
      post: { tags: ["Auth"], summary: "Refresh JWT tokens", security: [] },
    },
    "/auth/change-password": {
      post: { tags: ["Auth"], summary: "Change password (authenticated)" },
    },
    "/employees": {
      get: {
        tags: ["Employees"],
        summary: "List employees",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "department", in: "query", schema: { type: "string" } },
        ],
      },
      post: { tags: ["Employees"], summary: "Create employee" },
    },
    "/employees/{id}": {
      get: {
        tags: ["Employees"],
        summary: "Get employee by ID",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
      },
      put: { tags: ["Employees"], summary: "Update employee" },
      delete: { tags: ["Employees"], summary: "Deactivate employee" },
    },
    "/employees/{id}/bank-details": {
      get: { tags: ["Employees"], summary: "Get bank details" },
      put: { tags: ["Employees"], summary: "Update bank details" },
    },
    "/employees/{id}/tax-info": {
      get: { tags: ["Employees"], summary: "Get tax info" },
      put: { tags: ["Employees"], summary: "Update tax info" },
    },
    "/employees/{id}/pf-details": {
      get: { tags: ["Employees"], summary: "Get PF details" },
      put: { tags: ["Employees"], summary: "Update PF details" },
    },
    "/employees/export": { get: { tags: ["Employees"], summary: "Export employees CSV" } },
    "/salary-structures": {
      get: { tags: ["Salary"], summary: "List salary structures" },
      post: { tags: ["Salary"], summary: "Create salary structure with components" },
    },
    "/salary-structures/{id}": {
      get: { tags: ["Salary"], summary: "Get salary structure" },
      put: { tags: ["Salary"], summary: "Update salary structure" },
      delete: { tags: ["Salary"], summary: "Delete salary structure" },
    },
    "/salary-structures/{id}/components": {
      get: { tags: ["Salary"], summary: "List components" },
      post: { tags: ["Salary"], summary: "Add component" },
    },
    "/salary-structures/assign": {
      post: { tags: ["Salary"], summary: "Assign salary to employee" },
    },
    "/salary-structures/employee/{empId}": {
      get: { tags: ["Salary"], summary: "Get employee salary" },
    },
    "/payroll": {
      get: { tags: ["Payroll"], summary: "List payroll runs" },
      post: {
        tags: ["Payroll"],
        summary: "Create payroll run",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  month: { type: "integer" },
                  year: { type: "integer" },
                  payDate: { type: "string", format: "date" },
                },
              },
            },
          },
        },
      },
    },
    "/payroll/{id}": { get: { tags: ["Payroll"], summary: "Get payroll run" } },
    "/payroll/{id}/compute": {
      post: { tags: ["Payroll"], summary: "Compute payroll (generates payslips)" },
    },
    "/payroll/{id}/approve": { post: { tags: ["Payroll"], summary: "Approve payroll run" } },
    "/payroll/{id}/pay": { post: { tags: ["Payroll"], summary: "Mark as paid" } },
    "/payroll/{id}/cancel": { post: { tags: ["Payroll"], summary: "Cancel payroll run" } },
    "/payroll/{id}/payslips": { get: { tags: ["Payroll"], summary: "List payslips for run" } },
    "/payroll/{id}/reports/bank-file": {
      get: { tags: ["Payroll"], summary: "Download bank transfer CSV" },
    },
    "/payslips": { get: { tags: ["Payslips"], summary: "List all payslips" } },
    "/payslips/{id}": { get: { tags: ["Payslips"], summary: "Get payslip" } },
    "/payslips/{id}/pdf": { get: { tags: ["Payslips"], summary: "Generate payslip PDF (HTML)" } },
    "/payslips/export/csv": { get: { tags: ["Payslips"], summary: "Export payslips CSV" } },
    "/payslips/employee/{empId}": {
      get: { tags: ["Payslips"], summary: "Employee payslip history" },
    },
    "/tax/computation/{empId}": { get: { tags: ["Tax"], summary: "Get tax computation" } },
    "/tax/computation/{empId}/compute": { post: { tags: ["Tax"], summary: "Compute tax" } },
    "/tax/declarations/{empId}": {
      get: { tags: ["Tax"], summary: "Get declarations" },
      post: { tags: ["Tax"], summary: "Submit declarations" },
    },
    "/tax/regime/{empId}": {
      get: { tags: ["Tax"], summary: "Get tax regime" },
      put: { tags: ["Tax"], summary: "Update tax regime" },
    },
    "/attendance/summary/{empId}": {
      get: { tags: ["Attendance"], summary: "Get attendance summary" },
    },
    "/attendance/import": { post: { tags: ["Attendance"], summary: "Import attendance records" } },
    "/organizations/{id}": {
      get: { tags: ["Organization"], summary: "Get organization" },
      put: { tags: ["Organization"], summary: "Update organization" },
    },
    "/organizations/{id}/settings": {
      get: { tags: ["Organization"], summary: "Get settings" },
      put: { tags: ["Organization"], summary: "Update settings" },
    },
    "/organizations/{id}/activity": { get: { tags: ["Organization"], summary: "Get audit log" } },
    "/self-service/dashboard": { get: { tags: ["Self-Service"], summary: "Employee dashboard" } },
    "/self-service/payslips": { get: { tags: ["Self-Service"], summary: "My payslips" } },
    "/self-service/salary": { get: { tags: ["Self-Service"], summary: "My salary" } },
    "/self-service/tax/computation": {
      get: { tags: ["Self-Service"], summary: "My tax computation" },
    },
    "/self-service/tax/declarations": {
      get: { tags: ["Self-Service"], summary: "My declarations" },
      post: { tags: ["Self-Service"], summary: "Submit declaration" },
    },
    "/self-service/profile": { get: { tags: ["Self-Service"], summary: "My profile" } },
  },
};

// Merge auto-discovered routes into the curated spec. The spec server is
// "/api/v1", so paths are relative to it — strip that prefix from discovered
// full paths and skip anything outside /api/v1 (infra routes like /health).
// Hand-written operations keep their detail; the rest get tagged stubs.
let cachedDoc: unknown = null;

function buildCompleteDoc(): unknown {
  const merged: any = { ...apiDoc, paths: { ...(apiDoc as any).paths } };
  for (const { path, methods } of discoveredPaths()) {
    if (!path.startsWith("/api/v1/")) continue;
    const rel = path.slice("/api/v1".length);
    const node = (merged.paths[rel] = merged.paths[rel] || {});
    const seg = rel.split("/").filter(Boolean);
    const tag = (seg[0] || "general").replace(/^./, (c) => c.toUpperCase());
    for (const method of methods) {
      if (method === "head" || method === "options" || node[method]) continue;
      const params = Array.from(rel.matchAll(/\{([A-Za-z0-9_]+)\}/g)).map((m) => ({
        name: m[1],
        in: "path",
        required: true,
        schema: { type: "string" as const },
      }));
      node[method] = {
        tags: [tag],
        summary: `${method.toUpperCase()} ${rel}`,
        ...(params.length ? { parameters: params } : {}),
        responses: { "200": { description: "OK" } },
      };
    }
  }
  return merged;
}

export function apiDocsHandler(_req: Request, res: Response) {
  if (!cachedDoc) cachedDoc = buildCompleteDoc();
  res.json(cachedDoc);
}

// Self-hosted Swagger UI — assets served same-origin from /api/v1/docs/ui
// (express.static of swagger-ui-dist in index.ts) instead of the unpkg CDN,
// which the proxy/helmet CSP ('self') blocks. A permissive per-response CSP
// (set here, with /api/v1/docs excluded from the global helmet CSP) lets the
// inline initializer + Swagger's inline styles run.
export function swaggerUIHandler(_req: Request, res: Response) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
    ].join("; "),
  );
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><title>EMP Payroll API Docs</title>
<link rel="stylesheet" href="/api/v1/docs/ui/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="/api/v1/docs/ui/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/v1/docs/openapi.json', dom_id: '#swagger-ui', deepLinking: true })</script>
</body></html>`);
}
