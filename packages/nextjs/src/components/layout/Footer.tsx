export function Footer() {
  return (
    <footer className="border-t border-border/60 py-6">
      <div className="container mx-auto flex flex-col items-center gap-1 px-4 text-center">
        <p className="text-xs text-muted-foreground">
          Hedera testnet · settlement in USDC · equities issued through Asset Tokenization Studio
        </p>
        <p className="text-xs text-muted-foreground/70">
          Orders are opened inside a hardware-attested enclave. Not even we can see the order flow.
        </p>
      </div>
    </footer>
  );
}
