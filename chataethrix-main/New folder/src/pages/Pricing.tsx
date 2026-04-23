import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPricingCleanupUrl, buildPricingRedirectUrl, PAYMENT_REQUEST_TIMEOUT_MS } from "@/lib/payment";
import { toast } from "sonner";

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/forever",
    features: [
      "10 chats per day",
      "Basic topics",
      "Standard response speed",
    ],
    cta: "Current Plan",
    highlighted: false,
    plan: null,
  },
  {
    name: "Pro",
    price: "$15",
    period: "/month",
    features: [
      "100 daily chats",
      "Faster responses",
      "Deep analysis mode",
      "Full conversation memory",
    ],
    cta: "Upgrade to Pro",
    highlighted: true,
    plan: "pro",
  },
  {
    name: "Premium",
    price: "$39.99",
    period: "/month",
    features: [
      "Unlimited chats",
      "Fastest AI responses",
      "Priority access to new features",
      "Priority support",
    ],
    cta: "Upgrade to Premium",
    highlighted: false,
    plan: "premium",
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [currentTier, setCurrentTier] = useState("free");
  const verificationAttemptRef = useRef<string | null>(null);

  const clearPaymentRedirectState = () => {
    window.history.replaceState({}, document.title, buildPricingCleanupUrl());
  };

  // Load current tier
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("subscription_tier")
        .eq("user_id", user.id)
        .single();
      if (data) setCurrentTier(data.subscription_tier || "free");
    })();
  }, [user]);

  // Handle payment callback
  useEffect(() => {
    const status = searchParams.get("status");
    const transactionId = searchParams.get("transaction_id");
    const txRef = searchParams.get("tx_ref");

    if (status === "successful" && user && (transactionId || txRef)) {
      const verificationKey = `${user.id}:${transactionId ?? ""}:${txRef ?? ""}`;

      if (verificationAttemptRef.current === verificationKey) return;

      verificationAttemptRef.current = verificationKey;
      verifyPayment({ transactionId, txRef });
    } else if (status === "cancelled" || status === "failed") {
      toast.error("Payment was cancelled.");
      clearPaymentRedirectState();
    }
  }, [searchParams, user]);

  const verifyPayment = async ({
    transactionId,
    txRef,
  }: {
    transactionId?: string | null;
    txRef?: string | null;
  }) => {
    setLoadingPlan("verifying");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);

    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token || "";
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;

      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transaction_id: transactionId, tx_ref: txRef }),
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentTier(data.plan);
        toast.success(`Successfully upgraded to ${data.plan.charAt(0).toUpperCase() + data.plan.slice(1)}!`);
        clearPaymentRedirectState();
      } else {
        toast.error(data.error || "Payment verification failed.");
      }
    } catch (error) {
      toast.error(
        error instanceof DOMException && error.name === "AbortError"
          ? "Payment verification timed out. Please refresh and try again."
          : "Failed to verify payment."
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLoadingPlan(null);
    }
  };

  const handleUpgrade = async (plan: string) => {
    if (!user) {
      navigate("/login");
      return;
    }

    setLoadingPlan(plan);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);

    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token || "";
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;

      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/create-payment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan,
          redirect_url: buildPricingRedirectUrl(),
        }),
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.payment_link) {
        window.location.href = data.payment_link;
      } else {
        toast.error(data.error || "Failed to start payment.");
        setLoadingPlan(null);
      }
    } catch (error) {
      toast.error(
        error instanceof DOMException && error.name === "AbortError"
          ? "Payment initialization timed out. Please try again."
          : "Something went wrong. Please try again."
      );
      setLoadingPlan(null);
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-grid">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary text-glow-green" />
          <span className="font-mono font-bold text-lg text-primary text-glow-green">CHAT AETHRIX</span>
        </div>
        <Link to={user ? "/chat" : "/"}>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-center mb-4">
          <span className="text-primary text-glow-green">Choose</span> Your Access Level
        </h1>
        <p className="text-center text-muted-foreground mb-12">
          Unlock deeper mysteries with premium access.
        </p>

        {loadingPlan === "verifying" && (
          <div className="flex items-center justify-center gap-2 mb-8 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="font-mono text-sm">Verifying your payment...</span>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((t, i) => {
            const isCurrentPlan = currentTier === (t.plan || "free");
            const isDowngrade = (t.plan === null && currentTier !== "free") ||
              (t.plan === "pro" && currentTier === "premium");

            return (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className={`p-6 rounded-lg border ${
                  t.highlighted
                    ? "border-primary/50 bg-primary/5 glow-green"
                    : "border-border/50 bg-card/50"
                } flex flex-col`}
              >
                <h3 className="font-mono text-lg font-bold text-foreground mb-2">{t.name}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-primary">{t.price}</span>
                  <span className="text-muted-foreground text-sm">{t.period}</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-primary flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full font-mono ${t.highlighted ? "glow-green" : ""}`}
                  variant={t.highlighted ? "default" : "outline"}
                  disabled={isCurrentPlan || !t.plan || loadingPlan !== null || isDowngrade}
                  onClick={() => t.plan && handleUpgrade(t.plan)}
                >
                  {loadingPlan === t.plan ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                  ) : isCurrentPlan ? (
                    "Current Plan"
                  ) : (
                    t.cta
                  )}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
