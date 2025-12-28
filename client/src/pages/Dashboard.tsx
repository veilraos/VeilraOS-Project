import { BalanceCard } from "@/components/BalanceCard";
import { TransferForm } from "@/components/TransferForm";
import { TransactionHistory } from "@/components/TransactionHistory";
import { AlertTriangle, Shield, Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <EyeOff className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">
                Privacy-Focused Transfers
              </p>
              <p className="text-sm text-muted-foreground">
                We don't collect additional metadata. Direct wallet-to-wallet transfers.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
              <Shield className="w-3 h-3 text-green-600 dark:text-green-400" />
              <span className="text-xs font-medium text-green-700 dark:text-green-400">Secure</span>
            </div>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/50">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm text-amber-800 dark:text-amber-200">
                Mainnet Environment
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300/80">
                All transactions use real SOL. Double-check addresses before sending.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <BalanceCard />
            <TransferForm />
          </div>
          <div className="space-y-6">
            <TransactionHistory />
            <Card className="shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-full bg-muted">
                    <Eye className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="font-serif font-semibold mb-2">Privacy Features</h4>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-1">1.</span>
                        <span>No additional metadata collection beyond what's on-chain</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-1">2.</span>
                        <span>No tracking cookies or analytics on your transfers</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-1">3.</span>
                        <span>Direct wallet-to-wallet transfers via Solana blockchain</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
