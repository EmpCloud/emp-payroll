/**
 * EMP Payroll — Infrastructure coverage tests.
 * API helpers (wrap, param).
 */
import { describe, it, expect, vi } from "vitest";
import { param } from "../api/helpers";

describe("API helpers", () => {
  describe("param()", () => {
    it("extracts string param", () => {
      const req = { params: { id: "42" } } as any;
      expect(param(req, "id")).toBe("42");
    });

    it("returns first element of array param", () => {
      const req = { params: { id: ["a", "b"] } } as any;
      expect(param(req, "id")).toBe("a");
    });

    it("returns undefined for missing param", () => {
      const req = { params: {} } as any;
      expect(param(req, "nope")).toBeUndefined();
    });
  });
});
