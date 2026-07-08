import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const searchSchema = {
  next: (value: any) => (typeof value === "string" ? value : "/scan"),
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
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session) {
          toast.success("Successfully signed in!");
          router.navigate({ to: next || "/scan" });
        } else {
          // Check URL for error
          const urlParams = new URLSearchParams(window.location.search);
          const error = urlParams.get("error");
          const errorDescription = urlParams.get("error_description");

          if (error) {
            toast.error(errorDescription || "Authentication failed");
            router.navigate({ to: "/auth" });
          } else {
            // Session might still be processing, wait a bit
            await new Promise(resolve => setTimeout(resolve, 1000));
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData.session) {
              toast.success("Successfully signed in!");
              router.navigate({ to: next || "/scan" });
            } else {
              toast.error("Could not complete sign in");
              router.navigate({ to: "/auth" });
            }
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sign in failed");
        router.navigate({ to: "/auth" });
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
