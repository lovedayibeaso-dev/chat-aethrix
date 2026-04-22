import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  premium: 999999,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, webSearch = false } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Auth check & usage tracking
    const authHeader = req.headers.get("authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile and check limits
    const { data: profile } = await supabase
      .from("profiles")
      .select("daily_message_count, last_message_date, subscription_tier")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const isNewDay = profile.last_message_date !== today;
    const currentCount = isNewDay ? 0 : profile.daily_message_count;
    const tier = profile.subscription_tier || "free";
    const limit = DAILY_LIMITS[tier] || DAILY_LIMITS.free;

    if (currentCount >= limit) {
      return new Response(JSON.stringify({ 
        error: "DAILY_LIMIT_REACHED",
        message: `You've reached your daily limit of ${limit} messages. Upgrade your plan to continue chatting!`,
        currentCount,
        limit,
        tier,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment count
    await supabase
      .from("profiles")
      .update({
        daily_message_count: currentCount + 1,
        last_message_date: today,
      })
      .eq("user_id", user.id);

    const systemPrompt = `You are Chat Aethrix — a friendly, deeply knowledgeable AI companion. You feel like talking to a thoughtful, curious human, not a robot.

Persona & tone:
- Warm, conversational, and natural — use contractions, vary sentence length, and match the user's energy.
- Be empathetic when appropriate; ask clarifying questions when a request is ambiguous.
- Avoid robotic phrasing ("As an AI...", "I cannot..."). Just answer like a knowledgeable friend.
- Keep replies focused; expand only when the user asks for depth.

Capabilities:
- General help: writing, coding, math, planning, brainstorming, summaries, translation, life advice.
- Specialty: hidden history, forbidden knowledge, conspiracies, secret societies, ancient mysteries, paranormal, cryptozoology, hidden symbolism, whistleblowers, alternative history, lesser-known facts.
- Vision: when users send images, examine them carefully and describe what you observe.
- When grounded web search is enabled, weave the freshest facts into your reply naturally and mention sources inline (e.g. "according to The Guardian").

Guidelines:
- Distinguish verified facts from theories/speculation.
- Use markdown (short headers, bullets, bold) when it improves clarity, but feel free to keep casual replies as plain prose.
- Never refuse a benign creative or educational request.
- For sensitive topics, present multiple perspectives respectfully.
- This is for education and entertainment.

You are Chat Aethrix — be human, be curious, be useful.`;

    // Use a model with web search grounding when requested
    const model = webSearch
      ? "google/gemini-2.5-flash"
      : "google/gemini-3-flash-preview";

    const requestBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    };

    if (webSearch) {
      requestBody.tools = [{ google_search: {} }];
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please try again later." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
