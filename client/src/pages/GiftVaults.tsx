import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Gift,
  Copy,
  Check,
  Loader2,
  Wallet,
  ArrowRight,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
} from "lucide-react";

const createVaultSchema = z.object({
  amount: z.string().refine((v) => parseFloat(v) > 0, "Amount must be positive"),
  expiresInDays: z.string().optional(),
});

const claimVaultSchema = z.object({
  code: z.string().min(4, "Code is required"),
});

type PoolInfo = {
  poolAddress: string;
  poolTokenAddress: string;
  tokenMint: string;
  balance: number;
};

type VaultPreview = {
  id: string;
  amount: number;
  tokenMint: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

type CreatedVault = {
  id: string;
  code: string;
  amount: number;
  poolAddress: string;
  status: string;
};

type MyVault = {
  id: string;
  code: string;
  amount: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  claimedAt: string | null;
};

export default function GiftVaults() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [createdVault, setCreatedVault] = useState<CreatedVault | null>(null);
  const [vaultPreview, setVaultPreview] = useState<VaultPreview | null>(null);
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositSignature, setDepositSignature] = useState("");
  const [activatingVaultId, setActivatingVaultId] = useState<string | null>(null);

  const { data: poolInfo } = useQuery<PoolInfo>({
    queryKey: ["/api/gift-vaults/pool-info"],
    enabled: true,
  });

  const { data: myVaults, isLoading: loadingVaults } = useQuery<MyVault[]>({
    queryKey: ["/api/gift-vaults/creator", publicKey?.toBase58()],
    enabled: !!publicKey,
  });

  const createForm = useForm({
    resolver: zodResolver(createVaultSchema),
    defaultValues: {
      amount: "",
      expiresInDays: "30",
    },
  });

  const claimForm = useForm({
    resolver: zodResolver(claimVaultSchema),
    defaultValues: {
      code: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { amount: string; expiresInDays?: string }) => {
      const response = await apiRequest("POST", "/api/gift-vaults", {
        creatorAddress: publicKey?.toBase58(),
        amount: parseFloat(data.amount),
        expiresInDays: data.expiresInDays ? parseInt(data.expiresInDays) : undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setCreatedVault(data);
      queryClient.invalidateQueries({ queryKey: ["/api/gift-vaults/creator"] });
      toast({
        title: "Gift Vault Created",
        description: "Now deposit tokens to activate it.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create gift vault",
        variant: "destructive",
      });
    },
  });

  const extractSignature = (input: string): string => {
    const trimmed = input.trim();
    // If it's a URL, extract the signature from the path
    if (trimmed.includes("/tx/")) {
      const parts = trimmed.split("/tx/");
      return parts[parts.length - 1].split("?")[0].split("#")[0];
    }
    // If it's a Solscan URL
    if (trimmed.includes("/tx/")) {
      const match = trimmed.match(/\/tx\/([A-Za-z0-9]+)/);
      if (match) return match[1];
    }
    return trimmed;
  };

  const handleVerifyDeposit = async (vaultId: string) => {
    if (!depositSignature.trim()) {
      toast({
        title: "Signature Required",
        description: "Please paste your transaction signature or URL",
        variant: "destructive",
      });
      return;
    }

    const signature = extractSignature(depositSignature);
    console.log("Extracted signature:", signature);

    setIsDepositing(true);
    try {
      const verifyResponse = await apiRequest("POST", `/api/gift-vaults/${vaultId}/verify-deposit`, {
        signature,
      });

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json();
        throw new Error(error.error || "Verification failed");
      }

      setCreatedVault(null);
      setDepositSignature("");
      setActivatingVaultId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/gift-vaults/creator"] });
      toast({
        title: "Vault Activated!",
        description: "Your Gift Vault is now ready to be claimed",
      });
    } catch (error: any) {
      console.error("Verify error:", error);
      toast({
        title: "Verification Failed",
        description: error.message || "Could not verify deposit. Make sure the transaction was confirmed.",
        variant: "destructive",
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const checkMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetch(`/api/gift-vaults/check/${code}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Vault not found");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setVaultPreview(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      setVaultPreview(null);
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!signMessage) {
        throw new Error("Wallet does not support message signing");
      }
      
      const message = `Claim gift vault with code: ${code.toUpperCase()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signatureBase64 = btoa(String.fromCharCode.apply(null, Array.from(signatureBytes)));
      
      const response = await apiRequest("POST", "/api/gift-vaults/claim", {
        code,
        claimerAddress: publicKey?.toBase58(),
        signature: signatureBase64,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Tokens Claimed!",
        description: `Successfully claimed ${data.amount} VEILRA tokens`,
      });
      setVaultPreview(null);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Claim Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "funded":
        return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
      case "claimed":
        return <Badge variant="outline"><Check className="w-3 h-3 mr-1" />Claimed</Badge>;
      case "expired":
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Expired</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-primary/10 mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-bold mb-2">Gift Vaults</h1>
          <p className="text-muted-foreground">
            Create shareable codes to gift VeilraOS tokens to anyone
          </p>
        </div>

        {!connected ? (
          <Card className="shadow-sm">
            <CardContent className="p-12 text-center">
              <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-semibold text-lg mb-2">Connect Your Wallet</h3>
              <p className="text-muted-foreground mb-4">
                Connect your Solana wallet to create or claim gift vaults
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="create" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create" data-testid="tab-create">Create Vault</TabsTrigger>
              <TabsTrigger value="claim" data-testid="tab-claim">Claim Tokens</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-6">
              {createdVault ? (
                <Card className="shadow-sm border-primary/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      Vault Created
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground mb-2">Your Gift Code</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-2xl font-bold tracking-wider">
                          {createdVault.code}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(createdVault.code)}
                          data-testid="button-copy-code"
                        >
                          {copiedCode === createdVault.code ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="p-4 bg-primary/10 rounded-lg border border-primary/20 space-y-4">
                      <div>
                        <p className="text-sm font-medium mb-2">Step 1: Send {createdVault.amount} VEILRA tokens to:</p>
                        <div className="flex items-center gap-2 bg-background rounded p-2">
                          <code className="flex-1 font-mono text-xs break-all">
                            {poolInfo?.poolAddress || "Loading..."}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => poolInfo?.poolAddress && copyToClipboard(poolInfo.poolAddress)}
                            data-testid="button-copy-pool-address"
                          >
                            {copiedCode === poolInfo?.poolAddress ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Open Phantom, send VEILRA tokens to this wallet address
                        </p>
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Step 2: Paste your transaction signature:</p>
                        <Input
                          placeholder="Enter transaction signature..."
                          value={depositSignature}
                          onChange={(e) => setDepositSignature(e.target.value)}
                          className="font-mono text-xs"
                          data-testid="input-deposit-signature"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          After sending, copy the signature from Phantom or Solscan
                        </p>
                      </div>

                      <Button
                        className="w-full"
                        onClick={() => handleVerifyDeposit(createdVault.id)}
                        disabled={isDepositing || !depositSignature.trim()}
                        data-testid="button-verify-deposit"
                      >
                        {isDepositing ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-2" />
                        )}
                        {isDepositing ? "Verifying..." : "Verify & Activate"}
                      </Button>
                    </div>

                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => setCreatedVault(null)}
                      disabled={isDepositing}
                      data-testid="button-create-another"
                    >
                      Create Another Vault
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Create Gift Vault</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...createForm}>
                      <form
                        onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))}
                        className="space-y-4"
                      >
                        <FormField
                          control={createForm.control}
                          name="amount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Amount (VEILRA)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.000000001"
                                  placeholder="100"
                                  {...field}
                                  data-testid="input-amount"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={createForm.control}
                          name="expiresInDays"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Expires In (days)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  max="365"
                                  placeholder="30"
                                  {...field}
                                  data-testid="input-expires"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button
                          type="submit"
                          className="w-full"
                          disabled={createMutation.isPending}
                          data-testid="button-create-vault"
                        >
                          {createMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Gift className="w-4 h-4 mr-2" />
                          )}
                          Create Gift Vault
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}

              {myVaults && myVaults.length > 0 && (
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Your Gift Vaults</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {myVaults.map((vault) => (
                        <div
                          key={vault.id}
                          className="p-3 rounded-lg border bg-card space-y-3"
                          data-testid={`vault-${vault.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <code className="font-mono text-sm font-bold">{vault.code}</code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(vault.code)}
                              >
                                {copiedCode === vault.code ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </Button>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">{vault.amount} VEILRA</span>
                              {getStatusBadge(vault.status)}
                            </div>
                          </div>
                          
                          {vault.status === "pending" && (
                            <div className="pt-2 border-t space-y-2">
                              {activatingVaultId === vault.id ? (
                                <>
                                  <p className="text-xs text-muted-foreground">
                                    Send {vault.amount} VEILRA to: <code className="font-mono">{poolInfo?.poolAddress}</code>
                                  </p>
                                  <div className="flex gap-2">
                                    <Input
                                      placeholder="Paste transaction signature..."
                                      value={depositSignature}
                                      onChange={(e) => setDepositSignature(e.target.value)}
                                      className="flex-1 font-mono text-xs"
                                    />
                                    <Button
                                      size="sm"
                                      onClick={() => handleVerifyDeposit(vault.id)}
                                      disabled={isDepositing || !depositSignature.trim()}
                                    >
                                      {isDepositing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
                                    </Button>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setActivatingVaultId(null);
                                      setDepositSignature("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setActivatingVaultId(vault.id)}
                                  data-testid={`button-activate-${vault.id}`}
                                >
                                  <Send className="w-3 h-3 mr-1" />
                                  Activate Vault
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="claim" className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Claim Gift Tokens</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Form {...claimForm}>
                    <form
                      onSubmit={claimForm.handleSubmit((data) => {
                        if (vaultPreview && vaultPreview.status === "funded") {
                          claimMutation.mutate(data.code);
                        } else {
                          checkMutation.mutate(data.code);
                        }
                      })}
                      className="space-y-4"
                    >
                      <FormField
                        control={claimForm.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Gift Code</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Enter your gift code"
                                className="font-mono text-lg tracking-wider"
                                {...field}
                                onChange={(e) => {
                                  field.onChange(e.target.value.toUpperCase());
                                  setVaultPreview(null);
                                }}
                                data-testid="input-claim-code"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {vaultPreview && (
                        <div className="p-4 bg-muted rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Amount</span>
                            <span className="font-bold">{vaultPreview.amount} VEILRA</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Status</span>
                            {getStatusBadge(vaultPreview.status)}
                          </div>
                        </div>
                      )}

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={
                          checkMutation.isPending ||
                          claimMutation.isPending ||
                          !!(vaultPreview && vaultPreview.status !== "funded")
                        }
                        data-testid="button-claim"
                      >
                        {checkMutation.isPending || claimMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : vaultPreview ? (
                          <>
                            <ArrowRight className="w-4 h-4 mr-2" />
                            Claim Tokens
                          </>
                        ) : (
                          <>
                            <Gift className="w-4 h-4 mr-2" />
                            Check Code
                          </>
                        )}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {poolInfo && (
          <div className="mt-8 p-4 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground text-center">
              Token: VEILRA ({poolInfo.tokenMint.substring(0, 8)}...)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
