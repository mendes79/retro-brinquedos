// api/brinquedos.js — Vercel Serverless Function
import { createClient } from "@supabase/supabase-js";

let supabase = null;
const getSupabase = () => {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Variáveis ausentes na Vercel.");
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
  if (req.method !== "GET")
    return res.status(405).json({ erro: "Método não permitido" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? "anonimo";
  if (!checaRateLimit(ip))
    return res.status(429).json({ erro: "Muitas requisições. Aguarde." });

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

    // Busca o total antecipadamente para calcular o cursor local
    let totalItens = 0;
    try {
      const { count } = await db
        .from("brinquedos")
        .select("id", { count: "exact", head: true });
      totalItens = count || 0;
    } catch (errCount) {
      console.warn("Aviso (Contagem):", errCount.message);
    }

    // Mapeia cursor global → cursor local (cicla quando passa do total)
    // A cada volta completa, deriva um novo seed do original para variar a ordem
    let cursorLocal = cursorNum;
    let seedEfetivo = seedNum;
    if (totalItens > 0 && cursorNum > 0) {
      const volta = Math.floor(cursorNum / totalItens);
      cursorLocal = cursorNum % totalItens;
      // Deriva seed diferente a cada volta usando o seed original como base
      if (volta > 0) {
        seedEfetivo = ((seedNum * 9301 + volta * 49297) % 233280) / 233280;
      }
    }

    // Busca os itens via RPC usando cursor e seed mapeados
    const { data, error } = await db.rpc("buscar_brinquedos", {
      seed_val: seedEfetivo,
      cursor_val: cursorLocal,
      limite_val: limiteNum,
      fabricante_val: fabricante ?? null,
      categoria_val: categoria ?? null,
      decada_val: decada ? decada.replace(/[^0-9s]/g, "") : null,
      busca_val: busca ? busca.slice(0, 100) : null,
    });

    if (error) throw error;

    const LIMITE_GLOBAL = 9999; // capacidade declarada do masonry — "Game Over" ao chegar aqui
    const itens = data ?? [];

    // cursorGlobal avança de 0 até 9999 independente do tamanho real do catálogo
    const cursorGlobal = cursorNum + itens.length;
    const zerou = cursorGlobal >= LIMITE_GLOBAL;

    console.log(`[API] cursorLocal=${cursorNum} cursorGlobal=${cursorGlobal}/${LIMITE_GLOBAL} total=${totalItens} rodada=${totalItens > 0 ? Math.floor(cursorNum / totalItens) + 1 : 1}`);

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );

    return res.status(200).json({
      itens,
      cursor: zerou ? LIMITE_GLOBAL : cursorGlobal,
      temMais: !zerou,
      total: totalItens,
      cursorGlobal,          // frontend usa para monitorar progresso no console
      limiteGlobal: LIMITE_GLOBAL,
    });
  } catch (err) {
    console.error("Erro Fatal na API:", err.message);
    return res
      .status(500)
      .json({ erro: "Erro interno.", detalhes: err.message });
  }
}
