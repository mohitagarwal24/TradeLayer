import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  return (
    <main className="container mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
      <div className="w-full rounded-xl border border-border/60 bg-card p-8 text-center">
        <h1 className="font-heading text-5xl font-bold">404</h1>
        <p className="mb-6 mt-2 text-muted-foreground">There's nothing at this address.</p>
        <Button asChild>
          <Link to="/" className="gap-2">
            <Home className="h-4 w-4" />
            Back to the start
          </Link>
        </Button>
      </div>
    </main>
  );
};

export default NotFound;
