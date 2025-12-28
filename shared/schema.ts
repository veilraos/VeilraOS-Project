import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  signature: text("signature").notNull().unique(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  amount: numeric("amount", { precision: 20, scale: 9 }).notNull(),
  fee: numeric("fee", { precision: 20, scale: 9 }),
  status: text("status").notNull().default("pending"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  blockTime: integer("block_time"),
});

export const mixerSessions = pgTable("mixer_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderAddress: text("sender_address").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  amount: numeric("amount", { precision: 20, scale: 9 }).notNull(),
  depositSignature: text("deposit_signature"),
  payoutSignature: text("payout_signature"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  depositConfirmedAt: timestamp("deposit_confirmed_at"),
  payoutSentAt: timestamp("payout_sent_at"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  timestamp: true,
});

export const insertMixerSessionSchema = createInsertSchema(mixerSessions).omit({
  id: true,
  createdAt: true,
  depositConfirmedAt: true,
  payoutSentAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertMixerSession = z.infer<typeof insertMixerSessionSchema>;
export type MixerSession = typeof mixerSessions.$inferSelect;
