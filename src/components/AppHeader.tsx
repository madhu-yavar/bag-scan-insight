import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, ScanLine } from "lucide-react";
import { hasSupabaseConfig, supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { User } from "@supabase/supabase-js";

export function AppHeader() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const supabaseConfigured = hasSupabaseConfig();

  useEffect(() => {
    if (!supabaseConfigured) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabaseConfigured]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-brand text-primary-foreground shadow-brand">
            <ScanLine className="h-5 w-5" />
          </div>
          <span className="truncate font-display text-lg font-extrabold tracking-tight">
            BagScan
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <Link
            to="/scan-local"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            New scan
          </Link>
          <Link
            to="/reports-local"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Saved reports
          </Link>
          <Link
            to="/dashboard"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Dashboard
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <>
              <span className="hidden max-w-[160px] truncate text-sm text-muted-foreground sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                to="/scan-local"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                New scan
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
