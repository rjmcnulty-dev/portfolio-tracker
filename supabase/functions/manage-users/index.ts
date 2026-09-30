// Lets an admin create new logins and manage per-user permissions directly
// from /admin's Users tab, instead of the Supabase Dashboard — and,
// critically, creates the matching `profiles` row in the same request,
// which the Dashboard flow doesn't do on its own (a user created there has
// no profiles row until someone adds one by hand, which is easy to forget).
// Same admin-gating pattern as manage-secret: `verify_jwt = true` (see
// config.toml) only proves the caller has *some* project-signed JWT — the
// anon key qualifies too — so this additionally confirms a real logged-in
// session via auth.getUser(), then checks profiles.is_admin before doing
// anything. auth.admin.* calls require the service-role key, which never
// reaches the browser. can_use_ai_companion defaults to false for new
// accounts (see the AI Companion permission migration) since that feature
// costs real Anthropic API money per use — the actual enforcement of that
// flag lives server-side in the ai-companion function itself, not here;
// this is just where an admin flips it.
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Supabase runtime env vars are missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // profiles' RLS allows self-select, so the caller's own client can answer
  // this without needing the service-role client at all.
  const { data: callerProfile } = await callerClient
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!callerProfile?.is_admin) {
    return json({ error: "Forbidden — admin only" }, 403);
  }

  let body: {
    action?: string;
    email?: string;
    password?: string;
    isAdmin?: boolean;
    canUseAiCompanion?: boolean;
    redirectTo?: string;
    userId?: string;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "list") {
    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) return json({ error: listError.message }, 500);

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, is_admin, can_use_ai_companion");
    if (profilesError) return json({ error: profilesError.message }, 500);
    const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const users = userList.users
      .map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        isAdmin: profileByUserId.get(u.id)?.is_admin ?? false,
        canUseAiCompanion: profileByUserId.get(u.id)?.can_use_ai_companion ?? false,
        // banned_until is either absent/null (never banned) or a timestamp —
        // Supabase uses a ~100-year-out sentinel for an "indefinite" ban
        // rather than a literal null, so any future timestamp means banned.
        active: !u.banned_until || new Date(u.banned_until) <= new Date(),
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    return json({ users });
  }

  if (body.action === "invite" || body.action === "create") {
    const email = body.email?.trim().toLowerCase();
    if (!email) return json({ error: "email is required" }, 400);
    const isAdmin = Boolean(body.isAdmin);

    let newUserId: string;
    if (body.action === "invite") {
      // Without an explicit redirectTo, Supabase falls back to the project's
      // default Site URL — a leftover `localhost:3000` from initial project
      // setup nobody ever changed, since nothing needed it until now (the
      // existing password-reset flow already passes its own explicit
      // redirectTo for the same reason — see LoginPage.jsx). The client
      // sends its own origin/pathname, same bare-URL-no-hash reasoning as
      // that flow: Supabase appends the invite token as its own URL hash,
      // which would collide with a HashRouter route already living there.
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: body.redirectTo,
      });
      if (error) return json({ error: error.message }, 400);
      newUserId = data.user.id;
    } else {
      const password = body.password ?? "";
      if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      newUserId = data.user.id;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .insert({ user_id: newUserId, is_admin: isAdmin, can_use_ai_companion: Boolean(body.canUseAiCompanion) });
    if (profileError) return json({ error: `User created, but profile setup failed: ${profileError.message}` }, 500);

    return json({ ok: true, user: { id: newUserId, email } });
  }

  if (body.action === "sendPasswordReset") {
    const email = body.email?.trim().toLowerCase();
    if (!email) return json({ error: "email is required" }, 400);

    // Used both for "Resend Invite" (a not-yet-confirmed user) and the
    // Admin Users "Reset Password" action's email method (an already-active
    // user) — the same call works for either case regardless of
    // confirmation status, and inviteUserByEmail specifically only works for
    // a brand-new address (calling it again for an existing-but-unconfirmed
    // user errors unreliably, documented Supabase/GoTrue behavior, not
    // something worth working around). A recovery-style link lands on
    // exactly the same "set your password" screen either way
    // (usePasswordRecovery treats any PASSWORD_RECOVERY event identically
    // regardless of which flow produced it) — this is a public endpoint, so
    // the caller's own client (already proven to be a real logged-in admin
    // above) is enough; no service-role needed here.
    const { error } = await callerClient.auth.resetPasswordForEmail(email, { redirectTo: body.redirectTo });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === "setPassword") {
    const targetUserId = body.userId;
    if (!targetUserId) return json({ error: "userId is required" }, 400);
    const password = body.password ?? "";
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

    // The Admin Users "Reset Password" action's direct method — sets the
    // password immediately with no email round-trip, for when the user
    // can't get to their inbox right now. The admin sees the plaintext
    // password they just typed (unlike the email method), so this is
    // deliberately opt-in rather than the default.
    const { error } = await supabase.auth.admin.updateUserById(targetUserId, { password });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "setActive") {
    const targetUserId = body.userId;
    if (!targetUserId) return json({ error: "userId is required" }, 400);
    // Server-side backstop for the same rule the client UI enforces (you
    // can't deactivate the account you're currently using) — a disabled
    // button is only a suggestion, this is the actual boundary.
    if (targetUserId === userData.user.id && !body.active) {
      return json({ error: "You can't deactivate the account you're currently signed in as." }, 400);
    }

    // "876000h" (100 years) reads as permanent without needing Supabase's
    // literal max — ban_duration: "none" is the documented way to unban.
    const { error } = await supabase.auth.admin.updateUserById(targetUserId, {
      ban_duration: body.active ? "none" : "876000h",
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "setAiCompanionAccess") {
    const targetUserId = body.userId;
    if (!targetUserId) return json({ error: "userId is required" }, 400);

    const { error } = await supabase
      .from("profiles")
      .update({ can_use_ai_companion: Boolean(body.canUseAiCompanion) })
      .eq("user_id", targetUserId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "delete") {
    const targetUserId = body.userId;
    if (!targetUserId) return json({ error: "userId is required" }, 400);
    if (targetUserId === userData.user.id) {
      return json({ error: "You can't delete the account you're currently signed in as." }, 400);
    }

    const { error } = await supabase.auth.admin.deleteUser(targetUserId);
    if (error) {
      // auth.users has no cascading FK from trades/accounts/etc. on purpose
      // (see the multi-user migration) — deleting a user who still has real
      // financial data attached fails at the DB level rather than silently
      // orphaning or wiping it. Supabase's own error here is just "Database
      // error deleting user" regardless of the actual reason (confirmed by
      // testing this exact scenario directly), too generic to show as-is, so
      // always point at the most likely real cause rather than parsing text
      // Supabase doesn't actually return.
      return json(
        {
          error:
            "Couldn't delete this user — they likely still have data attached (accounts, trades, deposits, etc.). Remove it first, or deactivate the account instead.",
        },
        400,
      );
    }
    return json({ ok: true });
  }

  return json(
    {
      error:
        "action must be 'list', 'invite', 'create', 'sendPasswordReset', 'setPassword', 'setActive', 'setAiCompanionAccess', or 'delete'",
    },
    400,
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request (requires a valid admin user JWT):

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/manage-users' \
    --header 'Authorization: Bearer <admin-user-access-token>' \
    --data '{"action":"list"}'

*/
