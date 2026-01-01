import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertTransactionSchema, 
  insertMixerSessionSchema,
  agents,
  knowledgeNodes,
  knowledgeEdges,
  agentMatches,
  insertAgentSchema,
  insertKnowledgeNodeSchema,
  insertAgentMatchSchema,
  tradingBattles,
  battlePortfolios,
  battleTrades,
  battleRounds,
  insertTradingBattleSchema,
  insertBattlePortfolioSchema,
  insertBattleTradeSchema,
} from "@shared/schema";
import { getCryptoPrice } from "./services/priceService";
import { db } from "./db";
import { eq, desc, sql, count, avg } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Keypair, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction 
} from "@solana/web3.js";
import { ethers } from "ethers";
import { getSecureConfig } from "./secure-config";
import { startBattleScheduler } from "./services/battleScheduler";

const secureConfig = getSecureConfig();
const RPC_ENDPOINT = secureConfig.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");
console.log("Solana RPC connected:", RPC_ENDPOINT.substring(0, 40) + "...");

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = Math.floor(bytes[j] / 256);
      bytes[j] %= 256;
    }
    while (carry) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

let poolWallet: Keypair | null = null;
let poolAddress: string | null = null;
let poolInitialized = false;

function initializePoolWallet() {
  if (poolInitialized) return;
  
  const privateKeyBase58 = secureConfig.POOL_WALLET_PRIVATE_KEY;
  console.log("Initializing pool wallet, key available:", !!privateKeyBase58);
  
  if (privateKeyBase58) {
    try {
      const secretKey = decodeBase58(privateKeyBase58);
      poolWallet = Keypair.fromSecretKey(secretKey);
      poolAddress = poolWallet.publicKey.toBase58();
      console.log("Pool wallet initialized:", poolAddress);
      poolInitialized = true;
    } catch (error) {
      console.error("Failed to initialize pool wallet:", error);
    }
  } else {
    console.warn("POOL_WALLET_PRIVATE_KEY not set - mixer functionality disabled");
  }
}

initializePoolWallet();

const ETH_RPC_URL = secureConfig.ETH_RPC_URL || "https://eth.llamarpc.com";
const BNB_RPC_URL = secureConfig.BNB_RPC_URL || "https://bsc-dataseed.binance.org";

const ethProvider = new ethers.JsonRpcProvider(ETH_RPC_URL);
const bnbProvider = new ethers.JsonRpcProvider(BNB_RPC_URL);
console.log("ETH RPC connected:", ETH_RPC_URL.substring(0, 40) + "...");
console.log("BNB RPC connected:", BNB_RPC_URL.substring(0, 40) + "...");

let ethPoolWallet: ethers.Wallet | null = null;
let ethPoolAddress: string | null = null;
let bnbPoolWallet: ethers.Wallet | null = null;
let bnbPoolAddress: string | null = null;

function initializeEthPoolWallet() {
  const privateKey = secureConfig.ETH_POOL_WALLET_PRIVATE_KEY;
  if (privateKey) {
    try {
      ethPoolWallet = new ethers.Wallet(privateKey, ethProvider);
      ethPoolAddress = ethPoolWallet.address;
      console.log("ETH Pool wallet initialized:", ethPoolAddress);
    } catch (error) {
      console.error("Failed to initialize ETH pool wallet:", error);
    }
  } else {
    console.warn("ETH_POOL_WALLET_PRIVATE_KEY not set - ETH mixer functionality disabled");
  }
}

function initializeBnbPoolWallet() {
  const privateKey = secureConfig.BNB_POOL_WALLET_PRIVATE_KEY;
  if (privateKey) {
    try {
      bnbPoolWallet = new ethers.Wallet(privateKey, bnbProvider);
      bnbPoolAddress = bnbPoolWallet.address;
      console.log("BNB Pool wallet initialized:", bnbPoolAddress);
    } catch (error) {
      console.error("Failed to initialize BNB pool wallet:", error);
    }
  } else {
    console.warn("BNB_POOL_WALLET_PRIVATE_KEY not set - BNB mixer functionality disabled");
  }
}

initializeEthPoolWallet();
initializeBnbPoolWallet();

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

async function verifyEthTransaction(
  txHash: string,
  fromAddress: string,
  toAddress: string,
  amount: string,
  provider: ethers.JsonRpcProvider
): Promise<{ valid: boolean; error?: string; actualSender?: string }> {
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return { valid: false, error: "Transaction not found on chain" };
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status === 0) {
      return { valid: false, error: "Transaction failed on chain" };
    }

    if (fromAddress !== "pending" && tx.from.toLowerCase() !== fromAddress.toLowerCase()) {
      return { valid: false, error: "Sender address mismatch" };
    }

    if (tx.to?.toLowerCase() !== toAddress.toLowerCase()) {
      return { valid: false, error: "Recipient address mismatch" };
    }

    const expectedWei = ethers.parseEther(amount);
    const tolerance = ethers.parseEther("0.0001");
    const diff = tx.value > expectedWei ? tx.value - expectedWei : expectedWei - tx.value;
    if (diff > tolerance) {
      return { valid: false, error: "Amount mismatch", actualSender: tx.from };
    }

    return { valid: true, actualSender: tx.from };
  } catch (error) {
    console.error("Error verifying ETH/BNB transaction:", error);
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

async function sendFromPoolETH(recipientAddress: string, amountEth: number): Promise<string> {
  if (!ethPoolWallet) {
    throw new Error("ETH Pool wallet not initialized");
  }

  const depositedWei = ethers.parseEther(amountEth.toString());
  const gasFee = ethers.parseEther("0.001");
  const payoutWei = depositedWei - gasFee;

  if (payoutWei <= BigInt(0)) {
    throw new Error("Amount too small to cover network fee");
  }

  const tx = await ethPoolWallet.sendTransaction({
    to: recipientAddress,
    value: payoutWei,
  });

  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

async function sendFromPoolBNB(recipientAddress: string, amountBnb: number): Promise<string> {
  if (!bnbPoolWallet) {
    throw new Error("BNB Pool wallet not initialized");
  }

  const depositedWei = ethers.parseEther(amountBnb.toString());
  const gasFee = ethers.parseEther("0.0005");
  const payoutWei = depositedWei - gasFee;

  if (payoutWei <= BigInt(0)) {
    throw new Error("Amount too small to cover network fee");
  }

  const tx = await bnbPoolWallet.sendTransaction({
    to: recipientAddress,
    value: payoutWei,
  });

  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

function isValidEthAddress(address: string): boolean {
  return ethers.isAddress(address);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/rpc-endpoint", async (req, res) => {
    res.json({ rpcUrl: RPC_ENDPOINT });
  });

  app.get("/api/rpc-endpoint/:chain", async (req, res) => {
    const { chain } = req.params;
    switch (chain.toLowerCase()) {
      case "solana":
        res.json({ rpcUrl: RPC_ENDPOINT });
        break;
      case "ethereum":
      case "eth":
        res.json({ rpcUrl: ETH_RPC_URL });
        break;
      case "bnb":
      case "bsc":
        res.json({ rpcUrl: BNB_RPC_URL });
        break;
      default:
        res.status(400).json({ error: "Unsupported chain" });
    }
  });

  app.get("/api/pool-address", async (req, res) => {
    if (!poolAddress) {
      initializePoolWallet();
    }
    
    if (!poolAddress) {
      console.error("Pool address still not available after re-init attempt");
      return res.status(503).json({ error: "Pool wallet not configured" });
    }
    res.json({ poolAddress });
  });

  app.get("/api/pool-address/:chain", async (req, res) => {
    const { chain } = req.params;
    switch (chain.toLowerCase()) {
      case "solana":
        if (!poolAddress) {
          initializePoolWallet();
        }
        if (!poolAddress) {
          return res.status(503).json({ error: "Solana pool wallet not configured" });
        }
        res.json({ poolAddress });
        break;
      case "ethereum":
      case "eth":
        if (!ethPoolAddress) {
          initializeEthPoolWallet();
        }
        if (!ethPoolAddress) {
          return res.status(503).json({ error: "ETH pool wallet not configured" });
        }
        res.json({ poolAddress: ethPoolAddress });
        break;
      case "bnb":
      case "bsc":
        if (!bnbPoolAddress) {
          initializeBnbPoolWallet();
        }
        if (!bnbPoolAddress) {
          return res.status(503).json({ error: "BNB pool wallet not configured" });
        }
        res.json({ poolAddress: bnbPoolAddress });
        break;
      default:
        res.status(400).json({ error: "Unsupported chain" });
    }
  });

  app.get("/api/balance/:address", async (req, res) => {
    try {
      const { address } = req.params;
      
      try {
        new PublicKey(address);
      } catch {
        return res.status(400).json({ error: "Invalid Solana address" });
      }

      const publicKey = new PublicKey(address);
      const lamports = await connection.getBalance(publicKey);
      const balance = lamports / LAMPORTS_PER_SOL;
      
      res.json({ balance, lamports });
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  app.get("/api/balance/:chain/:address", async (req, res) => {
    try {
      const { chain, address } = req.params;
      
      switch (chain.toLowerCase()) {
        case "solana": {
          try {
            new PublicKey(address);
          } catch {
            return res.status(400).json({ error: "Invalid Solana address" });
          }
          const publicKey = new PublicKey(address);
          const lamports = await connection.getBalance(publicKey);
          const balance = lamports / LAMPORTS_PER_SOL;
          res.json({ balance, lamports });
          break;
        }
        case "ethereum":
        case "eth": {
          if (!isValidEthAddress(address)) {
            return res.status(400).json({ error: "Invalid Ethereum address" });
          }
          const weiBalance = await ethProvider.getBalance(address);
          const balance = parseFloat(ethers.formatEther(weiBalance));
          res.json({ balance, wei: weiBalance.toString() });
          break;
        }
        case "bnb":
        case "bsc": {
          if (!isValidEthAddress(address)) {
            return res.status(400).json({ error: "Invalid BNB address" });
          }
          const weiBalance = await bnbProvider.getBalance(address);
          const balance = parseFloat(ethers.formatEther(weiBalance));
          res.json({ balance, wei: weiBalance.toString() });
          break;
        }
        default:
          res.status(400).json({ error: "Unsupported chain" });
      }
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  app.post("/api/mixer/sessions", async (req, res) => {
    try {
      const { senderAddress, recipientAddress, amount, chain = "solana" } = req.body;

      if (!senderAddress || !recipientAddress || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let targetPoolAddress: string | null = null;

      switch (chain.toLowerCase()) {
        case "solana":
          if (!poolAddress) {
            return res.status(503).json({ error: "Solana pool wallet not configured" });
          }
          try {
            new PublicKey(senderAddress);
            new PublicKey(recipientAddress);
          } catch {
            return res.status(400).json({ error: "Invalid Solana address" });
          }
          targetPoolAddress = poolAddress;
          break;
        case "ethereum":
        case "eth":
          if (!ethPoolAddress) {
            return res.status(503).json({ error: "ETH pool wallet not configured" });
          }
          if (!isValidEthAddress(senderAddress) || !isValidEthAddress(recipientAddress)) {
            return res.status(400).json({ error: "Invalid Ethereum address" });
          }
          targetPoolAddress = ethPoolAddress;
          break;
        case "bnb":
        case "bsc":
          if (!bnbPoolAddress) {
            return res.status(503).json({ error: "BNB pool wallet not configured" });
          }
          if (!isValidEthAddress(senderAddress) || !isValidEthAddress(recipientAddress)) {
            return res.status(400).json({ error: "Invalid BNB address" });
          }
          targetPoolAddress = bnbPoolAddress;
          break;
        default:
          return res.status(400).json({ error: "Unsupported chain" });
      }

      const session = await storage.createMixerSession({
        chain: chain.toLowerCase(),
        senderAddress,
        recipientAddress,
        amount: amount.toString(),
        status: "pending",
      });

      res.status(201).json({
        sessionId: session.id,
        poolAddress: targetPoolAddress,
        amount: session.amount,
        status: session.status,
        chain: session.chain,
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

      const chain = session.chain || "solana";
      let verification: { valid: boolean; error?: string; actualSender?: string };
      let targetPoolAddress: string;

      switch (chain.toLowerCase()) {
        case "solana":
          targetPoolAddress = poolAddress!;
          verification = await verifyTransaction(
            depositSignature,
            session.senderAddress,
            targetPoolAddress,
            session.amount
          );
          break;
        case "ethereum":
        case "eth":
          targetPoolAddress = ethPoolAddress!;
          verification = await verifyEthTransaction(
            depositSignature,
            session.senderAddress,
            targetPoolAddress,
            session.amount,
            ethProvider
          );
          break;
        case "bnb":
        case "bsc":
          targetPoolAddress = bnbPoolAddress!;
          verification = await verifyEthTransaction(
            depositSignature,
            session.senderAddress,
            targetPoolAddress,
            session.amount,
            bnbProvider
          );
          break;
        default:
          return res.status(400).json({ error: "Unsupported chain" });
      }

      if (!verification.valid) {
        return res.status(400).json({ 
          error: "Deposit verification failed", 
          details: verification.error 
        });
      }

      const updateData: any = {
        depositSignature,
        status: "deposit_confirmed",
        depositConfirmedAt: new Date(),
      };
      
      if (session.senderAddress === "pending" && verification.actualSender) {
        updateData.senderAddress = verification.actualSender;
      }

      await storage.updateMixerSession(id, updateData);

      try {
        let payoutSignature: string;

        switch (chain.toLowerCase()) {
          case "solana":
            payoutSignature = await sendFromPool(
              session.recipientAddress,
              parseFloat(session.amount)
            );
            break;
          case "ethereum":
          case "eth":
            payoutSignature = await sendFromPoolETH(
              session.recipientAddress,
              parseFloat(session.amount)
            );
            break;
          case "bnb":
          case "bsc":
            payoutSignature = await sendFromPoolBNB(
              session.recipientAddress,
              parseFloat(session.amount)
            );
            break;
          default:
            throw new Error("Unsupported chain for payout");
        }

        await storage.updateMixerSession(id, {
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
        chain: session.chain,
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
        chain: s.chain,
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

  // ========================================
  // Hive Mind API Routes
  // ========================================

  // Lazy OpenAI client initialization to ensure env vars are available
  const getOpenAIClient = () => {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    console.log("OpenAI config - baseURL:", baseURL ? "set" : "not set", "apiKey:", apiKey ? "set" : "not set");
    return new OpenAI({ apiKey, baseURL });
  };

  // GET /api/hivemind/agents - List all agents sorted by Elo rating descending
  app.get("/api/hivemind/agents", async (req, res) => {
    try {
      const allAgents = await db
        .select()
        .from(agents)
        .orderBy(desc(agents.eloRating));
      res.json(allAgents);
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  });

  // POST /api/hivemind/agents - Create a new agent
  app.post("/api/hivemind/agents", async (req, res) => {
    try {
      const parsed = insertAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid agent data", 
          details: parsed.error.errors 
        });
      }

      const [agent] = await db
        .insert(agents)
        .values({
          name: parsed.data.name,
          persona: parsed.data.persona,
          eloRating: parsed.data.eloRating ?? 1000,
          totalMatches: parsed.data.totalMatches ?? 0,
          wins: parsed.data.wins ?? 0,
        })
        .returning();
      res.status(201).json(agent);
    } catch (error) {
      console.error("Error creating agent:", error);
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  // GET /api/hivemind/agents/:id - Get single agent details
  app.get("/api/hivemind/agents/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }
      res.json(agent);
    } catch (error) {
      console.error("Error fetching agent:", error);
      res.status(500).json({ error: "Failed to fetch agent" });
    }
  });

  // GET /api/hivemind/agents/:id/knowledge - Get agent's knowledge nodes and edges
  app.get("/api/hivemind/agents/:id/knowledge", async (req, res) => {
    try {
      const { id } = req.params;

      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.agentId, id))
        .orderBy(desc(knowledgeNodes.createdAt));

      const nodeIds = nodes.map(n => n.id);
      
      let edges: typeof knowledgeEdges.$inferSelect[] = [];
      if (nodeIds.length > 0) {
        const sourceEdges = await db
          .select()
          .from(knowledgeEdges)
          .where(sql`${knowledgeEdges.sourceNodeId} IN (${sql.join(nodeIds.map(id => sql`${id}`), sql`, `)})`);
        const targetEdges = await db
          .select()
          .from(knowledgeEdges)
          .where(sql`${knowledgeEdges.targetNodeId} IN (${sql.join(nodeIds.map(id => sql`${id}`), sql`, `)})`);
        
        const edgeMap = new Map<string, typeof knowledgeEdges.$inferSelect>();
        [...sourceEdges, ...targetEdges].forEach(e => edgeMap.set(e.id, e));
        edges = Array.from(edgeMap.values());
      }

      res.json({ nodes, edges });
    } catch (error) {
      console.error("Error fetching agent knowledge:", error);
      res.status(500).json({ error: "Failed to fetch knowledge" });
    }
  });

  // POST /api/hivemind/agents/:id/knowledge - Add a knowledge node to an agent
  app.post("/api/hivemind/agents/:id/knowledge", async (req, res) => {
    try {
      const { id } = req.params;

      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const parsed = insertKnowledgeNodeSchema.safeParse({ ...req.body, agentId: id });
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid knowledge node data", 
          details: parsed.error.errors 
        });
      }

      const [node] = await db
        .insert(knowledgeNodes)
        .values({
          agentId: id,
          topic: parsed.data.topic,
          content: parsed.data.content,
          confidence: parsed.data.confidence ?? 0.5,
          chainScope: parsed.data.chainScope ?? null,
        })
        .returning();
      
      res.status(201).json(node);
    } catch (error) {
      console.error("Error creating knowledge node:", error);
      res.status(500).json({ error: "Failed to create knowledge node" });
    }
  });

  // GET /api/hivemind/matches - Get recent matches (last 20)
  app.get("/api/hivemind/matches", async (req, res) => {
    try {
      const matches = await db
        .select()
        .from(agentMatches)
        .orderBy(desc(agentMatches.createdAt))
        .limit(20);
      res.json(matches);
    } catch (error) {
      console.error("Error fetching matches:", error);
      res.status(500).json({ error: "Failed to fetch matches" });
    }
  });

  // Zod schema for match request validation
  const matchRequestSchema = z.object({
    agent1Id: z.string().uuid(),
    agent2Id: z.string().uuid(),
    matchType: z.string().optional().default("knowledge_trade"),
  }).refine(data => data.agent1Id !== data.agent2Id, {
    message: "Agents must be different"
  });

  // POST /api/hivemind/matches - Initiate a match between two agents
  app.post("/api/hivemind/matches", async (req, res) => {
    // 1. Check for OpenAI API key first (503 if not configured)
    const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(503).json({ error: "AI service not configured" });
    }

    // 2. Validate request body with Zod (400 for validation errors)
    const parsed = matchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Invalid request data", 
        details: parsed.error.errors 
      });
    }

    const { agent1Id, agent2Id, matchType } = parsed.data;

    try {
      // 3. Fetch both agents (404 if not found)
      const [agent1] = await db.select().from(agents).where(eq(agents.id, agent1Id));
      const [agent2] = await db.select().from(agents).where(eq(agents.id, agent2Id));

      if (!agent1 || !agent2) {
        return res.status(404).json({ error: "One or both agents not found" });
      }

      // 4. Fetch knowledge nodes for both agents
      const agent1Nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.agentId, agent1Id))
        .limit(10);
      
      const agent2Nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.agentId, agent2Id))
        .limit(10);

      // Build knowledge summaries
      const agent1Knowledge = agent1Nodes.map(n => `[${n.topic}]: ${n.content} (confidence: ${n.confidence})`).join("\n") || "No knowledge yet";
      const agent2Knowledge = agent2Nodes.map(n => `[${n.topic}]: ${n.content} (confidence: ${n.confidence})`).join("\n") || "No knowledge yet";

      // 5. Call OpenAI - wrapped in try/catch for atomic behavior
      let completion;
      try {
        const openai = getOpenAIClient();
        completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are judging a knowledge trading match between two AI agents. 
Each agent has a persona and knowledge base. They will "trade" knowledge by sharing insights.
You must:
1. Generate a new insight that combines their knowledge
2. Determine which agent contributed more valuable knowledge (winner)
3. Rate the quality of each agent's contribution (0-100)

Respond in JSON format:
{
  "combinedInsight": "A new insight generated from combining their knowledge",
  "newKnowledgeForAgent1": { "topic": "...", "content": "...", "confidence": 0.0-1.0 },
  "newKnowledgeForAgent2": { "topic": "...", "content": "...", "confidence": 0.0-1.0 },
  "winnerId": "agent1" or "agent2" or "tie",
  "agent1Score": 0-100,
  "agent2Score": 0-100,
  "reasoning": "Why you made this decision"
}`
            },
            {
              role: "user",
              content: `Agent 1 (${agent1.name}):
Persona: ${agent1.persona}
Knowledge:
${agent1Knowledge}

Agent 2 (${agent2.name}):
Persona: ${agent2.persona}
Knowledge:
${agent2Knowledge}

Judge this knowledge trading match and generate new insights for both agents.`
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        });
      } catch (openaiError: any) {
        console.error("OpenAI API error:", openaiError);
        return res.status(500).json({ 
          error: "AI service error", 
          details: openaiError.message || "Failed to process match" 
        });
      }

      // 6. Parse OpenAI response - all DB operations happen AFTER successful OpenAI call
      const result = JSON.parse(completion.choices[0].message.content || "{}");

      // Determine winner
      let winnerId: string | null = null;
      if (result.winnerId === "agent1") {
        winnerId = agent1Id;
      } else if (result.winnerId === "agent2") {
        winnerId = agent2Id;
      }

      // Create new knowledge nodes for both agents
      if (result.newKnowledgeForAgent1) {
        await db.insert(knowledgeNodes).values({
          agentId: agent1Id,
          topic: result.newKnowledgeForAgent1.topic || "Traded Knowledge",
          content: result.newKnowledgeForAgent1.content || result.combinedInsight,
          confidence: result.newKnowledgeForAgent1.confidence || 0.5,
        });
      }

      if (result.newKnowledgeForAgent2) {
        await db.insert(knowledgeNodes).values({
          agentId: agent2Id,
          topic: result.newKnowledgeForAgent2.topic || "Traded Knowledge",
          content: result.newKnowledgeForAgent2.content || result.combinedInsight,
          confidence: result.newKnowledgeForAgent2.confidence || 0.5,
        });
      }

      // Calculate new Elo ratings
      const K = 32;
      const expectedScore1 = 1 / (1 + Math.pow(10, (agent2.eloRating - agent1.eloRating) / 400));
      const expectedScore2 = 1 - expectedScore1;

      let actualScore1 = 0.5;
      let actualScore2 = 0.5;
      if (winnerId === agent1Id) {
        actualScore1 = 1;
        actualScore2 = 0;
      } else if (winnerId === agent2Id) {
        actualScore1 = 0;
        actualScore2 = 1;
      }

      const newRating1 = Math.round(agent1.eloRating + K * (actualScore1 - expectedScore1));
      const newRating2 = Math.round(agent2.eloRating + K * (actualScore2 - expectedScore2));

      // Update agent stats
      await db
        .update(agents)
        .set({
          eloRating: newRating1,
          totalMatches: agent1.totalMatches + 1,
          wins: winnerId === agent1Id ? agent1.wins + 1 : agent1.wins,
        })
        .where(eq(agents.id, agent1Id));

      await db
        .update(agents)
        .set({
          eloRating: newRating2,
          totalMatches: agent2.totalMatches + 1,
          wins: winnerId === agent2Id ? agent2.wins + 1 : agent2.wins,
        })
        .where(eq(agents.id, agent2Id));

      // Create match record
      const [match] = await db
        .insert(agentMatches)
        .values({
          agent1Id,
          agent2Id,
          winnerId,
          matchType,
          knowledgeExchanged: JSON.stringify(result),
          completedAt: new Date(),
        })
        .returning();

      res.status(201).json({
        match,
        result: {
          combinedInsight: result.combinedInsight,
          winnerId,
          winnerName: winnerId === agent1Id ? agent1.name : winnerId === agent2Id ? agent2.name : "Tie",
          agent1NewRating: newRating1,
          agent2NewRating: newRating2,
          ratingChanges: {
            agent1: newRating1 - agent1.eloRating,
            agent2: newRating2 - agent2.eloRating,
          },
          reasoning: result.reasoning,
        }
      });
    } catch (error) {
      console.error("Error initiating match:", error);
      res.status(500).json({ error: "Failed to initiate match" });
    }
  });

  // GET /api/hivemind/stats - Get aggregate statistics
  app.get("/api/hivemind/stats", async (req, res) => {
    try {
      const [agentStats] = await db
        .select({
          totalAgents: count(agents.id),
          avgRating: avg(agents.eloRating),
        })
        .from(agents);

      const [matchStats] = await db
        .select({
          totalMatches: count(agentMatches.id),
        })
        .from(agentMatches);

      const [knowledgeStats] = await db
        .select({
          totalKnowledgeNodes: count(knowledgeNodes.id),
        })
        .from(knowledgeNodes);

      const [edgeStats] = await db
        .select({
          totalEdges: count(knowledgeEdges.id),
        })
        .from(knowledgeEdges);

      // Get top 5 agents by Elo
      const topAgents = await db
        .select({
          id: agents.id,
          name: agents.name,
          eloRating: agents.eloRating,
          wins: agents.wins,
          totalMatches: agents.totalMatches,
        })
        .from(agents)
        .orderBy(desc(agents.eloRating))
        .limit(5);

      res.json({
        totalAgents: Number(agentStats?.totalAgents ?? 0),
        totalMatches: Number(matchStats?.totalMatches ?? 0),
        totalKnowledgeNodes: Number(knowledgeStats?.totalKnowledgeNodes ?? 0),
        totalEdges: Number(edgeStats?.totalEdges ?? 0),
        avgRating: agentStats?.avgRating ? Number(agentStats.avgRating).toFixed(2) : "1000.00",
        topAgents,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ========== Trading Battles API ==========

  // Zod schema for creating a battle
  const createBattleSchema = z.object({
    agent1Id: z.string().uuid(),
    agent2Id: z.string().uuid(),
    durationHours: z.number().int().min(1).max(168).optional().default(12),
    baseAsset: z.string().optional().default('bitcoin'),
  }).refine(data => data.agent1Id !== data.agent2Id, {
    message: "Agents must be different"
  });

  // POST /api/trading-battles - Create a new trading battle
  app.post("/api/trading-battles", async (req, res) => {
    try {
      const parsed = createBattleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid battle data", 
          details: parsed.error.errors 
        });
      }

      const { agent1Id, agent2Id, durationHours, baseAsset } = parsed.data;

      // Verify both agents exist
      const [agent1] = await db.select().from(agents).where(eq(agents.id, agent1Id));
      const [agent2] = await db.select().from(agents).where(eq(agents.id, agent2Id));

      if (!agent1 || !agent2) {
        return res.status(404).json({ error: "One or both agents not found" });
      }

      const startingBalance = "10000";

      // Create the battle
      const [battle] = await db
        .insert(tradingBattles)
        .values({
          agent1Id,
          agent2Id,
          status: "pending",
          startingBalance,
          durationHours,
          baseAsset,
          quoteAsset: "usd",
        })
        .returning();

      // Create portfolios for both agents
      await db.insert(battlePortfolios).values([
        {
          battleId: battle.id,
          agentId: agent1Id,
          cashBalance: startingBalance,
          assetBalance: "0",
          lastPrice: "0",
          totalValue: startingBalance,
        },
        {
          battleId: battle.id,
          agentId: agent2Id,
          cashBalance: startingBalance,
          assetBalance: "0",
          lastPrice: "0",
          totalValue: startingBalance,
        }
      ]);

      res.status(201).json(battle);
    } catch (error) {
      console.error("Error creating trading battle:", error);
      res.status(500).json({ error: "Failed to create trading battle" });
    }
  });

  // POST /api/trading-battles/:id/start - Start a pending battle
  app.post("/api/trading-battles/:id/start", async (req, res) => {
    try {
      const { id } = req.params;

      const [battle] = await db
        .select()
        .from(tradingBattles)
        .where(eq(tradingBattles.id, id));

      if (!battle) {
        return res.status(404).json({ error: "Battle not found" });
      }

      if (battle.status !== "pending") {
        return res.status(400).json({ error: "Battle is not in pending state" });
      }

      // Fetch current price
      const currentPrice = await getCryptoPrice(battle.baseAsset, battle.quoteAsset);

      const now = new Date();
      const endsAt = new Date(now.getTime() + battle.durationHours * 60 * 60 * 1000);

      // Update battle
      const [updatedBattle] = await db
        .update(tradingBattles)
        .set({
          status: "running",
          startedAt: now,
          endsAt,
          initialPrice: currentPrice.toString(),
        })
        .where(eq(tradingBattles.id, id))
        .returning();

      // Update portfolio last prices
      await db
        .update(battlePortfolios)
        .set({ lastPrice: currentPrice.toString() })
        .where(eq(battlePortfolios.battleId, id));

      res.json(updatedBattle);
    } catch (error) {
      console.error("Error starting battle:", error);
      res.status(500).json({ error: "Failed to start battle" });
    }
  });

  // GET /api/trading-battles - List all battles (latest first)
  app.get("/api/trading-battles", async (req, res) => {
    try {
      const battles = await db
        .select({
          id: tradingBattles.id,
          agent1Id: tradingBattles.agent1Id,
          agent2Id: tradingBattles.agent2Id,
          agent1Name: sql<string>`(SELECT name FROM agents WHERE id = ${tradingBattles.agent1Id})`,
          agent2Name: sql<string>`(SELECT name FROM agents WHERE id = ${tradingBattles.agent2Id})`,
          winnerId: tradingBattles.winnerId,
          status: tradingBattles.status,
          startingBalance: tradingBattles.startingBalance,
          durationHours: tradingBattles.durationHours,
          baseAsset: tradingBattles.baseAsset,
          quoteAsset: tradingBattles.quoteAsset,
          initialPrice: tradingBattles.initialPrice,
          agent1FinalBalance: tradingBattles.agent1FinalBalance,
          agent2FinalBalance: tradingBattles.agent2FinalBalance,
          createdAt: tradingBattles.createdAt,
          startedAt: tradingBattles.startedAt,
          endsAt: tradingBattles.endsAt,
          completedAt: tradingBattles.completedAt,
        })
        .from(tradingBattles)
        .orderBy(desc(tradingBattles.createdAt));

      res.json(battles);
    } catch (error) {
      console.error("Error fetching trading battles:", error);
      res.status(500).json({ error: "Failed to fetch trading battles" });
    }
  });

  // GET /api/trading-battles/:id - Get battle details
  app.get("/api/trading-battles/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const [battle] = await db
        .select({
          id: tradingBattles.id,
          agent1Id: tradingBattles.agent1Id,
          agent2Id: tradingBattles.agent2Id,
          agent1Name: sql<string>`(SELECT name FROM agents WHERE id = ${tradingBattles.agent1Id})`,
          agent2Name: sql<string>`(SELECT name FROM agents WHERE id = ${tradingBattles.agent2Id})`,
          winnerId: tradingBattles.winnerId,
          status: tradingBattles.status,
          startingBalance: tradingBattles.startingBalance,
          durationHours: tradingBattles.durationHours,
          baseAsset: tradingBattles.baseAsset,
          quoteAsset: tradingBattles.quoteAsset,
          initialPrice: tradingBattles.initialPrice,
          agent1FinalBalance: tradingBattles.agent1FinalBalance,
          agent2FinalBalance: tradingBattles.agent2FinalBalance,
          createdAt: tradingBattles.createdAt,
          startedAt: tradingBattles.startedAt,
          endsAt: tradingBattles.endsAt,
          completedAt: tradingBattles.completedAt,
        })
        .from(tradingBattles)
        .where(eq(tradingBattles.id, id));

      if (!battle) {
        return res.status(404).json({ error: "Battle not found" });
      }

      // Get portfolios
      const portfolios = await db
        .select()
        .from(battlePortfolios)
        .where(eq(battlePortfolios.battleId, id));

      // Get recent trades (last 50)
      const trades = await db
        .select()
        .from(battleTrades)
        .where(eq(battleTrades.battleId, id))
        .orderBy(desc(battleTrades.createdAt))
        .limit(50);

      // Get rounds for charting
      const rounds = await db
        .select()
        .from(battleRounds)
        .where(eq(battleRounds.battleId, id))
        .orderBy(battleRounds.roundNumber);

      res.json({
        ...battle,
        portfolios,
        trades,
        rounds,
      });
    } catch (error) {
      console.error("Error fetching battle details:", error);
      res.status(500).json({ error: "Failed to fetch battle details" });
    }
  });

  // Zod schema for trade
  const tradeSchema = z.object({
    agentId: z.string().uuid(),
    tradeType: z.enum(["buy", "sell"]),
    percentage: z.number().min(0).max(100),
  });

  // POST /api/trading-battles/:id/trades - Execute a trade for an agent
  app.post("/api/trading-battles/:id/trades", async (req, res) => {
    try {
      const { id } = req.params;

      const parsed = tradeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid trade data", 
          details: parsed.error.errors 
        });
      }

      const { agentId, tradeType, percentage } = parsed.data;

      // Get battle
      const [battle] = await db
        .select()
        .from(tradingBattles)
        .where(eq(tradingBattles.id, id));

      if (!battle) {
        return res.status(404).json({ error: "Battle not found" });
      }

      if (battle.status !== "running") {
        return res.status(400).json({ error: "Battle is not running" });
      }

      // Validate agent is part of this battle
      if (agentId !== battle.agent1Id && agentId !== battle.agent2Id) {
        return res.status(400).json({ error: "Agent is not part of this battle" });
      }

      // Get portfolio
      const [portfolio] = await db
        .select()
        .from(battlePortfolios)
        .where(sql`${battlePortfolios.battleId} = ${id} AND ${battlePortfolios.agentId} = ${agentId}`);

      if (!portfolio) {
        return res.status(404).json({ error: "Portfolio not found" });
      }

      // Get current price
      const currentPrice = await getCryptoPrice(battle.baseAsset, battle.quoteAsset);

      let assetAmount: number;
      let cashAmount: number;
      let newCashBalance: number;
      let newAssetBalance: number;

      const cashBalance = parseFloat(portfolio.cashBalance);
      const assetBalance = parseFloat(portfolio.assetBalance);

      if (tradeType === "buy") {
        // Buy: spend percentage of cash to buy asset
        cashAmount = cashBalance * (percentage / 100);
        assetAmount = cashAmount / currentPrice;
        newCashBalance = cashBalance - cashAmount;
        newAssetBalance = assetBalance + assetAmount;
      } else {
        // Sell: sell percentage of asset for cash
        assetAmount = assetBalance * (percentage / 100);
        cashAmount = assetAmount * currentPrice;
        newCashBalance = cashBalance + cashAmount;
        newAssetBalance = assetBalance - assetAmount;
      }

      // Update portfolio
      const totalValue = newCashBalance + (newAssetBalance * currentPrice);
      await db
        .update(battlePortfolios)
        .set({
          cashBalance: newCashBalance.toString(),
          assetBalance: newAssetBalance.toString(),
          lastPrice: currentPrice.toString(),
          totalValue: totalValue.toString(),
          updatedAt: new Date(),
        })
        .where(eq(battlePortfolios.id, portfolio.id));

      // Record trade
      const [trade] = await db
        .insert(battleTrades)
        .values({
          battleId: id,
          agentId,
          tradeType,
          assetAmount: assetAmount.toString(),
          price: currentPrice.toString(),
          cashAmount: cashAmount.toString(),
        })
        .returning();

      res.status(201).json({
        trade,
        portfolio: {
          cashBalance: newCashBalance,
          assetBalance: newAssetBalance,
          totalValue,
          lastPrice: currentPrice,
        }
      });
    } catch (error) {
      console.error("Error executing trade:", error);
      res.status(500).json({ error: "Failed to execute trade" });
    }
  });

  startBattleScheduler();

  return httpServer;
}
