import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLANS: Record<string, { amount: number; name: string }> = {
  pro: { amount: 1500, name: "Chat Aethrix Pro" },
  premium: { amount: 3999, name: "Chat Aethrix Premium" },
};

const FALLBACK_REDIRECT_URL = "https://chataethrix.lovable.app/pricing";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FLUTTERWAVE_SECRET_KEY = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    if (!FLUTTERWAVE_SECRET_KEY) throw new Error("FLUTTERWAVE_SECRET_KEY is not configured");

    const authHeader = req.headers.get("authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { plan, redirect_url } = await req.json();
    if (!plan || !PLANS[plan]) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selectedPlan = PLANS[plan];
    const resolvedRedirectUrl = (() => {
      try {
        return redirect_url ? new URL(redirect_url).toString() : FALLBACK_REDIRECT_URL;
      } catch {
        return FALLBACK_REDIRECT_URL;
      }
    })();

    const txRef = `aethrix-${plan}-${user.id}-${Date.now()}`;

    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: selectedPlan.amount / 100,
        currency: "USD",
        redirect_url: resolvedRedirectUrl,
        customer: {
          email: user.email,
          name: user.user_metadata?.display_name || user.email,
        },
        customizations: {
          title: selectedPlan.name,
          description: `Monthly subscription to ${selectedPlan.name}`,
          logo: "https://chataethrix.lovable.app/placeholder.svg",
        },
        meta: {
          user_id: user.id,
          plan: plan,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      console.error("Flutterwave error:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "Failed to initialize payment", details: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ payment_link: data.data.link, tx_ref: txRef }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-payment error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
