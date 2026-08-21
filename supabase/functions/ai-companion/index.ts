// Chat proxy for the AI Companion page. Unlike every other function in this
// app, each call here costs real money (Anthropic API, pay-per-token), so
// this is gated behind an actual login — same verify_jwt=true + explicit
// auth.getUser() pattern as manage-secret, not just the "some project-signed
// JWT" check verify_jwt alone provides (the anon key would also pass that).
import { createClient } from "@supabase/supabase-js";
import { getDecryptedSecret } from "../_shared/secrets.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
// Generous but bounded — a stuck client retry loop or pasted wall of text
// shouldn't be able to run up an unbounded bill on a single request.
const MAX_MESSAGE_CHARS = 8000;
const MAX_MESSAGES = 40;
// The context blob is app-generated JSON (see src/lib/portfolioContext.js),
// not raw user input, but still bounded — a runaway holdings list shouldn't
// be able to blow up the request either.
const MAX_CONTEXT_CHARS = 20000;

const SYSTEM_PROMPT =
  "You are the AI Companion inside a personal portfolio-tracking app. Be concise and direct. " +
  "If a portfolio snapshot is provided below, use it to answer questions about the user's " +
  "holdings, P&L, cash position, and recent trades (recentTrades, limited to the trailing " +
  "recentTradesWindowDays days — say so if asked about anything older than that window). " +
  "It's a point-in-time snapshot from when the chat page loaded, not live data, so say so if " +
  "asked about anything more current. If no snapshot is provided, say you don't have " +
  "portfolio data rather than guessing.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const masterKey = Deno.env.get("CONFIG_ENCRYPTION_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !masterKey) {
    return json({ error: "Supabase runtime env vars or CONFIG_ENCRYPTION_KEY are missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { messages?: ChatMessage[]; portfolioContext?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages is required and must be non-empty" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return json({ error: `Too many messages (max ${MAX_MESSAGES}) — start a new conversation.` }, 400);
  }
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") {
      return json({ error: "Each message's role must be 'user' or 'assistant'" }, 400);
    }
    if (typeof m.content !== "string" || !m.content.trim()) {
      return json({ error: "Each message must have non-empty string content" }, 400);
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return json({ error: `A message exceeds the ${MAX_MESSAGE_CHARS}-character limit` }, 400);
    }
  }

  let contextText: string | null = null;
  if (body.portfolioContext != null) {
    const serialized = JSON.stringify(body.portfolioContext);
    if (serialized.length > MAX_CONTEXT_CHARS) {
      return json({ error: `portfolioContext exceeds the ${MAX_CONTEXT_CHARS}-character limit` }, 400);
    }
    contextText = `Current portfolio snapshot (JSON):\n${serialized}`;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const apiKey = await getDecryptedSecret(supabase, "anthropic_api_key", masterKey);
  if (!apiKey) {
    return json({ error: "Anthropic API key is not configured — set it from /admin first." }, 400);
  }

  // Prompt caching: every request resends the whole growing conversation, so
  // caching pays off more each turn. Marking the LAST message's content
  // block as an ephemeral cache breakpoint caches everything up through it;
  // next turn's request repeats that same prefix verbatim (this message,
  // unchanged) before appending the new reply + next user message, so
  // Anthropic can serve that whole prefix from cache and only pay full price
  // for the newly-appended tokens. The system prompt and portfolio-context
  // blocks are marked too — this is exactly where caching matters most,
  // since the context blob is the same JSON string resent unchanged on
  // every turn of a session (see portfolioContext.js for why it's frozen
  // client-side rather than recomputed per message).
  const systemBlocks: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (contextText) {
    systemBlocks.push({ type: "text", text: contextText, cache_control: { type: "ephemeral" } });
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: messages.map((m, i) => ({
        role: m.role,
        content: [
          {
            type: "text",
            text: m.content,
            ...(i === messages.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
          },
        ],
      })),
    }),
  });

  const anthropicBody = await anthropicRes.json();
  if (!anthropicRes.ok) {
    const message = anthropicBody?.error?.message || `Anthropic API error (${anthropicRes.status})`;
    return json({ error: message }, 502);
  }

  const reply = anthropicBody.content?.find((block: { type: string }) => block.type === "text")?.text;
  if (!reply) {
    return json({ error: "Anthropic returned no text content" }, 502);
  }

  const usage = anthropicBody.usage ?? null;
  if (usage) {
    // Feeds the Token Usage modal's "All Time" total (see
    // src/hooks/useAiUsageTotal.js) — non-fatal on failure, since the
    // chat reply already succeeded and losing one row of spend tracking
    // isn't worth failing the user's message over.
    const { error: logError } = await supabase.from("ai_usage_log").insert({
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    });
    if (logError) console.error("ai_usage_log insert failed:", logError.message);
  }

  return json({ reply, usage });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request (requires a valid user JWT, unlike this app's other functions):

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-companion' \
    --header 'Authorization: Bearer <user-access-token>' \
    --data '{"messages":[{"role":"user","content":"Hello"}]}'

*/
