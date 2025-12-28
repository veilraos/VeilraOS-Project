import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BalanceCard() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const {
    data: balance,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["balance", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return 0;
      const lamports = await connection.getBalance(publicKey);
      return lamports / LAMPORTS_PER_SOL;
    },
    enabled: connected && !!publicKey,
    refetchInterval: 30000,
  });

  if (!connected) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Wallet className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-semibold mb-1">
                Connect Your Wallet
              </h3>
              <p className="text-muted-foreground text-sm max-w-[280px]">
                Connect a Solana wallet to view your balance and make transfers
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                Available Balance
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-12 w-48" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span
                  className="font-serif text-4xl font-bold text-foreground"
                  data-testid="text-sol-balance"
                >
                  {balance?.toFixed(4) ?? "0.0000"}
                </span>
                <span className="text-lg font-medium text-muted-foreground">SOL</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-3">
              <Activity className="w-3 h-3 text-green-500" />
              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                Mainnet Connected
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-balance"
            aria-label="Refresh balance"
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
