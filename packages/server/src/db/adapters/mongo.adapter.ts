// ============================================================================
// MONGOOSE (MongoDB) ADAPTER
// For teams that prefer a document DB. Same interface, zero business logic changes.
// ============================================================================

import mongoose, { Schema, Model, Document } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { IDBAdapter, QueryOptions, QueryResult, TransactionContext } from "./interface";

// Dynamic model registry — creates Mongoose models on the fly based on table name
const modelRegistry: Map<string, Model<any>> = new Map();

function getOrCreateModel(tableName: string): Model<any> {
  if (modelRegistry.has(tableName)) {
    return modelRegistry.get(tableName)!;
  }

  // Flexible schema — allows any fields (schemaless but with timestamps)
  const schema = new Schema({}, {
    strict: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    collection: tableName,
  });

  schema.index({ id: 1 }, { unique: true });

  const model = mongoose.model(tableName, schema);
  modelRegistry.set(tableName, model);
  return model;
}

export class MongoAdapter implements IDBAdapter {
  private uri: string;
  private connected = false;

  constructor(config: { uri: string }) {
    this.uri = config.uri;
  }

  async connect(): Promise<void> {
    await mongoose.connect(this.uri);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && mongoose.connection.readyState === 1;
  }

  async migrate(): Promise<void> {
    // MongoDB is schemaless — indexes are created on model registration
    // For structured migrations, use migrate-mongo package
  }

  async rollback(): Promise<void> {
    // No-op for MongoDB
  }

  async seed(seedName?: string): Promise<void> {
    // Implement with seed files in src/db/seeds/mongo/
  }

  async findById<T>(table: string, id: string): Promise<T | null> {
    const model = getOrCreateModel(table);
    const doc = await model.findOne({ id }).lean();
    return doc ? this.cleanDoc<T>(doc) : null;
  }

  async findOne<T>(table: string, where: Record<string, any>): Promise<T | null> {
    const model = getOrCreateModel(table);
    const doc = await model.findOne(where).lean();
    return doc ? this.cleanDoc<T>(doc) : null;
  }

  async findMany<T>(table: string, options?: QueryOptions): Promise<QueryResult<T>> {
    const model = getOrCreateModel(table);
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    let query: Record<string, any> = {};
    if (options?.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        if (value === null) {
          query[key] = null;
        } else if (Array.isArray(value)) {
          query[key] = { $in: value };
        } else if (typeof value === "object" && value.op) {
          const opMap: Record<string, string> = { ">": "$gt", ">=": "$gte", "<": "$lt", "<=": "$lte", "!=": "$ne" };
          query[key] = { [opMap[value.op] || "$eq"]: value.value };
        } else {
          query[key] = value;
        }
      }
    }

    const total = await model.countDocuments(query);

    let cursor = model.find(query).skip(skip).limit(limit);
    if (options?.sort) {
      cursor = cursor.sort({ [options.sort.field]: options.sort.order === "asc" ? 1 : -1 });
    } else {
      cursor = cursor.sort({ created_at: -1 });
    }

    const docs = await cursor.lean();

    return {
      data: docs.map((d: any) => this.cleanDoc<T>(d)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create<T>(table: string, data: Partial<T>): Promise<T> {
    const model = getOrCreateModel(table);
    const id = (data as any).id || uuidv4();
    const doc = await model.create({ ...data, id });
    return this.cleanDoc<T>(doc.toObject());
  }

  async createMany<T>(table: string, data: Partial<T>[]): Promise<T[]> {
    const model = getOrCreateModel(table);
    const records = data.map((d) => ({ ...d, id: (d as any).id || uuidv4() }));
    const docs = await model.insertMany(records);
    return docs.map((d: any) => this.cleanDoc<T>(d.toObject()));
  }

  async update<T>(table: string, id: string, data: Partial<T>): Promise<T> {
    const model = getOrCreateModel(table);
    delete (data as any).id;
    await model.updateOne({ id }, { $set: data });
    return this.findById<T>(table, id) as Promise<T>;
  }

  async updateMany(table: string, where: Record<string, any>, data: Record<string, any>): Promise<number> {
    const model = getOrCreateModel(table);
    const result = await model.updateMany(where, { $set: data });
    return result.modifiedCount;
  }

  async delete(table: string, id: string): Promise<boolean> {
    const model = getOrCreateModel(table);
    const result = await model.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async deleteMany(table: string, where: Record<string, any>): Promise<number> {
    const model = getOrCreateModel(table);
    const result = await model.deleteMany(where);
    return result.deletedCount;
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    const model = getOrCreateModel(table);
    return model.countDocuments(where || {});
  }

  async sum(table: string, field: string, where?: Record<string, any>): Promise<number> {
    const model = getOrCreateModel(table);
    const pipeline: any[] = [];
    if (where) pipeline.push({ $match: where });
    pipeline.push({ $group: { _id: null, total: { $sum: `$${field}` } } });
    const result = await model.aggregate(pipeline);
    return result[0]?.total || 0;
  }

  async transaction<T>(fn: (trx: TransactionContext) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const ctx: TransactionContext = {
        commit: async () => { await session.commitTransaction(); },
        rollback: async () => { await session.abortTransaction(); },
      };
      const result = await fn(ctx);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async raw<T>(query: string, params?: any[]): Promise<T> {
    // For MongoDB, raw queries use the native driver
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");
    return db.command(JSON.parse(query)) as T;
  }

  private cleanDoc<T>(doc: any): T {
    const { _id, __v, ...rest } = doc;
    return rest as T;
  }
}
