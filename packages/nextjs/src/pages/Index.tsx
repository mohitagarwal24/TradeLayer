import { TradingCard } from '@/components/trade/TradingCard';

const Index = () => {
  return (
    <main className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-heading font-bold mb-4 text-balance">
            Trade real-world assets
            <br />
            <span className="gradient-text">with crypto.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto text-balance">
            TradeLayer unifies stock markets and crypto liquidity into one private trading layer.
          </p>
        </div>

        {/* Trading Card */}
        <div className="flex justify-center">
          <TradingCard />
        </div>
      </div>
    </main>
  );
};

export default Index;
