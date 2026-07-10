import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  applyAuthRedirectParams,
  clearAuthRedirectParams,
  readAuthRedirectParams,
  safeNext,
} from "@/lib/auth-helpers";
import { Loader2 } from "lucide-react";

const searchSchema = {
  next: (value: any) => (typeof value === "string" ? value : "/scan-local"),
};

export const Route = createFileRoute("/auth/callback")({
  validateSearch: searchSchema,
  component: AuthCallback,
});

function AuthCallback() {
  const router = useRouter();
  const { next } = useSearch({ from: "/auth/callback" });

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = readAuthRedirectParams();
        const authError = params.get("error");
        if (authError) {
          const description =
            params.get("error_description") || "Authentication failed. Request a new sign-in link.";
          clearAuthRedirectParams();
          toast.error(description);
          router.navigate({ to: "/auth", search: { next: safeNext(next) } });
          return;
        }

        await applyAuthRedirectParams(params);
        clearAuthRedirectParams();
        const destination = params.get("type") === "recovery" ? "/reset-password" : safeNext(next);

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session) {
          toast.success("Successfully signed in!");
          router.navigate({ to: destination });
        } else {
          // Session might still be processing, wait a bit
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session) {
            toast.success("Successfully signed in!");
            router.navigate({ to: destination });
          } else {
            toast.error("Could not complete sign in. Request a new sign-in link.");
            router.navigate({ to: "/auth", search: { next: safeNext(next) } });
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sign in failed");
        router.navigate({ to: "/auth", search: { next: safeNext(next) } });
      }
    };

    handleCallback();
  }, [router, next]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
