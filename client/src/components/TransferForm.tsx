import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, AlertTriangle, Loader2, Send, Shield } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const transferSchema = z.object({
  recipient: z
    .string()
    .min(32, "Invalid Solana address")
    .max(44, "Invalid Solana address")
    .refine(
      (val) => {
        try {
          new PublicKey(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid Solana address format" }
    ),
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Amount must be greater than 0",
    })
    .refine((val) => parseFloat(val) >= 0.001, {
      message: "Minimum amount is 0.001 SOL for private transfers",
    }),
});

type TransferFormData = z.infer<typeof transferSchema>;

export function TransferForm() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<TransferFormData | null>(null);
  const [transferStep, setTransferStep] = useState<"idle" | "sending" | "confirming" | "complete">("idle");

  const { data: poolData } = useQuery<{ poolAddress: string }>({
    queryKey: ["/api/pool-address"],
    enabled: connected,
  });

  const form = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      recipient: "",
      amount: "",
    },
  });

  const privateTransferMutation = useMutation({
    mutationFn: async (data: TransferFormData) => {
      if (!publicKey) throw new Error("Wallet not connected");
      if (!poolData?.poolAddress) throw new Error("Private transfer not available");

      setTransferStep("sending");

      const sessionResponse = await apiRequest("POST", "/api/mixer/sessions", {
        senderAddress: publicKey.toBase58(),
        recipientAddress: data.recipient,
        amount: data.amount,
      });
      const session = await sessionResponse.json();

      const poolPubkey = new PublicKey(poolData.poolAddress);
      const lamports = Math.floor(parseFloat(data.amount) * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: poolPubkey,
          lamports,
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const depositSignature = await sendTransaction(transaction, connection);

      await connection.confirmTransaction({
        signature: depositSignature,
        blockhash,
        lastValidBlockHeight,
      });

      setTransferStep("confirming");

      const confirmResponse = await apiRequest("POST", `/api/mixer/sessions/${session.sessionId}/confirm-deposit`, {
        depositSignature,
      });
      const result = await confirmResponse.json();

      if (!confirmResponse.ok) {
        throw new Error(result.error || "Failed to complete private transfer");
      }

      setTransferStep("complete");

      return {
        sessionId: session.sessionId,
        depositSignature,
        payoutSignature: result.payoutSignature,
      };
    },
    onSuccess: (result) => {
      toast({
        title: "Private Transfer Complete",
        description: (
          <div className="flex flex-col gap-1">
            <span>Your SOL has been privately sent to the recipient.</span>
            <a
              href={`https://solscan.io/tx/${result.payoutSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm"
            >
              View on Solscan
            </a>
          </div>
        ),
      });
      form.reset();
      setShowConfirmation(false);
      setConfirmChecked(false);
      setPendingTransfer(null);
      setTransferStep("idle");
      queryClient.invalidateQueries({ queryKey: ["balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mixer/sessions"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Transfer Failed",
        description: error.message,
        variant: "destructive",
      });
      setShowConfirmation(false);
      setConfirmChecked(false);
      setTransferStep("idle");
    },
  });

  const onSubmit = (data: TransferFormData) => {
    setPendingTransfer(data);
    setShowConfirmation(true);
  };

  const confirmTransfer = () => {
    if (pendingTransfer && confirmChecked) {
      privateTransferMutation.mutate(pendingTransfer);
    }
  };

  const getStepMessage = () => {
    switch (transferStep) {
      case "sending":
        return "Sending to privacy pool...";
      case "confirming":
        return "Forwarding to recipient...";
      case "complete":
        return "Transfer complete!";
      default:
        return "Processing...";
    }
  };

  if (!connected) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Shield className="w-5 h-5 text-primary" />
            Private Transfer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Connect your wallet to send SOL privately
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Shield className="w-5 h-5 text-primary" />
            Private Transfer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="recipient"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Recipient Address
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter Solana wallet address"
                        className="font-mono text-sm h-11"
                        data-testid="input-recipient-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Amount (SOL)
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.001"
                        min="0.001"
                        placeholder="0.00"
                        className="text-xl font-semibold h-11"
                        data-testid="input-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="p-4 rounded-lg bg-muted space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Transfer Type</span>
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-primary" />
                    Private
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Network Fee (2 txns)</span>
                  <span className="font-mono text-sm">~0.00001 SOL</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recipient receives amount minus small network fee (~0.000005 SOL)
                </p>
              </div>

              {!poolData?.poolAddress && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Private transfer pool not configured. Please contact support.
                  </p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11"
                disabled={privateTransferMutation.isPending || !poolData?.poolAddress}
                data-testid="button-review-transfer"
              >
                {privateTransferMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {getStepMessage()}
                  </>
                ) : (
                  <>
                    Review Private Transfer
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl">
              <Shield className="w-5 h-5 text-primary" />
              Confirm Private Transfer
            </DialogTitle>
            <DialogDescription>
              Review and confirm your transfer details below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    Mainnet Transaction
                  </p>
                  <p className="text-amber-700 dark:text-amber-300/80 mt-1">
                    This will send real SOL. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 rounded-lg bg-muted">
              <div className="flex justify-between items-center gap-4">
                <span className="text-sm text-muted-foreground">To</span>
                <span
                  className="font-mono text-sm max-w-[200px] truncate"
                  data-testid="text-confirm-recipient"
                >
                  {pendingTransfer?.recipient}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span
                  className="font-semibold text-lg"
                  data-testid="text-confirm-amount"
                >
                  {pendingTransfer?.amount} SOL
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg border">
              <Checkbox
                id="confirm-checkbox"
                checked={confirmChecked}
                onCheckedChange={(checked) =>
                  setConfirmChecked(checked === true)
                }
                data-testid="checkbox-confirm-transfer"
              />
              <label
                htmlFor="confirm-checkbox"
                className="text-sm text-muted-foreground cursor-pointer leading-relaxed"
              >
                I understand this is a real transaction on Solana mainnet and
                cannot be reversed.
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmation(false);
                setConfirmChecked(false);
              }}
              data-testid="button-cancel-transfer"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmTransfer}
              disabled={!confirmChecked || privateTransferMutation.isPending}
              data-testid="button-confirm-transfer"
            >
              {privateTransferMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {getStepMessage()}
                </>
              ) : (
                "Confirm & Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
