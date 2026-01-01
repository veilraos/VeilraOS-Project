import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Swords, Brain, Users, Activity, Plus, Zap, Target, GitMerge, Sparkles, Network, TrendingUp, Clock, DollarSign, ArrowUpRight, ArrowDownRight, ChevronLeft } from "lucide-react";
import { insertAgentSchema } from "@shared/schema";
import type { Agent, AgentMatch, KnowledgeNode, KnowledgeEdge, TradingBattle, BattlePortfolio, BattleTrade, BattleRound } from "@shared/schema";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface HiveMindStats {
  totalAgents: number;
  totalMatches: number;
  activeMatches: number;
  totalKnowledgeNodes: number;
}

interface KnowledgeData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

interface TradingBattleWithNames extends TradingBattle {
  agent1Name: string;
  agent2Name: string;
}

interface BattleDetails extends TradingBattleWithNames {
  portfolios: BattlePortfolio[];
  trades: BattleTrade[];
  rounds: BattleRound[];
}

const createAgentSchema = insertAgentSchema.pick({ name: true, persona: true }).extend({
  name: z.string().min(1, "Name is required"),
  persona: z.string().min(1, "Persona is required"),
});

type CreateAgentFormValues = z.infer<typeof createAgentSchema>;

const matchSchema = z.object({
  agent1Id: z.string().min(1, "Select first agent"),
  agent2Id: z.string().min(1, "Select second agent"),
}).refine(data => data.agent1Id !== data.agent2Id, {
  message: "Select two different agents",
  path: ["agent2Id"],
});

type MatchFormValues = z.infer<typeof matchSchema>;

const battleSchema = z.object({
  agent1Id: z.string().min(1, "Select first agent"),
  agent2Id: z.string().min(1, "Select second agent"),
  durationHours: z.string().min(1, "Select duration"),
  baseAsset: z.string().min(1, "Select asset"),
}).refine(data => data.agent1Id !== data.agent2Id, {
  message: "Select two different agents",
  path: ["agent2Id"],
});

type BattleFormValues = z.infer<typeof battleSchema>;

const DURATION_OPTIONS = [
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
];

const ASSET_OPTIONS = [
  { value: "bitcoin", label: "Bitcoin" },
  { value: "ethereum", label: "Ethereum" },
  { value: "solana", label: "Solana" },
  { value: "binancecoin", label: "BNB" },
];

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running": return "default";
    case "completed": return "secondary";
    case "pending": return "outline";
    case "cancelled": return "destructive";
    default: return "outline";
  }
}

function formatCurrency(value: string | number | null): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === null || isNaN(num as number)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num as number);
}

function formatDuration(hours: number): string {
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export default function HiveMind() {
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [battleDialogOpen, setBattleDialogOpen] = useState(false);
  const [selectedBattleId, setSelectedBattleId] = useState<string | null>(null);

  const createAgentForm = useForm<CreateAgentFormValues>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: {
      name: "",
      persona: "",
    },
  });

  const matchForm = useForm<MatchFormValues>({
    resolver: zodResolver(matchSchema),
    defaultValues: {
      agent1Id: "",
      agent2Id: "",
    },
  });

  const battleForm = useForm<BattleFormValues>({
    resolver: zodResolver(battleSchema),
    defaultValues: {
      agent1Id: "",
      agent2Id: "",
      durationHours: "12",
      baseAsset: "bitcoin",
    },
  });

  const { data: agents, isLoading: agentsLoading, error: agentsError } = useQuery<Agent[]>({
    queryKey: ["/api/hivemind/agents"],
  });

  const { data: matches, isLoading: matchesLoading, error: matchesError } = useQuery<AgentMatch[]>({
    queryKey: ["/api/hivemind/matches"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<HiveMindStats>({
    queryKey: ["/api/hivemind/stats"],
  });

  const { data: knowledgeData, isLoading: knowledgeLoading } = useQuery<KnowledgeData>({
    queryKey: ["/api/hivemind/agents", selectedAgentId, "knowledge"],
    enabled: !!selectedAgentId,
  });

  const { data: battles, isLoading: battlesLoading } = useQuery<TradingBattleWithNames[]>({
    queryKey: ["/api/trading-battles"],
  });

  const { data: battleDetails, isLoading: battleDetailsLoading } = useQuery<BattleDetails>({
    queryKey: ["/api/trading-battles", selectedBattleId],
    enabled: !!selectedBattleId,
  });

  const createAgentMutation = useMutation({
    mutationFn: async (data: { name: string; persona: string }) => {
      const res = await apiRequest("POST", "/api/hivemind/agents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hivemind/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hivemind/stats"] });
      setCreateDialogOpen(false);
      createAgentForm.reset();
      toast({ title: "Agent Created", description: "New AI agent has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const initiateMatchMutation = useMutation({
    mutationFn: async (data: { agent1Id: string; agent2Id: string }) => {
      const res = await apiRequest("POST", "/api/hivemind/matches", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hivemind/matches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hivemind/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hivemind/agents"] });
      setMatchDialogOpen(false);
      matchForm.reset();
      toast({ title: "Match Started", description: "Knowledge trading match has been initiated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createBattleMutation = useMutation({
    mutationFn: async (data: { agent1Id: string; agent2Id: string; durationHours: number; baseAsset: string }) => {
      const createRes = await apiRequest("POST", "/api/trading-battles", data);
      const battle = await createRes.json();
      const startRes = await apiRequest("POST", `/api/trading-battles/${battle.id}/start`, {});
      return startRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trading-battles"] });
      setBattleDialogOpen(false);
      battleForm.reset();
      toast({ title: "Battle Started", description: "Trading battle has been created and started." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateAgent = (data: CreateAgentFormValues) => {
    createAgentMutation.mutate(data);
  };

  const handleInitiateMatch = (data: MatchFormValues) => {
    initiateMatchMutation.mutate(data);
  };

  const handleCreateBattle = (data: BattleFormValues) => {
    createBattleMutation.mutate({
      agent1Id: data.agent1Id,
      agent2Id: data.agent2Id,
      durationHours: parseInt(data.durationHours),
      baseAsset: data.baseAsset,
    });
  };

  const getWinRate = (agent: Agent) => {
    if (agent.totalMatches === 0) return 0;
    return Math.round((agent.wins / agent.totalMatches) * 100);
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId || !agents) return "Unknown";
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || "Unknown";
  };

  const sortedAgents = agents?.slice().sort((a, b) => b.eloRating - a.eloRating) || [];
  const selectedAgent = selectedAgentId ? agents?.find((a) => a.id === selectedAgentId) : null;

  const getChartData = () => {
    if (!battleDetails?.rounds) return [];
    return battleDetails.rounds.map((round) => ({
      round: round.roundNumber,
      [battleDetails.agent1Name || "Agent 1"]: parseFloat(round.agent1TotalValue),
      [battleDetails.agent2Name || "Agent 2"]: parseFloat(round.agent2TotalValue),
    }));
  };

  const getPortfolioForAgent = (agentId: string) => {
    return battleDetails?.portfolios?.find((p) => p.agentId === agentId);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5 border-b">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="container mx-auto px-6 py-8 max-w-7xl relative">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <Network className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="font-['Space_Grotesk'] text-3xl font-bold tracking-tight">Hive Mind Arena</h1>
                  <p className="text-muted-foreground">Decentralized AI agents compete in knowledge trading battles</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Dialog open={createDialogOpen} onOpenChange={(open) => {
                setCreateDialogOpen(open);
                if (!open) createAgentForm.reset();
              }}>
                <DialogTrigger asChild>
                  <Button size="lg" data-testid="button-create-agent">
                    <Plus className="w-4 h-4" />
                    Create Agent
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-['Space_Grotesk'] text-xl">Create New Agent</DialogTitle>
                    <DialogDescription>Define a new AI agent with a unique persona to compete in the arena.</DialogDescription>
                  </DialogHeader>
                  <Form {...createAgentForm}>
                    <form onSubmit={createAgentForm.handleSubmit(handleCreateAgent)} className="space-y-5 py-4">
                      <FormField
                        control={createAgentForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agent Name</FormLabel>
                            <FormControl>
                              <Input
                                data-testid="input-agent-name"
                                placeholder="Enter agent name..."
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createAgentForm.control}
                        name="persona"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Persona</FormLabel>
                            <FormControl>
                              <Textarea
                                data-testid="input-agent-persona"
                                placeholder="Describe the agent's personality, expertise, and behavior..."
                                rows={4}
                                className="resize-none"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter className="gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">
                          Cancel
                        </Button>
                        <Button type="submit" disabled={createAgentMutation.isPending} data-testid="button-submit-agent">
                          {createAgentMutation.isPending ? "Creating..." : "Create Agent"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>

              <Dialog open={matchDialogOpen} onOpenChange={(open) => {
                setMatchDialogOpen(open);
                if (!open) matchForm.reset();
              }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="lg" data-testid="button-initiate-match">
                    <Swords className="w-4 h-4" />
                    Initiate Match
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-['Space_Grotesk'] text-xl">Initiate Knowledge Match</DialogTitle>
                    <DialogDescription>Select two agents to compete in a knowledge trading battle.</DialogDescription>
                  </DialogHeader>
                  <Form {...matchForm}>
                    <form onSubmit={matchForm.handleSubmit(handleInitiateMatch)} className="space-y-5 py-4">
                      <FormField
                        control={matchForm.control}
                        name="agent1Id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agent 1</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-match-agent1">
                                  <SelectValue placeholder="Select first agent" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {sortedAgents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id} data-testid={`select-item-agent1-${agent.id}`}>
                                    <span className="truncate max-w-[200px] inline-block">{agent.name}</span>
                                    <span className="text-muted-foreground ml-2">({Math.round(agent.eloRating)})</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={matchForm.control}
                        name="agent2Id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agent 2</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-match-agent2">
                                  <SelectValue placeholder="Select second agent" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {sortedAgents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id} data-testid={`select-item-agent2-${agent.id}`}>
                                    <span className="truncate max-w-[200px] inline-block">{agent.name}</span>
                                    <span className="text-muted-foreground ml-2">({Math.round(agent.eloRating)})</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter className="gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => setMatchDialogOpen(false)} data-testid="button-cancel-match">
                          Cancel
                        </Button>
                        <Button type="submit" disabled={initiateMatchMutation.isPending} data-testid="button-start-match">
                          {initiateMatchMutation.isPending ? "Starting..." : "Start Match"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="bg-card/50 backdrop-blur-sm border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Agents</div>
                  <div className="font-['Space_Grotesk'] font-bold text-2xl" data-testid="stat-total-agents">
                    {statsLoading ? <Skeleton className="h-7 w-10" /> : stats?.totalAgents ?? 0}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-card/50 backdrop-blur-sm border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Swords className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Matches</div>
                  <div className="font-['Space_Grotesk'] font-bold text-2xl" data-testid="stat-total-matches">
                    {statsLoading ? <Skeleton className="h-7 w-10" /> : stats?.totalMatches ?? 0}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-card/50 backdrop-blur-sm border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/10">
                  <Activity className="w-5 h-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Matches</div>
                  <div className="font-['Space_Grotesk'] font-bold text-2xl" data-testid="stat-active-matches">
                    {statsLoading ? <Skeleton className="h-7 w-10" /> : stats?.activeMatches ?? 0}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-card/50 backdrop-blur-sm border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Brain className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Knowledge Nodes</div>
                  <div className="font-['Space_Grotesk'] font-bold text-2xl" data-testid="stat-knowledge-nodes">
                    {statsLoading ? <Skeleton className="h-7 w-10" /> : stats?.totalKnowledgeNodes ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-7xl">
        <Tabs defaultValue="arena" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="arena" data-testid="tab-arena">
              <Brain className="w-4 h-4 mr-2" />
              Knowledge Arena
            </TabsTrigger>
            <TabsTrigger value="battles" data-testid="tab-battles">
              <TrendingUp className="w-4 h-4 mr-2" />
              Trading Battles
            </TabsTrigger>
          </TabsList>

          <TabsContent value="arena" className="space-y-6">
            <div className="flex flex-col gap-6">
              <Card className="overflow-hidden">
                <CardHeader className="pb-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <Trophy className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                      <CardTitle className="font-['Space_Grotesk'] text-lg">Agent Leaderboard</CardTitle>
                      <CardDescription>Ranked by Elo rating</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[300px]">
                    <div className="p-4">
                      {agentsLoading ? (
                        <div className="space-y-3">
                          {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-24 w-full rounded-xl" />
                          ))}
                        </div>
                      ) : agentsError ? (
                        <div className="text-center text-muted-foreground py-12" data-testid="error-agents">
                          Failed to load agents
                        </div>
                      ) : sortedAgents.length === 0 ? (
                        <div className="text-center py-12" data-testid="empty-agents">
                          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                            <Users className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground font-medium">No agents yet</p>
                          <p className="text-sm text-muted-foreground/70">Create one to get started</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {sortedAgents.map((agent, index) => (
                            <div
                              key={agent.id}
                              className={`relative rounded-xl border p-4 cursor-pointer transition-all hover-elevate ${
                                selectedAgentId === agent.id 
                                  ? "ring-2 ring-primary border-primary/50 bg-primary/5" 
                                  : "bg-card hover:border-primary/30"
                              }`}
                              onClick={() => setSelectedAgentId(agent.id)}
                              data-testid={`card-agent-${agent.id}`}
                            >
                              {index < 3 && (
                                <div className={`absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  index === 0 ? "bg-amber-500 text-white" :
                                  index === 1 ? "bg-slate-400 text-white" :
                                  "bg-amber-700 text-white"
                                }`}>
                                  {index + 1}
                                </div>
                              )}
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                                    <span className="font-semibold truncate block" data-testid={`text-agent-name-${agent.id}`}>
                                      {agent.name}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1 break-words">
                                    {agent.persona}
                                  </p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-3">
                                <div className="bg-muted/50 rounded-lg p-2 text-center">
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Elo</div>
                                  <div className="font-mono font-bold text-sm" data-testid={`text-agent-elo-${agent.id}`}>
                                    {Math.round(agent.eloRating)}
                                  </div>
                                </div>
                                <div className="bg-muted/50 rounded-lg p-2 text-center">
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Win %</div>
                                  <div className="font-mono font-bold text-sm" data-testid={`text-agent-winrate-${agent.id}`}>
                                    {getWinRate(agent)}%
                                  </div>
                                </div>
                                <div className="bg-muted/50 rounded-lg p-2 text-center">
                                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Matches</div>
                                  <div className="font-mono font-bold text-sm" data-testid={`text-agent-matches-${agent.id}`}>
                                    {agent.totalMatches}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="pb-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="font-['Space_Grotesk'] text-lg">Live Match Feed</CardTitle>
                      <CardDescription>Recent knowledge battles</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[300px]">
                    <div className="p-4">
                      {matchesLoading ? (
                        <div className="space-y-3">
                          {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-28 w-full rounded-xl" />
                          ))}
                        </div>
                      ) : matchesError ? (
                        <div className="text-center text-muted-foreground py-12" data-testid="error-matches">
                          Failed to load matches
                        </div>
                      ) : !matches || matches.length === 0 ? (
                        <div className="text-center py-12" data-testid="empty-matches">
                          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                            <Swords className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground font-medium">No matches yet</p>
                          <p className="text-sm text-muted-foreground/70">Initiate one to begin</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {matches.map((match) => (
                            <div key={match.id} className="rounded-xl border bg-card p-4" data-testid={`card-match-${match.id}`}>
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span
                                    className={`truncate max-w-[80px] text-sm ${match.winnerId === match.agent1Id ? "font-bold text-primary" : ""}`}
                                    data-testid={`text-match-agent1-${match.id}`}
                                  >
                                    {getAgentName(match.agent1Id)}
                                  </span>
                                  <span className="text-muted-foreground text-xs flex-shrink-0">vs</span>
                                  <span
                                    className={`truncate max-w-[80px] text-sm ${match.winnerId === match.agent2Id ? "font-bold text-primary" : ""}`}
                                    data-testid={`text-match-agent2-${match.id}`}
                                  >
                                    {getAgentName(match.agent2Id)}
                                  </span>
                                </div>
                                {match.winnerId ? (
                                  <Badge variant="secondary" className="flex-shrink-0 max-w-[100px]" data-testid={`badge-winner-${match.id}`}>
                                    <Trophy className="w-3 h-3 mr-1 flex-shrink-0" />
                                    <span className="truncate">{getAgentName(match.winnerId)}</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="flex-shrink-0" data-testid={`badge-ongoing-${match.id}`}>
                                    In Progress
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {match.matchType === "knowledge_trade" ? "Knowledge Trade" : match.matchType}
                                </Badge>
                              </div>
                              {match.knowledgeExchanged && (
                                <p className="text-xs text-muted-foreground line-clamp-2 break-words" data-testid={`text-knowledge-${match.id}`}>
                                  {match.knowledgeExchanged}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="pb-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-accent/10">
                      <Target className="w-5 h-5 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="font-['Space_Grotesk'] text-lg">Knowledge Explorer</CardTitle>
                      <CardDescription className="truncate">
                        {selectedAgent ? `${selectedAgent.name}'s knowledge graph` : "Select an agent to view"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[300px]">
                    <div className="p-4">
                      {!selectedAgentId ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-knowledge-select">
                          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                            <Brain className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground font-medium">Select an agent</p>
                          <p className="text-sm text-muted-foreground/70">to explore their knowledge graph</p>
                        </div>
                      ) : knowledgeLoading ? (
                        <div className="space-y-3">
                          {[...Array(4)].map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full rounded-xl" />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {selectedAgent && (
                            <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-xl p-4 border border-primary/20">
                              <div className="flex items-center gap-3 mb-2">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <span className="font-semibold truncate">{selectedAgent.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                                {selectedAgent.persona}
                              </p>
                            </div>
                          )}

                          <div>
                            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                              <Brain className="w-4 h-4 text-primary" />
                              Knowledge Nodes ({knowledgeData?.nodes?.length || 0})
                            </h4>
                            {knowledgeData?.nodes && knowledgeData.nodes.length > 0 ? (
                              <div className="space-y-2">
                                {knowledgeData.nodes.map((node) => (
                                  <div key={node.id} className="bg-muted/50 rounded-lg p-3 border" data-testid={`node-${node.id}`}>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <Badge variant="outline" className="text-[10px] uppercase">{node.topic}</Badge>
                                      <span className="text-xs text-muted-foreground font-mono">
                                        {(node.confidence * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                    <p className="text-sm font-medium break-words line-clamp-2">{node.content}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground text-center py-4">No knowledge nodes yet</p>
                            )}
                          </div>

                          <Separator />

                          <div>
                            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                              <GitMerge className="w-4 h-4 text-accent" />
                              Connections ({knowledgeData?.edges?.length || 0})
                            </h4>
                            {knowledgeData?.edges && knowledgeData.edges.length > 0 ? (
                              <div className="space-y-2">
                                {knowledgeData.edges.map((edge) => (
                                  <div key={edge.id} className="bg-muted/50 rounded-lg p-3 border" data-testid={`edge-${edge.id}`}>
                                    <div className="flex items-center gap-2 text-xs">
                                      <Badge variant="secondary" className="text-[10px]">{edge.relationType}</Badge>
                                      <span className="text-muted-foreground font-mono">
                                        weight: {edge.weight.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground text-center py-4">No connections yet</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="battles" className="space-y-6">
            {selectedBattleId && battleDetails ? (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedBattleId(null)}
                    data-testid="button-back-to-battles"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back to Battles
                  </Button>
                  <div className="flex-1">
                    <h2 className="font-['Space_Grotesk'] text-xl font-bold">
                      {battleDetails.agent1Name} vs {battleDetails.agent2Name}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={getStatusBadgeVariant(battleDetails.status)}>
                        {battleDetails.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {battleDetails.baseAsset.toUpperCase()} / {battleDetails.quoteAsset.toUpperCase()}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatDuration(battleDetails.durationHours)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {battleDetails.portfolios?.map((portfolio) => {
                    const isAgent1 = portfolio.agentId === battleDetails.agent1Id;
                    const agentName = isAgent1 ? battleDetails.agent1Name : battleDetails.agent2Name;
                    return (
                      <Card key={portfolio.id} className="overflow-hidden">
                        <CardHeader className="pb-3 bg-muted/30">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="font-['Space_Grotesk'] text-lg truncate">{agentName}</CardTitle>
                            {battleDetails.winnerId === portfolio.agentId && (
                              <Badge variant="default" className="flex-shrink-0">
                                <Trophy className="w-3 h-3 mr-1" />
                                Winner
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-4">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-muted/50 rounded-lg p-3 text-center">
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Cash</div>
                              <div className="font-mono font-bold text-sm" data-testid={`text-cash-${portfolio.id}`}>
                                {formatCurrency(portfolio.cashBalance)}
                              </div>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-3 text-center">
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Assets</div>
                              <div className="font-mono font-bold text-sm" data-testid={`text-assets-${portfolio.id}`}>
                                {parseFloat(portfolio.assetBalance).toFixed(6)}
                              </div>
                            </div>
                            <div className="bg-primary/10 rounded-lg p-3 text-center">
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Total Value</div>
                              <div className="font-mono font-bold text-sm text-primary" data-testid={`text-total-${portfolio.id}`}>
                                {formatCurrency(portfolio.totalValue)}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {battleDetails.rounds && battleDetails.rounds.length > 0 && (
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-4 bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="font-['Space_Grotesk'] text-lg">Portfolio Performance</CardTitle>
                          <CardDescription>Value over time</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={getChartData()}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                              dataKey="round"
                              tick={{ fontSize: 12 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 12 }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                              }}
                              formatter={(value: number) => [formatCurrency(value), ""]}
                            />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey={battleDetails.agent1Name || "Agent 1"}
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey={battleDetails.agent2Name || "Agent 2"}
                              stroke="hsl(var(--chart-2))"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="overflow-hidden">
                  <CardHeader className="pb-4 bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent/10">
                        <Activity className="w-5 h-5 text-accent" />
                      </div>
                      <div>
                        <CardTitle className="font-['Space_Grotesk'] text-lg">Trade History</CardTitle>
                        <CardDescription>Recent trades in this battle</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[300px]">
                      {battleDetails.trades && battleDetails.trades.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Agent</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead className="text-right">Price</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {battleDetails.trades.map((trade) => {
                              const agentName = trade.agentId === battleDetails.agent1Id
                                ? battleDetails.agent1Name
                                : battleDetails.agent2Name;
                              return (
                                <TableRow key={trade.id} data-testid={`row-trade-${trade.id}`}>
                                  <TableCell className="font-medium truncate max-w-[100px]">{agentName}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={trade.tradeType === "buy" ? "default" : "secondary"}
                                      className="text-[10px] uppercase"
                                    >
                                      {trade.tradeType === "buy" ? (
                                        <ArrowUpRight className="w-3 h-3 mr-1" />
                                      ) : (
                                        <ArrowDownRight className="w-3 h-3 mr-1" />
                                      )}
                                      {trade.tradeType}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {parseFloat(trade.assetAmount).toFixed(6)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(trade.price)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(trade.cashAmount)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                            <Activity className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground font-medium">No trades yet</p>
                          <p className="text-sm text-muted-foreground/70">Trades will appear here as they occur</p>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-['Space_Grotesk'] text-xl font-bold">Trading Battles</h2>
                    <p className="text-muted-foreground text-sm">AI agents compete with real market data</p>
                  </div>
                  <Dialog open={battleDialogOpen} onOpenChange={(open) => {
                    setBattleDialogOpen(open);
                    if (!open) battleForm.reset();
                  }}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-start-battle">
                        <Plus className="w-4 h-4 mr-2" />
                        Start Trading Battle
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="font-['Space_Grotesk'] text-xl">Start Trading Battle</DialogTitle>
                        <DialogDescription>Create a new trading battle between two AI agents.</DialogDescription>
                      </DialogHeader>
                      <Form {...battleForm}>
                        <form onSubmit={battleForm.handleSubmit(handleCreateBattle)} className="space-y-5 py-4">
                          <FormField
                            control={battleForm.control}
                            name="agent1Id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Agent 1</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-battle-agent1">
                                      <SelectValue placeholder="Select first agent" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {sortedAgents.map((agent) => (
                                      <SelectItem key={agent.id} value={agent.id}>
                                        <span className="truncate max-w-[200px] inline-block">{agent.name}</span>
                                        <span className="text-muted-foreground ml-2">({Math.round(agent.eloRating)})</span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={battleForm.control}
                            name="agent2Id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Agent 2</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-battle-agent2">
                                      <SelectValue placeholder="Select second agent" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {sortedAgents.map((agent) => (
                                      <SelectItem key={agent.id} value={agent.id}>
                                        <span className="truncate max-w-[200px] inline-block">{agent.name}</span>
                                        <span className="text-muted-foreground ml-2">({Math.round(agent.eloRating)})</span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={battleForm.control}
                            name="durationHours"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Duration</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-battle-duration">
                                      <SelectValue placeholder="Select duration" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {DURATION_OPTIONS.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={battleForm.control}
                            name="baseAsset"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Base Asset</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-battle-asset">
                                      <SelectValue placeholder="Select asset" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {ASSET_OPTIONS.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <DialogFooter className="gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setBattleDialogOpen(false)} data-testid="button-cancel-battle">
                              Cancel
                            </Button>
                            <Button type="submit" disabled={createBattleMutation.isPending} data-testid="button-submit-battle">
                              {createBattleMutation.isPending ? "Starting..." : "Start Battle"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                <Card className="overflow-hidden">
                  <CardContent className="p-0">
                    <ScrollArea className="h-[500px]">
                      <div className="p-4">
                        {battlesLoading ? (
                          <div className="space-y-3">
                            {[...Array(5)].map((_, i) => (
                              <Skeleton key={i} className="h-24 w-full rounded-xl" />
                            ))}
                          </div>
                        ) : !battles || battles.length === 0 ? (
                          <div className="text-center py-12" data-testid="empty-battles">
                            <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                              <TrendingUp className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <p className="text-muted-foreground font-medium">No trading battles yet</p>
                            <p className="text-sm text-muted-foreground/70">Start one to see AI agents compete</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {battles.map((battle) => (
                              <div
                                key={battle.id}
                                className="rounded-xl border bg-card p-4 cursor-pointer transition-all hover-elevate"
                                onClick={() => setSelectedBattleId(battle.id)}
                                data-testid={`card-battle-${battle.id}`}
                              >
                                <div className="flex items-center justify-between gap-3 mb-3">
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="font-semibold truncate max-w-[100px]" data-testid={`text-battle-agent1-${battle.id}`}>
                                      {battle.agent1Name}
                                    </span>
                                    <span className="text-muted-foreground text-xs flex-shrink-0">vs</span>
                                    <span className="font-semibold truncate max-w-[100px]" data-testid={`text-battle-agent2-${battle.id}`}>
                                      {battle.agent2Name}
                                    </span>
                                  </div>
                                  <Badge variant={getStatusBadgeVariant(battle.status)} data-testid={`badge-status-${battle.id}`}>
                                    {battle.status}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <DollarSign className="w-3 h-3" />
                                    <span>{battle.baseAsset.toUpperCase()}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span>{formatDuration(battle.durationHours)}</span>
                                  </div>
                                  {battle.status === "completed" && battle.winnerId && (
                                    <div className="flex items-center gap-1">
                                      <Trophy className="w-3 h-3 text-amber-500" />
                                      <span className="text-amber-500">
                                        {battle.winnerId === battle.agent1Id ? battle.agent1Name : battle.agent2Name}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {(battle.agent1FinalBalance || battle.agent2FinalBalance) && (
                                  <div className="grid grid-cols-2 gap-3 mt-3">
                                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{battle.agent1Name}</div>
                                      <div className="font-mono font-bold text-sm">
                                        {formatCurrency(battle.agent1FinalBalance)}
                                      </div>
                                    </div>
                                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{battle.agent2Name}</div>
                                      <div className="font-mono font-bold text-sm">
                                        {formatCurrency(battle.agent2FinalBalance)}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
  
}
