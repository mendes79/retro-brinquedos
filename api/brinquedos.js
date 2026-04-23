// api/brinquedos.js — Vercel Serverless Function
import { createClient } from "@supabase/supabase-js";

// Usa a service_role key no backend (nunca exposta ao navegador)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Rate limiting simples em memória (por IP, reseta a cada deploy)
const requisicoes = new Map();
const LIMITE_POR_MINUTO = 60;

function checaRateLimit(ip) {
  const agora = Date.now();
  const entrada = requisicoes.get(ip) ?? { count: 0, desde: agora };

  // Reseta janela após 1 minuto
  if (agora - entrada.desde > 60_000) {
    entrada.count = 0;
    entrada.desde = agora;
  }

  entrada.count++;
  requisicoes.set(ip, entrada);
  return entrada.count <= LIMITE_POR_MINUTO;
}

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  // Rate limiting por IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? "anonimo";
  if (!checaRateLimit(ip)) {
    return res
      .status(429)
      .json({ erro: "Muitas requisições. Aguarde um momento." });
  }

  // Extrai e valida parâmetros
  const {
    seed = "0.5",
    cursor = "0",
    limite = "30",
    fabricante,
    categoria,
    decada,
    busca,
  } = req.query;

  // Normaliza seed para float entre 0 e 1 (requisito do PostgreSQL setseed)
  const seedNum = Math.min(1, Math.max(0, parseFloat(seed) || 0.5));

  // Cursor e limite como inteiros seguros
  const cursorNum = Math.max(0, parseInt(cursor) || 0);
  const limiteNum = Math.min(50, Math.max(1, parseInt(limite) || 30));

  try {
    // Define o seed aleatório da sessão no PostgreSQL
    await supabase.rpc("set_seed_session", { seed_val: seedNum });

    // Monta a query base com campos públicos
    let query = supabase
      .from("brinquedos")
      .select(
        "id, nome, fabricante, ano, categoria, tema, tags, curiosidade, " +
          "raridade, codigo_trunfo, url_frente, url_verso, curtidas_count",
      )
      .order("random()") // usa o seed definido acima
      .range(cursorNum, cursorNum + limiteNum - 1);

    // Filtros opcionais (todos sanitizados pelo Supabase client)
    if (fabricante) query = query.eq("fabricante", fabricante);
    if (categoria) query = query.eq("categoria", categoria);
    if (decada)
      query = query.ilike("ano", `%${decada.replace(/[^0-9s]/g, "")}%`);
    if (busca) {
      // Busca em nome, tema e tags (limitada a 100 chars para evitar abuso)
      const termo = busca.slice(0, 100);
      query = query.or(
        `nome.ilike.%${termo}%,tema.ilike.%${termo}%,tags.cs.{${termo}}`,
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    // Headers de cache: 10s no CDN, revalidação em background
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).json({
      itens: data ?? [],
      cursor: cursorNum + limiteNum,
      temMais: (data?.length ?? 0) === limiteNum,
    });
  } catch (err) {
    console.error("Erro na API:", err.message);
    return res.status(500).json({ erro: "Erro interno. Tente novamente." });
  }
}
