// api/brinquedos.js — Vercel Serverless Function
import { createClient } from "@supabase/supabase-js";

// Inicialização "lazy" (tardia) para evitar crash fatal no cold start da Vercel
let supabase = null;
const getSupabase = () => {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes na Vercel.",
    );
  }

  supabase = createClient(url, key);
  return supabase;
};

// Rate limiting simples em memória (por IP, reseta a cada deploy)
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
  // Habilita CORS (importante se o frontend e a API estiverem rodando de formas diferentes no dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  // Responde imediatamente a requisições de preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? "anonimo";
  if (!checaRateLimit(ip)) {
    return res
      .status(429)
      .json({ erro: "Muitas requisições. Aguarde um momento." });
  }

  try {
    const db = getSupabase(); // Instancia com segurança

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

    // 1. Define o seed aleatório da sessão
    // Checamos o erro para garantir que a RPC não derrube a execução se estiver ausente
    const { error: rpcError } = await db.rpc("set_seed_session", {
      seed_val: seedNum,
    });
    if (rpcError) {
      console.warn("Aviso (set_seed_session falhou):", rpcError.message);
    }

    // 2. Monta a query base
    let query = db
      .from("brinquedos")
      .select(
        "id, nome, fabricante, ano, categoria, tema, tags, curiosidade, raridade, codigo_trunfo, url_frente, url_verso, curtidas_count",
      )
      .range(cursorNum, cursorNum + limiteNum - 1);

    // NOTA: Removido o `.order("random()")` temporariamente.
    // O Supabase JS não suporta injeção de funções no .order().
    // Para ordenação aleatória real, precisaremos criar uma RPC no Supabase
    // ou ordenar pelo id de forma crescente por enquanto, só para validar a API.
    query = query.order("id", { ascending: true });

    // Filtros
    if (fabricante) query = query.eq("fabricante", fabricante);
    if (categoria) query = query.eq("categoria", categoria);
    if (decada)
      query = query.ilike("ano", `%${decada.replace(/[^0-9s]/g, "")}%`);
    if (busca) {
      const termo = busca.slice(0, 100);
      query = query.or(
        `nome.ilike.%${termo}%,tema.ilike.%${termo}%,tags.cs.{${termo}}`,
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    // Cache no CDN da Vercel
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );

    return res.status(200).json({
      itens: data ?? [],
      cursor: cursorNum + limiteNum,
      temMais: (data?.length ?? 0) === limiteNum,
    });
  } catch (err) {
    console.error("Erro Fatal na API:", err.message);
    // Retornamos os detalhes do erro para facilitar nossa vida no front
    return res.status(500).json({
      erro: "Erro interno. Verifique os logs.",
      detalhes: err.message,
    });
  }
}
