import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ThemeToggle } from "./ThemeToggle";
import { SiGithub, SiX } from "react-icons/si";
import { Button } from "@/components/ui/button";
import logoImage from "@assets/2025-12-28_15.45.39_1766912052974.jpg";

export function Header() {
  const { publicKey, connected } = useWallet();

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 px-6 h-16">
        <div className="flex items-center gap-3">
          <img
            src={logoImage}
            alt="VeilraOS"
            className="h-9 w-9 rounded-lg object-cover shadow-sm"
            data-testid="img-logo"
          />
          <div className="flex flex-col">
            <span className="font-serif text-lg font-bold text-foreground">
              VeilraOS
            </span>
            <span className="text-[10px] text-muted-foreground font-medium tracking-wide">
              Private Transfer
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            asChild
            data-testid="link-github"
          >
            <a
              href="https://github.com/veilraos"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <SiGithub className="w-4 h-4" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            data-testid="link-x"
          >
            <a
              href="https://x.com/veilraos"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
            >
              <SiX className="w-4 h-4" />
            </a>
          </Button>
          {connected && publicKey && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="font-mono text-sm text-muted-foreground" data-testid="text-wallet-address">
                {truncateAddress(publicKey.toBase58())}
              </span>
            </div>
          )}
          <WalletMultiButton data-testid="button-connect-wallet" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
