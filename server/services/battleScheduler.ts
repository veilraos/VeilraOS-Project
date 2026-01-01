import { db } from "../db";
import {
  tradingBattles,
  battlePortfolios,
  battleRounds,
  battleTrades,
  agents,
} from "@shared/schema";
import { getCryptoPrice } from "./priceService";
import { eq, and, gt, sql } from "drizzle-orm";
import { getOpenAIClient } from "../replit_integrations/chat/routes";

const SCHEDULER_INTERVAL = 300000; // 5 minutes

export function startBattleScheduler(): void {
  console.log("Starting battle scheduler (5 minute intervals)...");

  setInterval(async () => {
    try {
      const now = new Date();

      const runningBattles = await db
        .select()
        .from(tradingBattles)
        .where(
          and(
            eq(tradingBattles.status, "running"),
            gt(tradingBattles.endsAt, now)
          )
        );

      console.log(`[BattleScheduler] Processing ${runningBattles.length} running battles`);

      for (const battle of runningBattles) {
        try {
          await makeAITradingDecision(battle.id, battle.agent1Id);
          await makeAITradingDecision(battle.id, battle.agent2Id);
          await processBattleRound(battle.id);

          const updatedBattle = await db
            .select()
            .from(tradingBattles)
            .where(eq(tradingBattles.id, battle.id))
            .then((res) => res[0]);

          if (updatedBattle && updatedBattle.endsAt && new Date(updatedBattle.endsAt) <= now) {
            await finalizeBattle(battle.id);
          }
        } catch (error) {
          console.error(`[BattleScheduler] Error processing battle ${battle.id}:`, error);
        }
      }

      const expiredBattles = await db
        .select()
        .from(tradingBattles)
        .where(
          and(
            eq(tradingBattles.status, "running"),
            sql`${tradingBattles.endsAt} <= ${now}`
          )
        );

      for (const battle of expiredBattles) {
        try {
          await finalizeBattle(battle.id);
        } catch (error) {
          console.error(`[BattleScheduler] Error finalizing expired battle ${battle.id}:`, error);
        }
      }
    } catch (error) {
      console.error("[BattleScheduler] Error in scheduler loop:", error);
    }
  }, SCHEDULER_INTERVAL);
}

export async function processBattleRound(battleId: string): Promise<void> {
  const battle = await db
    .select()
    .from(tradingBattles)
    .where(eq(tradingBattles.id, battleId))
    .then((res) => res[0]);

  if (!battle) {
    throw new Error(`Battle ${battleId} not found`);
  }

  const currentPrice = await getCryptoPrice(battle.baseAsset, battle.quoteAsset);

  const portfolios = await db
    .select()
    .from(battlePortfolios)
    .where(eq(battlePortfolios.battleId, battleId));

  const portfolioValues: Record<string, number> = {};

  for (const portfolio of portfolios) {
    const cashBalance = parseFloat(portfolio.cashBalance?.toString() || "0");
    const assetBalance = parseFloat(portfolio.assetBalance?.toString() || "0");
    const totalValue = cashBalance + assetBalance * currentPrice;

    portfolioValues[portfolio.agentId] = totalValue;

    await db
      .update(battlePortfolios)
      .set({
        lastPrice: currentPrice.toString(),
        totalValue: totalValue.toString(),
        updatedAt: new Date(),
      })
      .where(eq(battlePortfolios.id, portfolio.id));
  }

  const existingRounds = await db
    .select()
    .from(battleRounds)
    .where(eq(battleRounds.battleId, battleId));

  const roundNumber = existingRounds.length + 1;

  await db.insert(battleRounds).values({
    battleId,
    roundNumber,
    assetPrice: currentPrice.toString(),
    agent1TotalValue: (portfolioValues[battle.agent1Id] || 0).toString(),
    agent2TotalValue: (portfolioValues[battle.agent2Id] || 0).toString(),
  });

  console.log(`[BattleScheduler] Round ${roundNumber} recorded for battle ${battleId}`);
}

export async function finalizeBattle(battleId: string): Promise<void> {
  const battle = await db
    .select()
    .from(tradingBattles)
    .where(eq(tradingBattles.id, battleId))
    .then((res) => res[0]);

  if (!battle) {
    throw new Error(`Battle ${battleId} not found`);
  }

  const portfolios = await db
    .select()
    .from(battlePortfolios)
    .where(eq(battlePortfolios.battleId, battleId));

  const agent1Portfolio = portfolios.find((p) => p.agentId === battle.agent1Id);
  const agent2Portfolio = portfolios.find((p) => p.agentId === battle.agent2Id);

  if (!agent1Portfolio || !agent2Portfolio) {
    throw new Error(`Portfolios not found for battle ${battleId}`);
  }

  const agent1Value = parseFloat(agent1Portfolio.totalValue?.toString() || "0");
  const agent2Value = parseFloat(agent2Portfolio.totalValue?.toString() || "0");

  let winnerId: string | null = null;
  if (agent1Value > agent2Value) {
    winnerId = battle.agent1Id;
  } else if (agent2Value > agent1Value) {
    winnerId = battle.agent2Id;
  }

  await db
    .update(tradingBattles)
    .set({
      status: "completed",
      completedAt: new Date(),
      agent1FinalBalance: agent1Value.toString(),
      agent2FinalBalance: agent2Value.toString(),
      winnerId,
    })
    .where(eq(tradingBattles.id, battleId));

  if (winnerId) {
    const loserId = winnerId === battle.agent1Id ? battle.agent2Id : battle.agent1Id;

    await db
      .update(agents)
      .set({
        eloRating: sql`${agents.eloRating} + 20`,
        wins: sql`${agents.wins} + 1`,
        totalMatches: sql`${agents.totalMatches} + 1`,
      })
      .where(eq(agents.id, winnerId));

    await db
      .update(agents)
      .set({
        eloRating: sql`${agents.eloRating} - 20`,
        totalMatches: sql`${agents.totalMatches} + 1`,
      })
      .where(eq(agents.id, loserId));

    console.log(`[BattleScheduler] Battle ${battleId} finalized. Winner: ${winnerId}`);
  } else {
    await db
      .update(agents)
      .set({ totalMatches: sql`${agents.totalMatches} + 1` })
      .where(eq(agents.id, battle.agent1Id));

    await db
      .update(agents)
      .set({ totalMatches: sql`${agents.totalMatches} + 1` })
      .where(eq(agents.id, battle.agent2Id));

    console.log(`[BattleScheduler] Battle ${battleId} finalized. Result: Tie`);
  }
}

export async function makeAITradingDecision(
  battleId: string,
  agentId: string
): Promise<void> {
  const agent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .then((res) => res[0]);

  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const portfolio = await db
    .select()
    .from(battlePortfolios)
    .where(and(eq(battlePortfolios.battleId, battleId), eq(battlePortfolios.agentId, agentId)))
    .then((res) => res[0]);

  if (!portfolio) {
    throw new Error(`Portfolio not found for agent ${agentId} in battle ${battleId}`);
  }

  const battle = await db
    .select()
    .from(tradingBattles)
    .where(eq(tradingBattles.id, battleId))
    .then((res) => res[0]);

  if (!battle) {
    throw new Error(`Battle ${battleId} not found`);
  }

  const currentPrice = await getCryptoPrice(battle.baseAsset, battle.quoteAsset);

  const recentRounds = await db
    .select()
    .from(battleRounds)
    .where(eq(battleRounds.battleId, battleId))
    .orderBy(sql`${battleRounds.roundNumber} DESC`)
    .limit(5);

  const priceHistory = recentRounds
    .map((r) => parseFloat(r.assetPrice?.toString() || "0"))
    .reverse();

  const cashBalance = parseFloat(portfolio.cashBalance?.toString() || "0");
  const assetBalance = parseFloat(portfolio.assetBalance?.toString() || "0");

  const openai = getOpenAIClient();

  const prompt = `You are an AI trading agent with the following persona: ${agent.persona}

Current market situation:
- Asset: ${battle.baseAsset}
- Current price: $${currentPrice}
- Recent price history (oldest to newest): ${priceHistory.length > 0 ? priceHistory.map((p) => `$${p}`).join(" -> ") : "No history yet"}

Your portfolio:
- Cash balance: $${cashBalance.toFixed(2)}
- Asset holdings: ${assetBalance.toFixed(6)} ${battle.baseAsset}
- Total value: $${(cashBalance + assetBalance * currentPrice).toFixed(2)}

Based on your trading persona and the current market conditions, decide your next move.
Respond with a JSON object in this exact format:
{
  "action": "buy" | "sell" | "hold",
  "percentage": <number between 0-100 for buy/sell, 0 for hold>,
  "reasoning": "<brief explanation>"
}

Only output the JSON, no other text.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      console.log(`[BattleScheduler] No response from AI for agent ${agentId}`);
      return;
    }

    let decision: { action: string; percentage: number; reasoning: string };
    try {
      decision = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        decision = JSON.parse(jsonMatch[0]);
      } else {
        console.log(`[BattleScheduler] Failed to parse AI response: ${content}`);
        return;
      }
    }

    const clampedPercentage = Math.max(0, Math.min(100, decision.percentage || 0));
    
    if (decision.action === "hold" || clampedPercentage <= 0) {
      console.log(`[BattleScheduler] Agent ${agent.name} holds. Reason: ${decision.reasoning}`);
      return;
    }

    let tradeType: string;
    let assetAmount: number;
    let cashAmount: number;

    if (decision.action === "buy" && cashBalance > 1) {
      const spendAmount = Math.min(cashBalance * (clampedPercentage / 100), cashBalance - 0.01);
      assetAmount = spendAmount / currentPrice;
      cashAmount = spendAmount;
      tradeType = "buy";

      await db
        .update(battlePortfolios)
        .set({
          cashBalance: (cashBalance - spendAmount).toString(),
          assetBalance: (assetBalance + assetAmount).toString(),
          lastPrice: currentPrice.toString(),
          totalValue: (cashBalance - spendAmount + (assetBalance + assetAmount) * currentPrice).toString(),
          updatedAt: new Date(),
        })
        .where(eq(battlePortfolios.id, portfolio.id));
    } else if (decision.action === "sell" && assetBalance > 0.000001) {
      const sellAmount = Math.min(assetBalance * (clampedPercentage / 100), assetBalance);
      assetAmount = sellAmount;
      cashAmount = sellAmount * currentPrice;
      tradeType = "sell";

      await db
        .update(battlePortfolios)
        .set({
          cashBalance: (cashBalance + cashAmount).toString(),
          assetBalance: (assetBalance - sellAmount).toString(),
          lastPrice: currentPrice.toString(),
          totalValue: (cashBalance + cashAmount + (assetBalance - sellAmount) * currentPrice).toString(),
          updatedAt: new Date(),
        })
        .where(eq(battlePortfolios.id, portfolio.id));
    } else {
      console.log(`[BattleScheduler] Agent ${agent.name} cannot execute ${decision.action}`);
      return;
    }

    await db.insert(battleTrades).values({
      battleId,
      agentId,
      tradeType,
      assetAmount: assetAmount.toString(),
      price: currentPrice.toString(),
      cashAmount: cashAmount.toString(),
      reasoning: decision.reasoning,
    });

    console.log(
      `[BattleScheduler] Agent ${agent.name} ${tradeType}s ${assetAmount.toFixed(6)} ${battle.baseAsset} at $${currentPrice}. Reason: ${decision.reasoning}`
    );
  } catch (error) {
    console.error(`[BattleScheduler] AI trading decision error for agent ${agentId}:`, error);
  }
}
