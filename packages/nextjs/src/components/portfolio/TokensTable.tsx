// TODO: Replace with real token balance data from blockchain
const MOCK_TOKENS = [
  { symbol: 'ETH', name: 'Base ETH', icon: '⟠', price: 3020.20, balance: 0.488, value: 1473.86 },
  { symbol: 'ETH', name: 'Ethereum', icon: '⟠', price: 3020.20, balance: 0.00016, value: 0.47 },
  { symbol: 'tAAPL', name: 'Tokenized Apple', icon: '🍎', price: 210.00, balance: 4.5, value: 945.00 },
  { symbol: 'tTSLA', name: 'Tokenized Tesla', icon: '🚗', price: 180.00, balance: 1.2, value: 216.00 },
  { symbol: 'USDC', name: 'USD Coin', icon: '💵', price: 1.00, balance: 25, value: 25.00 },
];

export function TokensTable() {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-border/50">
        <h3 className="font-heading font-semibold text-lg">Tokens</h3>
        <p className="text-sm text-muted-foreground">{MOCK_TOKENS.length} tokens</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">Token</th>
              <th className="text-right text-sm font-medium text-muted-foreground px-4 py-3">Price</th>
              <th className="text-right text-sm font-medium text-muted-foreground px-4 py-3">Balance</th>
              <th className="text-right text-sm font-medium text-muted-foreground px-4 py-3">Value</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_TOKENS.map((token, index) => (
              <tr 
                key={`${token.symbol}-${index}`}
                className="border-b border-border/30 last:border-0 hover:bg-secondary/30 transition-colors"
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{token.icon}</span>
                    <div>
                      <p className="font-medium">{token.name}</p>
                      <p className="text-sm text-muted-foreground">{token.symbol}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-right font-mono">
                  ${token.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-4 text-right font-mono">
                  {token.balance < 0.001 ? '<0.001' : token.balance} {token.symbol}
                </td>
                <td className="px-4 py-4 text-right font-mono font-medium">
                  ${token.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
