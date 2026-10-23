import { describe, expect, it, vi } from "vitest";
import { KnexAdapter } from "./knex.adapter";

function fixture() {
  const outside = { first: vi.fn(async () => ({ id: "outside" })) };
  const inside = { first: vi.fn(async () => ({ id: "inside" })) };
  const database = Object.assign(
    vi.fn(() => ({ where: () => outside })),
    { transaction: vi.fn() },
  );
  const transaction = Object.assign(
    vi.fn(() => ({ where: () => inside })),
    { commit: vi.fn(), rollback: vi.fn() },
  );
  database.transaction.mockImplementation(async (callback) => callback(transaction));
  const adapter = new KnexAdapter({
    client: "mysql2",
    host: "unused",
    port: 3306,
    user: "unused",
    password: "",
    database: "unused",
  });
  Object.assign(adapter, { db: database });
  return { adapter, database, transaction };
}

describe("Knex transaction connection scope", () => {
  it("uses the transaction for adapter CRUD across awaits and restores the outer connection", async () => {
    const { adapter, database, transaction } = fixture();
    await adapter.transaction(async () => {
      await Promise.resolve();
      expect(await adapter.findOne("global_payroll_runs", { id: "run" })).toEqual({ id: "inside" });
      expect(await adapter.findById("global_payroll_items", "item")).toEqual({ id: "inside" });
    });
    expect(await adapter.findById("global_payroll_runs", "run")).toEqual({ id: "outside" });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(database).toHaveBeenCalledTimes(1);
  });

  it("does not leak an open transaction into concurrent requests", async () => {
    const { adapter } = fixture();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = adapter.transaction(async () => {
      started();
      await gate;
      expect(await adapter.findById("global_payroll_runs", "a")).toEqual({ id: "inside" });
    });
    await ready;
    expect(await adapter.findById("global_payroll_runs", "b")).toEqual({ id: "outside" });
    release();
    await work;
  });

  it("propagates a failed payroll operation to Knex rollback and clears transaction scope", async () => {
    const { adapter } = fixture();
    const failure = new Error("payroll item insert failed");
    await expect(
      adapter.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await adapter.findById("global_payroll_runs", "run")).toEqual({ id: "outside" });
  });
});
