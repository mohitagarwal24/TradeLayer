import { Link, useLocation } from 'react-router-dom';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/', label: 'Trade' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '#', label: 'Docs' },
  { href: '#', label: 'About' },
];

export function Navbar() {
  const location = useLocation();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-pink-400 flex items-center justify-center">
                <span className="font-heading font-bold text-primary-foreground text-sm">TL</span>
              </div>
              <span className="font-heading font-semibold text-lg text-foreground">TradeLayer</span>
            </div>
            <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">
              Beta
            </span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                  location.pathname === link.href
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Connect Wallet */}
          <ConnectWalletButton />
        </div>
      </div>
    </nav>
  );
}
