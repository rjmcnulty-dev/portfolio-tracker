// Lets an admin create new logins directly from /admin's Users tab, instead
// of the Supabase Dashboard — and, critically, creates the matching
// `profiles` row in the same request, which the Dashboard flow doesn't do on
// its own (a user created there has no profiles row until someone adds one
// by hand, which is easy to forget). Same admin-gating pattern as
// manage-secret: `verify_jwt = true` (see config.toml) only proves the
// caller has *some* project-signed JWT — the anon key qualifies too — so
// this additionally confirms a real logged-in session via auth.getUser(),
// then checks profiles.is_admin before doing anything. auth.admin.* calls
// require the service-role key, which never reaches the browser.
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

  let body: { action?: string; email?: string; password?: string; isAdmin?: boolean; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "list") {
    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) return json({ error: listError.message }, 500);

    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("user_id, is_admin");
    if (profilesError) return json({ error: profilesError.message }, 500);
    const adminByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.is_admin]));

    const users = userList.users
      .map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        isAdmin: adminByUserId.get(u.id) ?? false,
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

    const { error: profileError } = await supabase.from("profiles").insert({ user_id: newUserId, is_admin: isAdmin });
    if (profileError) return json({ error: `User created, but profile setup failed: ${profileError.message}` }, 500);

    return json({ ok: true, user: { id: newUserId, email } });
  }

  return json({ error: "action must be 'list', 'invite', or 'create'" }, 400);
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request (requires a valid admin user JWT):

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/manage-users' \
    --header 'Authorization: Bearer <admin-user-access-token>' \
    --data '{"action":"list"}'

*/
