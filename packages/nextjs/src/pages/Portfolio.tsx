import { useAccount } from 'wagmi';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortfolioSummary } from '@/components/portfolio/PortfolioSummary';
import { QuickActions } from '@/components/portfolio/QuickActions';
import { TokensTable } from '@/components/portfolio/TokensTable';
import { ActivityList } from '@/components/portfolio/ActivityList';
import { useConnect } from 'wagmi';
import { toast } from 'sonner';

function ConnectPrompt() {
  const { connect, connectors, isPending } = useConnect();

  const handleConnect = () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector) {
      connect({ connector: injectedConnector }, {
        onError: () => {
          toast.error('Failed to connect wallet. Please make sure MetaMask is installed.');
        }
      });
    } else {
      toast.error('No wallet found. Please install MetaMask.');
    }
  };

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="glass-card p-8 max-w-md w-full">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6">
          <Wallet className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-heading font-bold mb-2">Connect your wallet</h2>
        <p className="text-muted-foreground mb-6">
          Connect your wallet to view your TradeLayer portfolio.
        </p>
        <Button 
          onClick={handleConnect}
          disabled={isPending}
          className="w-full h-12 text-lg font-semibold rounded-xl bg-primary hover:bg-primary/90"
        >
          <Wallet className="h-5 w-5 mr-2" />
          {isPending ? 'Connecting...' : 'Connect Wallet'}
        </Button>
      </div>
    </div>
  );
}

function PortfolioContent({ address }: { address: string }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-pink-400 flex items-center justify-center">
          <span className="font-bold text-primary-foreground">◆</span>
        </div>
        <span className="font-mono text-lg">{`${address.slice(0, 6)}…${address.slice(-4)}`}</span>
      </div>

      {/* Top Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioSummary />
        </div>
        <div>
          <QuickActions />
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TokensTable />
        <ActivityList />
      </div>
    </div>
  );
}

const Portfolio = () => {
  const { address, isConnected } = useAccount();

  return (
    <main className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4">
        {isConnected && address ? (
          <PortfolioContent address={address} />
        ) : (
          <ConnectPrompt />
        )}
      </div>
    </main>
  );
};

export default Portfolio;
