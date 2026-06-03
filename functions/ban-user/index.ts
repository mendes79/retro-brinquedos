/**
 * ban-user — Supabase Edge Function  v3
 *
 * Requer: Verify JWT = ON nas configurações da função.
 * Com Verify JWT ON, o Supabase valida a assinatura do JWT antes de
 * executar este código — eliminamos a necessidade de auth.getUser().
 *
 * Fluxo:
 *   1. Supabase middleware valida assinatura do JWT (Verify JWT: ON)
 *   2. Nosso código extrai user_id do payload sem nova chamada HTTP
 *   3. Rejeita tokens sem `sub` (ex: anon key)
 *   4. Insere em lista_negra via service_role (bypass de RLS)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://retro-brinquedos.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Decodifica o payload de um JWT (base64url → JSON) sem verificar assinatura.
 *  Seguro porque o middleware do Supabase (Verify JWT: ON) já verificou. */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const base64Url = jwt.split(".")[1];
  if (!base64Url) throw new Error("JWT malformado");
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

Deno.serve(async (req: Request) => {
  console.log("[ban-user] Requisição recebida:", req.method);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    // ── 1. Extrair e decodificar o JWT ─────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    console.log("[ban-user] Authorization presente:", !!authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Token de autenticação ausente" }, 401);
    }

    const jwt = authHeader.replace("Bearer ", "").trim();

    let payload: Record<string, unknown>;
    try {
      payload = decodeJwtPayload(jwt);
    } catch {
      console.error("[ban-user] JWT malformado");
      return jsonResponse({ error: "Token malformado" }, 401);
    }

    console.log("[ban-user] JWT role:", payload.role, "| sub presente:", !!payload.sub);

    // ── 2. Garantir que é um usuário autenticado (não anon key) ────────────
    const userId = payload.sub as string | undefined;

    if (!userId || payload.role === "anon" || payload.role === "service_role") {
      console.error("[ban-user] Token sem sub ou role inválida:", payload.role);
      return jsonResponse({ error: "Token de usuário autenticado necessário" }, 401);
    }

    // ── 3. Extrair o motivo ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const motivo: string =
      typeof body?.motivo === "string" && body.motivo.length > 0
        ? body.motivo.slice(0, 200)
        : "Violação de termos de uso";

    // ── 4. Inserir na lista_negra com service_role ─────────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Idempotência: não duplicar banimentos
    const { data: existente } = await supabaseAdmin
      .from("lista_negra")
      .select("id")
      .eq("usuario_id", userId)
      .limit(1);

    if (existente && existente.length > 0) {
      console.log("[ban-user] Usuário já banido:", userId);
      return jsonResponse({ success: true, ja_banido: true });
    }

    const { error: banError } = await supabaseAdmin
      .from("lista_negra")
      .insert([{ usuario_id: userId, motivo }]);

    if (banError) {
      console.error("[ban-user] Erro no INSERT:", banError.message, banError.code);
      throw banError;
    }

    console.log("[ban-user] ✅ Banimento registrado para userId:", userId);
    return jsonResponse({ success: true });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ban-user] Erro interno:", message);
    return jsonResponse({ error: "Erro interno ao processar banimento" }, 500);
  }
});
