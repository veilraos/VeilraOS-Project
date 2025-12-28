import { 
  type User, 
  type InsertUser, 
  type Transaction, 
  type InsertTransaction,
  type MixerSession,
  type InsertMixerSession,
  users,
  transactions,
  mixerSessions
} from "@shared/schema";
import { db } from "./db";
import { eq, or, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getTransactionsByAddress(address: string): Promise<Transaction[]>;
  getTransactionBySignature(signature: string): Promise<Transaction | undefined>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createMixerSession(session: InsertMixerSession): Promise<MixerSession>;
  getMixerSession(id: string): Promise<MixerSession | undefined>;
  getMixerSessionsByAddress(address: string): Promise<MixerSession[]>;
  updateMixerSession(id: string, updates: Partial<MixerSession>): Promise<MixerSession | undefined>;
  getPendingMixerSessions(): Promise<MixerSession[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getTransactionsByAddress(address: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        or(
          eq(transactions.fromAddress, address),
          eq(transactions.toAddress, address)
        )
      )
      .orderBy(desc(transactions.timestamp));
  }

  async getTransactionBySignature(signature: string): Promise<Transaction | undefined> {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.signature, signature));
    return tx || undefined;
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const [tx] = await db
      .insert(transactions)
      .values(insertTransaction)
      .returning();
    return tx;
  }

  async createMixerSession(insertSession: InsertMixerSession): Promise<MixerSession> {
    const [session] = await db
      .insert(mixerSessions)
      .values(insertSession)
      .returning();
    return session;
  }

  async getMixerSession(id: string): Promise<MixerSession | undefined> {
    const [session] = await db
      .select()
      .from(mixerSessions)
      .where(eq(mixerSessions.id, id));
    return session || undefined;
  }

  async getMixerSessionsByAddress(address: string): Promise<MixerSession[]> {
    return await db
      .select()
      .from(mixerSessions)
      .where(eq(mixerSessions.senderAddress, address))
      .orderBy(desc(mixerSessions.createdAt));
  }

  async updateMixerSession(id: string, updates: Partial<MixerSession>): Promise<MixerSession | undefined> {
    const [session] = await db
      .update(mixerSessions)
      .set(updates)
      .where(eq(mixerSessions.id, id))
      .returning();
    return session || undefined;
  }

  async getPendingMixerSessions(): Promise<MixerSession[]> {
    return await db
      .select()
      .from(mixerSessions)
      .where(eq(mixerSessions.status, "deposit_confirmed"))
      .orderBy(mixerSessions.depositConfirmedAt);
  }
}

export const storage = new DatabaseStorage();
