import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTransactionSchema, insertMixerSessionSchema } from "@shared/schema";
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Keypair, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction 
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

let poolWallet: Keypair | null = null;
let poolAddress: string | null = null;

function initializePoolWallet() {
  const privateKeyBase58 = process.env.POOL_WALLET_PRIVATE_KEY;
  if (privateKeyBase58) {
    try {
      const secretKey = bs58.decode(privateKeyBase58);
      poolWallet = Keypair.fromSecretKey(secretKey);
      poolAddress = poolWallet.publicKey.toBase58();
      console.log("Pool wallet initialized:", poolAddress);
    } catch (error) {
      console.error("Failed to initialize pool wallet:", error);
    }
  } else {
    console.warn("POOL_WALLET_PRIVATE_KEY not set - mixer functionality disabled");
  }
}

initializePoolWallet();

async function verifyTransaction(
  signature: string, 
  fromAddress: string, 
  toAddress: string, 
  amount: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return { valid: false, error: "Transaction not found on chain" };
    }

    if (txInfo.meta?.err) {
      return { valid: false, error: "Transaction failed on chain" };
    }

    const accountKeys = txInfo.transaction.message.getAccountKeys();
    const fromKey = accountKeys.get(0);
    const toKey = accountKeys.get(1);

    if (!fromKey || fromKey.toBase58() !== fromAddress) {
      return { valid: false, error: "Sender address mismatch" };
    }

    if (!toKey || toKey.toBase58() !== toAddress) {
      return { valid: false, error: "Recipient address mismatch" };
    }

    const preBalances = txInfo.meta?.preBalances || [];
    const postBalances = txInfo.meta?.postBalances || [];
    const transferredLamports = preBalances[0] - postBalances[0] - (txInfo.meta?.fee || 0);
    const expectedLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

    if (Math.abs(transferredLamports - expectedLamports) > 1000) {
      return { valid: false, error: "Amount mismatch" };
    }

    return { valid: true };
  } catch (error) {
    console.error("Error verifying transaction:", error);
    return { valid: false, error: "Failed to verify transaction on chain" };
  }
}

const NETWORK_FEE_LAMPORTS = 5000;

async function sendFromPool(recipientAddress: string, amountSol: number): Promise<string> {
  if (!poolWallet) {
    throw new Error("Pool wallet not initialized");
  }

  const recipientPubkey = new PublicKey(recipientAddress);
  const depositedLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const payoutLamports = depositedLamports - NETWORK_FEE_LAMPORTS;

  if (payoutLamports <= 0) {
    throw new Error("Amount too small to cover network fee");
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: poolWallet.publicKey,
      toPubkey: recipientPubkey,
      lamports: payoutLamports,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [poolWallet]);
  return signature;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/pool-address", async (req, res) => {
    if (!poolAddress) {
      return res.status(503).json({ error: "Pool wallet not configured" });
    }
    res.json({ poolAddress });
  });

  app.post("/api/mixer/sessions", async (req, res) => {
    try {
      if (!poolAddress) {
        return res.status(503).json({ error: "Pool wallet not configured" });
      }

      const { senderAddress, recipientAddress, amount } = req.body;

      if (!senderAddress || !recipientAddress || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      try {
        new PublicKey(senderAddress);
        new PublicKey(recipientAddress);
      } catch {
        return res.status(400).json({ error: "Invalid Solana address" });
      }

      const session = await storage.createMixerSession({
        senderAddress,
        recipientAddress,
        amount: amount.toString(),
        status: "pending",
      });

      res.status(201).json({
        sessionId: session.id,
        poolAddress,
        amount: session.amount,
        status: session.status,
      });
    } catch (error) {
      console.error("Error creating mixer session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.post("/api/mixer/sessions/:id/confirm-deposit", async (req, res) => {
    try {
      const { id } = req.params;
      const { depositSignature } = req.body;

      if (!depositSignature) {
        return res.status(400).json({ error: "Deposit signature required" });
      }

      const session = await storage.getMixerSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status !== "pending") {
        return res.status(400).json({ error: "Session not in pending state" });
      }

      const verification = await verifyTransaction(
        depositSignature,
        session.senderAddress,
        poolAddress!,
        session.amount
      );

      if (!verification.valid) {
        return res.status(400).json({ 
          error: "Deposit verification failed", 
          details: verification.error 
        });
      }

      await storage.updateMixerSession(id, {
        depositSignature,
        status: "deposit_confirmed",
        depositConfirmedAt: new Date(),
      });

      try {
        const payoutSignature = await sendFromPool(
          session.recipientAddress,
          parseFloat(session.amount)
        );

        const updatedSession = await storage.updateMixerSession(id, {
          payoutSignature,
          status: "completed",
          payoutSentAt: new Date(),
        });

        res.json({
          sessionId: id,
          status: "completed",
          depositSignature,
          payoutSignature,
        });
      } catch (payoutError: any) {
        console.error("Payout failed:", payoutError);
        await storage.updateMixerSession(id, {
          status: "payout_failed",
        });
        res.status(500).json({ 
          error: "Payout failed", 
          details: payoutError.message 
        });
      }
    } catch (error) {
      console.error("Error confirming deposit:", error);
      res.status(500).json({ error: "Failed to confirm deposit" });
    }
  });

  app.get("/api/mixer/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const session = await storage.getMixerSession(id);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json({
        sessionId: session.id,
        status: session.status,
        amount: session.amount,
        recipientAddress: session.recipientAddress,
        depositSignature: session.depositSignature,
        payoutSignature: session.payoutSignature,
        createdAt: session.createdAt,
      });
    } catch (error) {
      console.error("Error fetching session:", error);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  app.get("/api/mixer/sessions", async (req, res) => {
    try {
      const address = req.query.address as string;
      if (!address) {
        return res.status(400).json({ error: "Address parameter required" });
      }

      const sessions = await storage.getMixerSessionsByAddress(address);
      res.json(sessions.map(s => ({
        sessionId: s.id,
        status: s.status,
        amount: s.amount,
        recipientAddress: s.recipientAddress,
        depositSignature: s.depositSignature,
        payoutSignature: s.payoutSignature,
        createdAt: s.createdAt,
      })));
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.get("/api/transactions", async (req, res) => {
    try {
      const address = req.query.address as string;
      if (!address) {
        return res.status(400).json({ error: "Address parameter is required" });
      }

      try {
        new PublicKey(address);
      } catch {
        return res.status(400).json({ error: "Invalid Solana address format" });
      }

      const transactions = await storage.getTransactionsByAddress(address);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/:signature", async (req, res) => {
    try {
      const { signature } = req.params;
      const transaction = await storage.getTransactionBySignature(signature);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      console.error("Error fetching transaction:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const parsed = insertTransactionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid transaction data", 
          details: parsed.error.errors 
        });
      }

      const { signature, fromAddress, toAddress, amount } = parsed.data;

      const verification = await verifyTransaction(signature, fromAddress, toAddress, amount);
      if (!verification.valid) {
        return res.status(400).json({ 
          error: "Transaction verification failed", 
          details: verification.error 
        });
      }

      const transaction = await storage.createTransaction(parsed.data);
      res.status(201).json(transaction);
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Transaction already exists" });
      }
      console.error("Error creating transaction:", error);
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  return httpServer;
}
