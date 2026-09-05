import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Check, Network } from "lucide-react";
import { getTargetNetworks } from "~~/utils/scaffold-eth/networks";

const targetNetworks = getTargetNetworks();

export function NetworkSwitcher() {
  const { chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 rounded-full">
          <Network className="h-4 w-4" />
          <span className="hidden sm:inline">{targetNetworks.find((n) => n.id === chainId)?.name ?? "Wrong Network"}</span>
          <span className="sm:hidden">{targetNetworks.find((n) => n.id === chainId)?.name.split(" ")[0] ?? "Network"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 bg-popover border-border">
        {targetNetworks.map((network) => (
          <DropdownMenuItem
            key={network.id}
            onClick={() => switchChain({ chainId: network.id })}
            disabled={isPending}
            className="gap-2 cursor-pointer"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: Array.isArray(network.color) ? network.color[0] : network.color }}
            />
            {network.name}
            {chainId === network.id && <Check className="ml-auto h-4 w-4 text-success" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
