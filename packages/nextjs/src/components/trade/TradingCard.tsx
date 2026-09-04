import { useState, useEffect } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TokenSelector, Token } from './TokenSelector';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';

const sellTokens: Token[] = [
  { symbol: 'ETH', name: 'Ethereum', icon: '⟠' },
  { symbol: 'USDC', name: 'USD Coin', icon: '💵' },
  { symbol: 'USDT', name: 'Tether', icon: '💲' },
];

const buyTokens: Token[] = [
  { symbol: 'tAAPL', name: 'Tokenized Apple', icon: '🍎' },
  { symbol: 'tTSLA', name: 'Tokenized Tesla', icon: '🚗' },
  { symbol: 'tNVDA', name: 'Tokenized Nvidia', icon: '🎮' },
];

// TODO: Replace with real price oracle data
const MOCK_RATES: Record<string, Record<string, number>> = {
  ETH: { tAAPL: 14.38, tTSLA: 16.78, tNVDA: 22.45 },
  USDC: { tAAPL: 0.00476, tTSLA: 0.00556, tNVDA: 0.00743 },
  USDT: { tAAPL: 0.00476, tTSLA: 0.00556, tNVDA: 0.00743 },
};

// TODO: Replace with real price data
const MOCK_USD_PRICES: Record<string, number> = {
  ETH: 3020.20,
  USDC: 1.00,
  USDT: 1.00,
};

export function TradingCard() {
  const { isConnected } = useAccount();
  const [sellToken, setSellToken] = useState('ETH');
  const [buyToken, setBuyToken] = useState('tAAPL');
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');

  useEffect(() => {
    if (sellAmount && !isNaN(Number(sellAmount))) {
      const rate = MOCK_RATES[sellToken]?.[buyToken] || 0;
      const calculated = (Number(sellAmount) * rate).toFixed(4);
      setBuyAmount(calculated);
    } else {
      setBuyAmount('');
    }
  }, [sellAmount, sellToken, buyToken]);

  const usdValue = sellAmount && !isNaN(Number(sellAmount))
    ? (Number(sellAmount) * MOCK_USD_PRICES[sellToken]).toFixed(2)
    : '0.00';

  const handleTrade = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet first');
      return;
    }
    // TODO: Implement actual trade logic
    toast.success(`Trade submitted: ${sellAmount} ${sellToken} → ${buyAmount} ${buyToken}`);
  };

  const rate = MOCK_RATES[sellToken]?.[buyToken] || 0;

  return (
    <div className="glass-card p-1 max-w-md w-full glow-pink">
      <div className="bg-card rounded-2xl p-4 space-y-2">
        {/* Sell Panel */}
        <div className="bg-secondary/50 rounded-2xl p-4 space-y-2">
          <span className="text-sm text-muted-foreground">Sell</span>
          <div className="flex items-center justify-between gap-4">
            <Input
              type="number"
              placeholder="0"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              className="border-0 bg-transparent text-3xl font-medium p-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
            <TokenSelector
              tokens={sellTokens}
              value={sellToken}
              onValueChange={setSellToken}
            />
          </div>
          <span className="text-sm text-muted-foreground">≈ ${usdValue}</span>
        </div>

        {/* Swap Arrow */}
        <div className="flex justify-center -my-1 relative z-10">
          <button className="p-2 bg-secondary rounded-xl border-4 border-card hover:bg-muted transition-colors">
            <ArrowDown className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Buy Panel */}
        <div className="bg-secondary/50 rounded-2xl p-4 space-y-2">
          <span className="text-sm text-muted-foreground">Buy</span>
          <div className="flex items-center justify-between gap-4">
            <Input
              type="text"
              placeholder="0"
              value={buyAmount}
              readOnly
              className="border-0 bg-transparent text-3xl font-medium p-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
            <TokenSelector
              tokens={buyTokens}
              value={buyToken}
              onValueChange={setBuyToken}
            />
          </div>
        </div>

        {/* Trade Button */}
        <Button 
          onClick={handleTrade}
          className="w-full h-14 text-lg font-semibold rounded-2xl bg-primary hover:bg-primary/90 transition-all"
          disabled={!sellAmount || Number(sellAmount) <= 0}
        >
          {isConnected ? 'Trade Now' : 'Connect Wallet to Trade'}
        </Button>

        {/* Rate Info */}
        <p className="text-center text-sm text-muted-foreground">
          1 {sellToken} ≈ {rate.toFixed(2)} {buyToken} <span className="text-muted-foreground/60">(mock rate)</span>
        </p>
      </div>
    </div>
  );
}
