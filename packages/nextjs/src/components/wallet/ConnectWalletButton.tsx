import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wallet, LogOut, Copy, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getTargetNetworks } from "~~/utils/scaffold-eth/networks";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const targetNetworks = getTargetNetworks();

export function ConnectWalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  const handleConnect = () => {
    const injectedConnector = connectors.find((c) => c.id === "injected");
    if (injectedConnector) {
      connect(
        { connector: injectedConnector },
        {
          onError: () => {
            toast.error("Failed to connect wallet. Please make sure MetaMask is installed.");
          },
        },
      );
    } else {
      toast.error("No wallet found. Please install MetaMask.");
    }
  };

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const connectedChain = targetNetworks.find((n) => n.id === chainId);

  if (isConnected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 rounded-full px-4">
            <div className={`h-2 w-2 rounded-full ${connectedChain ? "bg-success" : "bg-destructive"} animate-pulse`} />
            <span className="font-mono text-sm">{shortenAddress(address)}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-popover border-border">
          <DropdownMenuLabel className="font-mono text-xs">{shortenAddress(address)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Network:{" "}
            <span className={connectedChain ? "text-success" : "text-destructive font-medium"}>
              {connectedChain ? connectedChain.name : `unsupported (chain ${chainId ?? "?"})`}
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyAddress} className="gap-2 cursor-pointer">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy Address
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => disconnect()} className="gap-2 cursor-pointer text-destructive">
            <LogOut className="h-4 w-4" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button onClick={handleConnect} disabled={isPending} className="gap-2 rounded-full bg-primary hover:bg-primary/90">
      <Wallet className="h-4 w-4" />
      {isPending ? "Connecting..." : "Connect Wallet"}
    </Button>
  );
}
