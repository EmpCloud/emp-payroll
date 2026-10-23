import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const sessionReads: { operation: string; session: unknown }[] = [];
  function query(operation: string, result: unknown) {
    const chain = {
      session: vi.fn((session: unknown) => {
        sessionReads.push({ operation, session });
        return chain;
      }),
      lean: vi.fn(async () => result),
      skip: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      sort: vi.fn(() => chain),
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }
  const model = {
    findOne: vi.fn(() => query("findOne", { id: "item" })),
    find: vi.fn(() => query("find", [{ id: "item" }])),
    countDocuments: vi.fn(() => query("count", 1)),
    aggregate: vi.fn(() => query("sum", [{ total: 100 }])),
    create: vi.fn(async (rows: unknown[]) => rows.map((row) => ({ toObject: () => row }))),
    insertMany: vi.fn(async (rows: unknown[]) => rows.map((row) => ({ toObject: () => row }))),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ modifiedCount: 1 })),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
  };
  function session() {
    let active = false;
    return {
      startTransaction: vi.fn(() => {
        active = true;
      }),
      inTransaction: vi.fn(() => active),
      commitTransaction: vi.fn(async () => {
        active = false;
      }),
      abortTransaction: vi.fn(async () => {
        active = false;
      }),
      endSession: vi.fn(async () => {}),
    };
  }
  const mongoose = {
    connect: vi.fn(() => {
      throw new Error("Live Mongo connection forbidden in unit tests");
    }),
    model: vi.fn(() => model),
    startSession: vi.fn(async () => session()),
    connection: { db: { command: vi.fn(async () => ({ ok: 1 })) } },
  };
  class Schema {
    index = vi.fn();
  }
  return { mongoose, Schema, model, session, sessionReads };
});

vi.mock("mongoose", () => ({ default: fixture.mongoose, Schema: fixture.Schema }));
import { MongoAdapter } from "./mongo.adapter";

describe("Mongo transaction session scope without a live database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.sessionReads.length = 0;
  });

  it("passes one transaction session to every adapter read and write across awaits", async () => {
    const adapter = new MongoAdapter({ uri: "mongodb://never-connect" });
    const session = fixture.session();
    fixture.mongoose.startSession.mockResolvedValueOnce(session);
    await adapter.transaction(async () => {
      await Promise.resolve();
      await adapter.findById("global_payroll_items", "item");
      await adapter.findOne("global_payroll_items", { id: "item" });
      await adapter.findMany("global_payroll_items", { filters: { empcloud_org_id: 1 } });
      await adapter.create("global_payroll_items", { id: "new" });
      await adapter.createMany("global_payroll_items", [{ id: "new2" }]);
      await adapter.update("global_payroll_items", "item", { amount: 100 });
      await adapter.updateMany("global_payroll_items", { id: "item" }, { amount: 100 });
      await adapter.delete("global_payroll_items", "item");
      await adapter.deleteMany("global_payroll_items", { id: "item" });
      expect(await adapter.count("global_payroll_items")).toBe(1);
      expect(await adapter.sum("global_payroll_items", "amount")).toBe(100);
      await adapter.raw('{"ping":1}');
    });
    expect(fixture.sessionReads.length).toBeGreaterThan(6);
    expect(fixture.sessionReads.every((entry) => entry.session === session)).toBe(true);
    expect(fixture.model.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(fixture.model.insertMany).toHaveBeenCalledWith(expect.any(Array), { session });
    for (const method of [fixture.model.updateOne, fixture.model.updateMany]) {
      expect(method).toHaveBeenCalledWith({ id: "item" }, { $set: { amount: 100 } }, { session });
    }
    for (const method of [fixture.model.deleteOne, fixture.model.deleteMany]) {
      expect(method).toHaveBeenCalledWith({ id: "item" }, { session });
    }
    expect(fixture.mongoose.connection.db.command).toHaveBeenCalledWith({ ping: 1 }, { session });
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
    await adapter.findById("global_payroll_items", "outside");
    expect(fixture.sessionReads.at(-1)?.session).toBeNull();
  });

  it("isolates concurrent request sessions and leaves unrelated requests outside transactions", async () => {
    const adapter = new MongoAdapter({ uri: "mongodb://never-connect" });
    const first = fixture.session(),
      second = fixture.session();
    fixture.mongoose.startSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const firstWork = adapter.transaction(async () => {
      started();
      await gate;
      await adapter.findOne("global_payroll_items", { id: "first" });
      expect(fixture.sessionReads.at(-1)?.session).toBe(first);
    });
    await ready;
    await adapter.findOne("global_payroll_items", { id: "outside" });
    expect(fixture.sessionReads.at(-1)?.session).toBeNull();
    await adapter.transaction(async () => {
      await Promise.resolve();
      await adapter.findOne("global_payroll_items", { id: "second" });
      expect(fixture.sessionReads.at(-1)?.session).toBe(second);
    });
    release();
    await firstWork;
    expect(first.commitTransaction).toHaveBeenCalledTimes(1);
    expect(second.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it("aborts and ends the session after a failed write, preserving the error and clearing context", async () => {
    const adapter = new MongoAdapter({ uri: "mongodb://never-connect" });
    const session = fixture.session();
    const failure = new Error("Audit insert failed");
    fixture.mongoose.startSession.mockResolvedValueOnce(session);
    fixture.model.create.mockRejectedValueOnce(failure);
    await expect(
      adapter.transaction(async () => {
        await adapter.create("uae_payroll_events", { id: "event" });
      }),
    ).rejects.toBe(failure);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
    await adapter.findById("global_payroll_items", "outside");
    expect(fixture.sessionReads.at(-1)?.session).toBeNull();
  });

  it("does not commit after an explicit rollback and propagates a failed commit", async () => {
    const adapter = new MongoAdapter({ uri: "mongodb://never-connect" });
    const rolledBack = fixture.session();
    fixture.mongoose.startSession.mockResolvedValueOnce(rolledBack);
    await adapter.transaction(async (ctx) => {
      await ctx.rollback();
    });
    expect(rolledBack.commitTransaction).not.toHaveBeenCalled();
    expect(rolledBack.abortTransaction).toHaveBeenCalledTimes(1);
    const failedCommit = fixture.session();
    failedCommit.commitTransaction.mockRejectedValueOnce(new Error("Commit failed"));
    fixture.mongoose.startSession.mockResolvedValueOnce(failedCommit);
    await expect(adapter.transaction(async () => "ready")).rejects.toThrow("Commit failed");
    expect(failedCommit.abortTransaction).toHaveBeenCalledTimes(1);
    expect(failedCommit.endSession).toHaveBeenCalledTimes(1);
  });

  it("keeps nested work in the ambient session so an outer failure cannot leave an inner commit", async () => {
    const adapter = new MongoAdapter({ uri: "mongodb://never-connect" });
    const session = fixture.session();
    fixture.mongoose.startSession.mockResolvedValueOnce(session);
    const failure = new Error("Outer operation failed");
    await expect(
      adapter.transaction(async () => {
        await adapter.transaction(async () => {
          await adapter.create("global_payroll_items", { id: "nested" });
        });
        expect(session.commitTransaction).not.toHaveBeenCalled();
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(fixture.mongoose.startSession).toHaveBeenCalledTimes(1);
    expect(fixture.model.create).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
