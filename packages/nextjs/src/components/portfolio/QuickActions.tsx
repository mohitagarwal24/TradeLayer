import { Link } from 'react-router-dom';
import { ArrowLeftRight, Download, Upload, MoreHorizontal } from 'lucide-react';

const actions = [
  { label: 'Trade', icon: ArrowLeftRight, href: '/', color: 'text-primary' },
  { label: 'Deposit', icon: Download, href: '#', color: 'text-glow-cyan' },
  { label: 'Withdraw', icon: Upload, href: '#', color: 'text-glow-green' },
  { label: 'More', icon: MoreHorizontal, href: '#', color: 'text-muted-foreground' },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action) => (
        <Link
          key={action.label}
          to={action.href}
          className="glass-card-hover p-4 flex flex-col gap-2"
        >
          <action.icon className={`h-6 w-6 ${action.color}`} />
          <span className={`font-medium ${action.color}`}>{action.label}</span>
        </Link>
      ))}
    </div>
  );
}
