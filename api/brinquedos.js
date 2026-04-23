// api/brinquedos.js — Vercel Serverless Function
import { createClient } from "@supabase/supabase-js";

let supabase = null;
const getSupabase = () => {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Variáveis SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes.");
  }
  supabase = createClient(url, key);
  return supabase;
};

const requisicoes = new Map();
const LIMITE_POR_MINUTO = 60;

function checaRateLimit(ip) {
  const agora = Date.now();
  const entrada = requisicoes.get(ip) ?? { count: 0, desde: agora };
  if (agora - entrada.desde > 60_000) {
    entrada.count = 0;
    entrada.desde = agora;
  }
  entrada.count++;
  requisicoes.set(ip, entrada);
  return entrada.count <= LIMITE_POR_MINUTO;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? "anonimo";
  if (!checaRateLimit(ip)) {
    return res.status(429).json({ erro: "Muitas requisições. Aguarde." });
  }

  try {
    const db = getSupabase();

    const {
      seed = "0.5",
      cursor = "0",
      limite = "30",
      fabricante,
      categoria,
      decada,
      busca,
    } = req.query;

    const seedNum = Math.min(1, Math.max(0, parseFloat(seed) || 0.5));
    const cursorNum = Math.max(0, parseInt(cursor) || 0);
    const limiteNum = Math.min(50, Math.max(1, parseInt(limite) || 30));

    // 1. Busca os itens da página atual via RPC
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

    // 2. Busca o Total Real de itens no banco (super leve, apenas contagem)
    // Se houver filtros no futuro (Passo 3), aplicaremos a mesma lógica aqui.
    const { count } = await db
      .from("brinquedos")
      .select("*", { count: "exact", head: true });

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );

    return res.status(200).json({
      itens: data ?? [],
      cursor: cursorNum + limiteNum,
      temMais: (data?.length ?? 0) === limiteNum,
      total: count || 0, // Retorna o total para o Frontend
    });
  } catch (err) {
    console.error("Erro Fatal na API:", err.message);
    return res.status(500).json({
      erro: "Erro interno. Verifique os logs.",
      detalhes: err.message,
    });
  }
}
