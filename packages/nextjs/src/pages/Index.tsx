import { TradingPanel } from "@/components/trade/TradingPanel";
import { MarketTicker } from "@/components/trade/MarketTicker";

const Index = () => {
  return (
    <main className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-heading font-bold mb-3 text-balance">
            Trade real-world assets
            <br />
            <span className="gradient-text">with crypto.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance mb-6">
            Escrowed equity orders, oracle-settled on-chain. Your positions are yours — DSTOCK cannot be transferred
            out from under you.
          </p>
          <MarketTicker />
        </div>

        {/* Trading */}
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <TradingPanel />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Index;
