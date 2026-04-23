import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const PLANS = {
  pro: { amount: 15 },
  premium: { amount: 39.99 },
} as const;

type Plan = keyof typeof PLANS;

const parsePlanFromTxRef = (txRef: string): Plan | null => {
  const plan = txRef.split("-")[1];
  return plan === "pro" || plan === "premium" ? plan : null;
};

const verifyByTransactionId = async (transactionId: string, secretKey: string) => {
  return fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
};

const verifyByReference = async (txRef: string, secretKey: string) => {
  const url = new URL("https://api.flutterwave.com/v3/transactions/verify_by_reference");
  url.searchParams.set("tx_ref", txRef);

  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
};

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
        headers: jsonHeaders,
      });
    }

    const { transaction_id, tx_ref } = await req.json();
    if (!transaction_id && !tx_ref) {
      return new Response(JSON.stringify({ error: "Missing transaction_id or tx_ref" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const response = transaction_id
      ? await verifyByTransactionId(String(transaction_id), FLUTTERWAVE_SECRET_KEY)
      : await verifyByReference(String(tx_ref), FLUTTERWAVE_SECRET_KEY);

    const data = await response.json();
    if (!response.ok || data.status !== "success" || data.data?.status !== "successful") {
      return new Response(JSON.stringify({ error: "Payment not verified", details: data }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const verifiedTxRef = String(data.data.tx_ref ?? tx_ref ?? "");
    const plan = parsePlanFromTxRef(verifiedTxRef);

    if (!plan) {
      return new Response(JSON.stringify({ error: "Invalid plan in transaction" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const paymentOwnerId = data.data.meta?.user_id;
    if (paymentOwnerId !== user.id && !verifiedTxRef.includes(`-${user.id}-`)) {
      return new Response(JSON.stringify({ error: "Payment does not belong to this user" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const expectedAmount = PLANS[plan].amount;
    const paidAmount = Number(data.data.amount);

    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
      return new Response(JSON.stringify({ error: "Payment amount mismatch" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ subscription_tier: plan })
      .eq("user_id", user.id);

    if (updateError) {
      throw updateError;
    }

    return new Response(JSON.stringify({ success: true, plan }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (e) {
    console.error("verify-payment error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
