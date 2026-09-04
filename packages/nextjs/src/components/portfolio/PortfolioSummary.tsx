import { TrendingDown } from 'lucide-react';

// TODO: Replace with real portfolio data from blockchain
const MOCK_PORTFOLIO = {
  totalValue: 1623.43,
  change: -67.52,
  changePercent: -4,
};

export function PortfolioSummary() {
  const isNegative = MOCK_PORTFOLIO.change < 0;

  return (
    <div className="glass-card p-6 relative overflow-hidden">
      {/* Background Sparkline SVG */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 400 150"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,100 Q50,80 100,90 T200,70 T300,85 T400,60 L400,150 L0,150 Z"
          className="sparkline-gradient"
        />
        <path
          d="M0,100 Q50,80 100,90 T200,70 T300,85 T400,60"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          fill="none"
        />
      </svg>

      <div className="relative z-10">
        <div className="mb-4">
          <h2 className="text-4xl font-heading font-bold text-foreground">
            ${MOCK_PORTFOLIO.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </h2>
          <div className={`flex items-center gap-1 mt-1 ${isNegative ? 'text-destructive' : 'text-success'}`}>
            <TrendingDown className="h-4 w-4" />
            <span className="text-sm font-medium">
              ${Math.abs(MOCK_PORTFOLIO.change).toFixed(2)} ({Math.abs(MOCK_PORTFOLIO.changePercent)}%) today
            </span>
          </div>
        </div>

        {/* Time Range Buttons */}
        <div className="flex gap-2">
          {['1D', '1W', '1M', '1Y'].map((range, i) => (
            <button
              key={range}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                i === 0
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
