// api/brinquedos.js — Vercel Serverless Function
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";

let supabase = null;
const getSupabase = () => {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Variáveis ausentes na Vercel.");
  supabase = createClient(url, key);
  return supabase;
};

// V-10: Instancia o cliente do Redis (Upstash) usando as variáveis da Vercel
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const LIMITE_POR_MINUTO = 60;

// V-10: Rate Limit Persistente, Distribuído e Implacável
async function checaRateLimit(ip) {
  const chave = `ratelimit:${ip}`;

  try {
    // Incrementa o contador para este IP de forma atômica
    const count = await redis.incr(chave);

    // Se for o primeiro request dessa janela, define a expiração para 60 segundos
    if (count === 1) {
      await redis.expire(chave, 60);
    }

    return count <= LIMITE_POR_MINUTO;
  } catch (error) {
    // Fallback: se o Redis cair, liberamos o acesso para não derrubar o site,
    // mas logamos o erro para auditoria.
    console.error("Erro no Upstash Redis:", error);
    return true;
  }
}

export default async function handler(req, res) {
  // V-16: CORS Restrito! Agora só o seu site real consegue chamar essa API
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://retro-brinquedos.vercel.app",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Método não permitido" });

  // Pega o IP real do usuário pela malha de rede da Vercel
  const ip =
    req.headers["x-real-ip"] ||
    req.headers["x-forwarded-for"] ||
    "ip_desconhecido";

  // V-10: Verifica o IP no Redis
  const allowed = await checaRateLimit(ip);
  if (!allowed) {
    res.setHeader("Retry-After", 60);
    return res
      .status(429)
      .json({ error: "Muitas requisições. Tente novamente em um minuto." });
  }

  const db = getSupabase();
  try {
    const {
      seed = 0.5,
      cursor = 0,
      limite = 30,
      fabricante,
      categoria,
      decada,
      busca,
    } = req.query;

    const seedNum = Math.min(1, Math.max(0, parseFloat(seed) || 0.5));
    const cursorNum = Math.max(0, parseInt(cursor) || 0);
    const limiteNum = Math.min(50, Math.max(1, parseInt(limite) || 30));

    // Busca os itens via RPC
    const { data, error } = await db.rpc("buscar_brinquedos", {
      seed_val: seedNum,
      cursor_val: cursorNum,
      limite_val: limiteNum,
      fabricante_val: fabricante ?? null,
      categoria_val: categoria ?? null,
      decada_val: decada ? decada.replace(/[^0-9s]/g, "") : null,
      busca_val: busca ? busca.slice(0, 100) : null,
    });

    if (error) throw error;

    // Busca o Total de forma blindada (não derruba a API se falhar)
    let totalItens = 0;
    try {
      const { count } = await db
        .from("brinquedos")
        .select("id", { count: "exact", head: true });
      totalItens = count || 0;
    } catch (errCount) {
      console.warn("Aviso (Contagem):", errCount.message);
    }

    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");

    return res.status(200).json({
      itens: data || [],
      cursor: cursorNum + (data ? data.length : 0),
      temMais: data && data.length === limiteNum,
      total: totalItens,
    });
  } catch (err) {
    console.error("Erro interno API:", err.message);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
