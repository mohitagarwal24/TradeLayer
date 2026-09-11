import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useMembership } from "@/hooks/useMembership";
import { cn } from "@/lib/utils";

/** Navigation reflects what this wallet can actually do — no dead links to screens with no role. */
function useNavItems() {
  const { role } = useMembership();
  const items: Array<{ to: string; label: string }> = [];
  if (role === "admin") items.push({ to: "/institution", label: "Institution" });
  if (role === "admin" || role === "member") {
    items.push({ to: "/trade", label: "Trade" }, { to: "/positions", label: "Positions" });
  }
  return items;
}

export function Navbar() {
  const { pathname } = useLocation();
  const items = useNavItems();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            TL
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">TradeLayer</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                pathname === item.to ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ConnectWalletButton />
          {items.length > 0 && (
            <button
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground md:hidden"
              onClick={() => setOpen(v => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {open && items.length > 0 && (
        <nav className="border-t border-border/60 bg-background px-4 py-2 md:hidden">
          {items.map(item => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={cn(
                "block rounded-lg px-3 py-2.5 text-sm",
                pathname === item.to ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
