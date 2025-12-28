import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
  History,
} from "lucide-react";
import type { Transaction } from "@shared/schema";

export function TransactionHistory() {
  const { publicKey, connected } = useWallet();

  const { data: transactions, isLoading, isError, error, refetch } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return [];
      const res = await fetch(`/api/transactions?address=${publicKey.toBase58()}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: connected && !!publicKey,
    retry: 2,
  });

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatDate = (timestamp: Date | string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge variant="default" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30">
            Confirmed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="default" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30">
            Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (!connected) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <History className="w-5 h-5 text-primary" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Connect your wallet to view transaction history
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-lg">
          <History className="w-5 h-5 text-primary" />
          Transaction History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg bg-muted">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <Clock className="w-8 h-8 text-red-500" />
            </div>
            <h4 className="font-medium mb-1 text-red-600 dark:text-red-400">Failed to load transactions</h4>
            <p className="text-sm text-muted-foreground max-w-[240px] mb-4">
              {error instanceof Error ? error.message : "An error occurred"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-transactions">
              Try Again
            </Button>
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Clock className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="font-medium mb-1">No transactions yet</h4>
            <p className="text-sm text-muted-foreground max-w-[240px]">
              Your transaction history will appear here after you make your first transfer
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => {
              const isSent = tx.fromAddress === publicKey?.toBase58();
              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  data-testid={`row-transaction-${tx.id}`}
                >
                  <div
                    className={`p-2 rounded-full ${
                      isSent
                        ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                        : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    }`}
                  >
                    {isSent ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {isSent ? "Sent" : "Received"}
                      </span>
                      {getStatusBadge(tx.status)}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-1">
                      {isSent ? "To: " : "From: "}
                      {truncateAddress(isSent ? tx.toAddress : tx.fromAddress)}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p
                      className={`font-semibold ${
                        isSent ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                      }`}
                    >
                      {isSent ? "-" : "+"}
                      {parseFloat(tx.amount).toFixed(4)} SOL
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(tx.timestamp)}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    className="flex-shrink-0"
                    data-testid={`button-view-tx-${tx.id}`}
                  >
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View on Solscan"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
