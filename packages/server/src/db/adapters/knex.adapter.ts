// ============================================================================
// KNEX SQL ADAPTER — supports MySQL, PostgreSQL, SQLite
// Uses Knex.js as the query builder. Switch between MySQL/PG by changing
// the DB_CLIENT env variable. Zero business logic changes needed.
// ============================================================================

import knex, { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { IDBAdapter, QueryOptions, QueryResult, TransactionContext } from "./interface";

export class KnexAdapter implements IDBAdapter {
  private db: Knex | null = null;
  private config: Knex.Config;

  constructor(config: {
    client: "mysql2" | "pg" | "sqlite3";
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    pool?: { min: number; max: number };
  }) {
    this.config = {
      client: config.client,
      connection: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
      },
      pool: config.pool || { min: 2, max: 10 },
      migrations: {
        directory: "./src/db/migrations/sql",
        extension: "ts",
      },
      seeds: {
        directory: "./src/db/seeds/sql",
        extension: "ts",
      },
    };
  }

  async connect(): Promise<void> {
    // Ensure the database exists before connecting to it
    const conn = this.config.connection as any;
    if (conn?.database) {
      const bootstrap = knex({
        client: this.config.client,
        connection: {
          host: conn.host,
          port: conn.port,
          user: conn.user,
          password: conn.password,
        },
      });
      await bootstrap.raw(
        `CREATE DATABASE IF NOT EXISTS \`${conn.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await bootstrap.destroy();
    }

    this.db = knex(this.config);
    // Verify connection
    await this.db.raw("SELECT 1");
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  private getDb(): Knex {
    if (!this.db) throw new Error("Database not connected. Call connect() first.");
    return this.db;
  }

  // Migrations
  async migrate(): Promise<void> {
    await this.getDb().migrate.latest();
  }

  async rollback(): Promise<void> {
    await this.getDb().migrate.rollback();
  }

  async seed(seedName?: string): Promise<void> {
    await this.getDb().seed.run(seedName ? { specific: seedName } : undefined);
  }

  // CRUD
  async findById<T>(table: string, id: string): Promise<T | null> {
    const row = await this.getDb()(table).where({ id }).first();
    return (row as T) || null;
  }

  async findOne<T>(table: string, where: Record<string, any>): Promise<T | null> {
    const row = await this.getDb()(table).where(where).first();
    return (row as T) || null;
  }

  async findMany<T>(table: string, options?: QueryOptions): Promise<QueryResult<T>> {
    const db = this.getDb();
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = db(table);

    // Apply filters
    if (options?.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        if (value === null) {
          query = query.whereNull(key);
        } else if (Array.isArray(value)) {
          query = query.whereIn(key, value);
        } else if (typeof value === "object" && value.op) {
          query = query.where(key, value.op, value.value);
        } else {
          query = query.where(key, value);
        }
      }
    }

    // Get total count
    const [{ count: total }] = await query.clone().count("* as count");

    // Apply sort
    if (options?.sort) {
      query = query.orderBy(options.sort.field, options.sort.order);
    } else {
      query = query.orderBy("created_at", "desc");
    }

    // Apply pagination
    const data = await query.limit(limit).offset(offset);

    return {
      data: data as T[],
      total: Number(total),
      page,
      limit,
      totalPages: Math.ceil(Number(total) / limit),
    };
  }

  async create<T>(table: string, data: Partial<T>): Promise<T> {
    const id = (data as any).id || uuidv4();
    const now = new Date();
    const record = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
    };

    await this.getDb()(table).insert(record);
    return this.findById<T>(table, id) as Promise<T>;
  }

  async createMany<T>(table: string, data: Partial<T>[]): Promise<T[]> {
    const now = new Date();
    const records = data.map((d) => ({
      ...d,
      id: (d as any).id || uuidv4(),
      created_at: now,
      updated_at: now,
    }));

    await this.getDb().batchInsert(table, records as any[], 500);
    const ids = records.map((r) => r.id);
    return this.getDb()(table).whereIn("id", ids);
  }

  async update<T>(table: string, id: string, data: Partial<T>): Promise<T> {
    const record = { ...data, updated_at: new Date() };
    delete (record as any).id;
    delete (record as any).created_at;

    await this.getDb()(table).where({ id }).update(record);
    return this.findById<T>(table, id) as Promise<T>;
  }

  async updateMany(
    table: string,
    where: Record<string, any>,
    data: Record<string, any>,
  ): Promise<number> {
    return this.getDb()(table)
      .where(where)
      .update({ ...data, updated_at: new Date() });
  }

  async delete(table: string, id: string): Promise<boolean> {
    const count = await this.getDb()(table).where({ id }).del();
    return count > 0;
  }

  async deleteMany(table: string, where: Record<string, any>): Promise<number> {
    return this.getDb()(table).where(where).del();
  }

  // Aggregations
  async count(table: string, where?: Record<string, any>): Promise<number> {
    let query = this.getDb()(table);
    if (where) query = query.where(where);
    const [{ count }] = await query.count("* as count");
    return Number(count);
  }

  async sum(table: string, field: string, where?: Record<string, any>): Promise<number> {
    let query = this.getDb()(table);
    if (where) query = query.where(where);
    const [{ total }] = await query.sum(`${field} as total`);
    return Number(total) || 0;
  }

  // Transactions
  async transaction<T>(fn: (trx: TransactionContext) => Promise<T>): Promise<T> {
    const db = this.getDb();
    return db.transaction(async (trx) => {
      const ctx: TransactionContext = {
        commit: async () => {
          await trx.commit();
        },
        rollback: async () => {
          await trx.rollback();
        },
      };
      return fn(ctx);
    });
  }

  // Raw
  async raw<T>(query: string, params?: any[]): Promise<T> {
    const result = await this.getDb().raw(query, params || []);
    return result as T;
  }
}
