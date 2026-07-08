import { createFileRoute, useRouter, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanLine, Loader2, Mail, CheckCircle } from "lucide-react";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — BagScan" },
      { name: "description", content: "Sign in to BagScan to save and review your baggage scans." },
    ],
  }),
  validateSearch: searchSchema,
  component: AuthPage,
});

function safeNext(next?: string) {
  if (!next) return "/scan";
  if (!next.startsWith("/") || next.startsWith("//")) return "/scan";
  return next;
}

function AuthPage() {
  const router = useRouter();
  const { next } = useSearch({ from: "/auth" });
  const dest = safeNext(next);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Check if already signed in
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.navigate({ to: dest });
    });
  }, [router, dest]);

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'magiclink',
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          email: email,
        }
      });

      if (error) {
        // Try with OTP instead
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          }
        });

        if (otpError) throw otpError;
      }

      setMagicLinkSent(true);
      toast.success("Magic link sent! Check your email.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
        <div className="pointer-events-none absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-primary-glow/30 blur-3xl" />

        <div className="relative w-full max-w-md rounded-3xl border bg-card p-8 shadow-elevated text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckCircle className="h-8 w-8" />
          </div>

          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="mt-2 text-muted-foreground">
            We sent a magic link to <strong>{email}</strong>
          </p>

          <div className="mt-6 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="font-medium">What happens next:</p>
            <ol className="mt-2 space-y-1 text-left">
              <li>1. Open your email inbox</li>
              <li>2. Find the email from BagScan</li>
              <li>3. Click the magic link inside</li>
              <li>4. You'll be signed in automatically</li>
            </ol>
          </div>

          <Button
            onClick={() => setMagicLinkSent(false)}
            variant="outline"
            className="mt-6 w-full"
          >
            Use different email
          </Button>

          <Link to="/" className="mt-4 block text-sm text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero opacity-90" />
      <div className="pointer-events-none absolute -right-40 -top-40 h-[500px] w-[500px] rounded-full bg-primary-glow/30 blur-3xl" />

      <div className="relative w-full max-w-md rounded-3xl border bg-card p-8 shadow-elevated">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand text-primary-foreground">
            <ScanLine className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-extrabold">BagScan</span>
        </Link>

        <h1 className="text-2xl font-bold">Sign in to BagScan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your baggage scans and access them from any device
        </p>

        <form onSubmit={sendMagicLink} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-95"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending magic link...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Send magic link
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            We'll email you a magic link for instant sign in
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            No password needed. Just click the link in your email.
          </p>
        </div>

        <Link to="/" className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
