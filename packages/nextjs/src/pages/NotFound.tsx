import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="min-h-screen pt-24 pb-16 flex items-center justify-center">
      <div className="text-center px-4">
        <div className="glass-card p-8 max-w-md w-full">
          <h1 className="text-6xl font-heading font-bold gradient-text mb-4">404</h1>
          <p className="text-xl text-muted-foreground mb-6">
            Oops! This page doesn't exist.
          </p>
          <Button asChild className="rounded-xl bg-primary hover:bg-primary/90">
            <Link to="/" className="gap-2">
              <Home className="h-4 w-4" />
              Return to Home
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
