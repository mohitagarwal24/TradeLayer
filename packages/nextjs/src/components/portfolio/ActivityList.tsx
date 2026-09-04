import { ArrowLeftRight, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ActivityType = 'swap' | 'buy' | 'sell';

interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  time: string;
}

// TODO: Replace with real transaction history from blockchain
const MOCK_ACTIVITIES: Activity[] = [
  { id: '1', type: 'swap', description: 'Swapped 100 USDC → 0.033 ETH', time: '15m ago' },
  { id: '2', type: 'buy', description: 'Bought 0.5 tAAPL', time: '2h ago' },
  { id: '3', type: 'swap', description: 'Swapped 100 USDC → 0.032 ETH', time: '12:08 AM' },
  { id: '4', type: 'sell', description: 'Sold 0.3 tTSLA', time: 'Yesterday' },
  { id: '5', type: 'swap', description: 'Swapped 180 USDC → 0.057 ETH', time: 'Dec 4' },
  { id: '6', type: 'buy', description: 'Bought 1.2 tNVDA', time: 'Dec 3' },
];

const typeConfig: Record<ActivityType, { icon: typeof ArrowLeftRight; color: string; bg: string }> = {
  swap: { icon: ArrowLeftRight, color: 'text-primary', bg: 'bg-primary/20' },
  buy: { icon: TrendingUp, color: 'text-success', bg: 'bg-success/20' },
  sell: { icon: TrendingDown, color: 'text-destructive', bg: 'bg-destructive/20' },
};

export function ActivityList() {
  return (
    <div className="glass-card">
      <div className="p-4 border-b border-border/50">
        <h3 className="font-heading font-semibold text-lg">Recent activity</h3>
        <p className="text-sm text-muted-foreground">{MOCK_ACTIVITIES.length} transactions in the last 7 days</p>
      </div>

      <div className="divide-y divide-border/30">
        {MOCK_ACTIVITIES.map((activity) => {
          const config = typeConfig[activity.type];
          const Icon = config.icon;

          return (
            <div 
              key={activity.id} 
              className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${config.bg}`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground capitalize">{activity.type}</p>
                  <p className="font-medium text-sm">{activity.description}</p>
                </div>
              </div>
              <span className="text-sm text-muted-foreground">{activity.time}</span>
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t border-border/50">
        <Button variant="ghost" className="w-full justify-center gap-2 text-muted-foreground hover:text-foreground">
          View all activity
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
