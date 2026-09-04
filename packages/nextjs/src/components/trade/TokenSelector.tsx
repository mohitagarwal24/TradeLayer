import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface Token {
  symbol: string;
  name: string;
  icon: string;
}

interface TokenSelectorProps {
  tokens: Token[];
  value: string;
  onValueChange: (value: string) => void;
}

export function TokenSelector({ tokens, value, onValueChange }: TokenSelectorProps) {
  const selectedToken = tokens.find((t) => t.symbol === value);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-32 bg-secondary border-0 rounded-full h-10">
        <SelectValue>
          {selectedToken && (
            <div className="flex items-center gap-2">
              <span className="text-lg">{selectedToken.icon}</span>
              <span className="font-medium">{selectedToken.symbol}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-popover border-border">
        {tokens.map((token) => (
          <SelectItem key={token.symbol} value={token.symbol} className="cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="text-lg">{token.icon}</span>
              <div className="flex flex-col">
                <span className="font-medium">{token.symbol}</span>
                <span className="text-xs text-muted-foreground">{token.name}</span>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
