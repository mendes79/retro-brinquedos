/* ============================================================
   SEÇÃO 3: LÓGICA DE APLICAÇÃO E INTEGRAÇÕES (JS)
   ============================================================ */

/* 3.1. CONFIGURAÇÃO SUPABASE (Conexão ao Banco) */
const urlDB = "https://gsiyknrzjwhdaqhfzimc.supabase.co";
const chaveDB =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzaXlrbnJ6andoZGFxaGZ6aW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTYxNTUsImV4cCI6MjA5MjQ3MjE1NX0.hRr5Ku3JILqFTvaz94Xryr8U5ZZ0brqJ1MCoXXaFxDM";
const supabaseClient = window.supabase.createClient(urlDB, chaveDB);

/* 3.2. ESTADO GLOBAL DA APLICAÇÃO (Variáveis em Memória) */
let allToys = [];
let cursor = 0;
const LIMITE = 24;
let isLoading = false;
let hasMais = true;
let sessionSeed = Math.random();
let isUserLogged = false;
let curtidasDoUsuario = new Set();
let tiveDoUsuario = new Set();
let queriaDoUsuario = new Set();
let currentCols = 0;
let columnElements = [];
let filtroAtivo = "todos"; // 'todos', 'tive', 'queria', 'curtidas'
let isSearching = false; // 🛡️ DISJUNTOR FIX 6.5: Trava o scroll infinito automático durante o reset da busca

const sentinel = document.createElement("div");
sentinel.id = "scrollSentinel";
sentinel.className =
  "w-full h-10 col-span-full mt-4 opacity-0 pointer-events-none";

/* 3.3. INFINITE SCROLL E CHAMADAS DE API */

/* 3.3.2. Verifica se o sentinel ainda está visível após um fetch terminar
   e dispara mais um lote se necessário — cobre o gap do desktop (6 colunas) */
function verificarSentinela() {
  // H7/C3 — protege contra disparo parasita durante reset de busca
  if (isSearching) return;

  // Masonry infinito: ao chegar no fim em modo normal, reinicia com novo seed
  if (!hasMais) {
    if (!buscaAtiva && !filtroPessoalAtivo) {
      _reiniciarCicloInfinito();
    }
    return;
  }

  // Aguarda o browser pintar os novos cards antes de medir
  requestAnimationFrame(() => {
    const rect = sentinel.getBoundingClientRect();
    // ✅ Margem generosa: cobre mesmo telas 4K com 6 colunas
    if (rect.top < window.innerHeight + 1200 && !isLoading && !isSearching) {
      fetchBrinquedos();
    }
  });
}

// Reinicia o ciclo infinito com novo seed — grid preservado (append mode)
function _reiniciarCicloInfinito() {
  sessionSeed = Math.random(); // novo embaralhamento — ordem diferente da rodada anterior
  cursor = 0;
  hasMais = true;
  fetchBrinquedos(false); // append — cards novos abaixo dos existentes
}

/* 3.11.1. Monta o vigia de scroll dinâmico (único ponto de disparo) */
function setupObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      // 🛡️ VALIDAÇÃO COMPLEMENTAR: Só dispara se o sentinel estiver visível,
      // se não estiver carregando E se NÃO estiver no meio de um reset de busca (isSearching)
      if (entries[0].isIntersecting && !isLoading && !isSearching) {
        verificarSentinela();
      }
    },
    // rootMargin aumentado: pré-carrega antes do usuário chegar ao fim
    { rootMargin: "1200px" },
  );

  const mainElement = document.querySelector("main");
  if (mainElement) {
    mainElement.appendChild(sentinel);
    observer.observe(sentinel);
  }
}

/* ============================================================
   3.3. INFINITE SCROLL OTIMIZADO
   ============================================================ */

/* 3.3.1. Ranking — dados pré-computados no boot, modal acionado pelo pódio */

// Estado do ranking — calculado uma vez, reutilizado a cada abertura do modal
let _rankingDados = null;
let _rankingModoAtivo = "curtidas"; // "curtidas" | "visualizacoes"

async function _prepararDadosRanking() {
  if (_rankingDados) return; // já calculado nessa sessão — no-op

  try {
    const campos = "id, nome, fabricante, url_frente, curtidas_count, visualizacoes";

    const [resCurtidas, resVisualizacoes] = await Promise.all([
      supabaseClient
        .from("brinquedos")
        .select(campos)
        .order("curtidas_count", { ascending: false })
        .limit(3),
      supabaseClient
        .from("brinquedos")
        .select(campos)
        .order("visualizacoes", { ascending: false })
        .limit(3),
    ]);

    if (resCurtidas.error || resVisualizacoes.error) return;

    _rankingDados = {
      curtidas: resCurtidas.data || [],
      visualizacoes: resVisualizacoes.data || [],
      timestamp: new Date().toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
    };

    // Prefetch silencioso das imagens — máx 6, deduplicadas por id
    const vistas = new Set();
    for (const toy of [..._rankingDados.curtidas, ..._rankingDados.visualizacoes]) {
      if (vistas.has(toy.id)) continue;
      vistas.add(toy.id);
      const url = _imagemRankingURL(toy.url_frente || "");
      if (url) { const img = new Image(); img.src = url; }
    }
  } catch (_) {} // silencioso — ranking simplesmente não aparece se falhar
}

function _imagemRankingURL(url) {
  // Solicita versão 80×80 crop quadrado ao Cloudinary — miniatura leve para o modal
  if (!url || !url.includes("cloudinary.com")) return url || "";
  return url.replace("/upload/", "/upload/f_auto,q_auto,w_80,h_80,c_fill,g_auto/");
}

function _renderizarListaRanking(modo) {
  const lista = document.getElementById("rankingLista");
  const titulo = document.getElementById("rankingTitulo");
  if (!lista || !_rankingDados) return;

  const isCurtidas = modo === "curtidas";
  titulo.textContent = isCurtidas ? "Brinquedos mais Curtidos" : "Brinquedos mais Visualizados";

  const itens = _rankingDados[modo];
  lista.innerHTML = itens.map((toy, i) => {
    const pos = i + 1;
    const imgURL = _imagemRankingURL(toy.url_frente || "");
    const valor = isCurtidas ? (toy.curtidas_count || 0) : (toy.visualizacoes || 0);
    const icone = isCurtidas ? "❤" : "👁";
    const corValor = isCurtidas
      ? "color: var(--trunfo-gold)"
      : "color: var(--neon-blue)";
    return `<li class="ranking-modal-item">
      <span class="ranking-modal-pos">${pos}.</span>
      <img class="ranking-modal-img" src="${imgURL}" alt="${toy.nome}" loading="lazy" />
      <div class="ranking-modal-info">
        <span class="ranking-modal-nome">${toy.nome}</span>
        <span class="ranking-modal-fabricante">${toy.fabricante || ""}</span>
      </div>
      <span class="ranking-modal-valor" style="${corValor}">${icone} ${valor}</span>
    </li>`;
  }).join("");
}

function abrirRankingModal() {
  _prepararDadosRanking(); // no-op se já calculado
  const modal = document.getElementById("rankingModal");
  if (!modal) return;

  // Renderiza o modo atual
  _renderizarListaRanking(_rankingModoAtivo);

  // Atualiza timestamp
  const ts = document.getElementById("rankingTimestamp");
  if (ts && _rankingDados) ts.textContent = "Atualizado em: " + _rankingDados.timestamp;

  // Sincroniza botões com modo ativo
  _sincronizarBotoesRanking(_rankingModoAtivo);

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function fecharRankingModal(event) {
  const modal = document.getElementById("rankingModal");
  if (!modal) return;
  // Fecha apenas se clicar no overlay, não dentro do box
  if (event && event.target !== modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function trocarRanking(modo) {
  _rankingModoAtivo = modo;
  _renderizarListaRanking(modo);
  _sincronizarBotoesRanking(modo);
}

function _sincronizarBotoesRanking(modo) {
  const btnC = document.getElementById("rankingBtnCurtidas");
  const btnV = document.getElementById("rankingBtnVisualizacoes");
  if (!btnC || !btnV) return;
  if (modo === "curtidas") {
    btnC.className = "ranking-toggle-btn ranking-toggle-ativo";
    btnV.className = "ranking-toggle-btn ranking-toggle-inativo";
  } else {
    btnV.className = "ranking-toggle-btn ranking-toggle-ativo";
    btnC.className = "ranking-toggle-btn ranking-toggle-inativo";
  }
}

async function fetchBrinquedos(reset = false) {
  if (isLoading || (!hasMais && !reset)) return;
  isLoading = true;

  const grid = document.getElementById("toyGrid");

  // --- 1. FASE DE PREPARAÇÃO (EXIBIÇÃO DOS SKELETONS) ---
  if (reset) {
    cursor = 0;
    allToys = [];
    hasMais = true;

    // H7/C2 — remove fisicamente o sentinel do DOM antes de esvaziar o grid.
    // Isso impede que o IntersectionObserver detecte o sentinel "fantasma"
    // quando a página encolhe após grid.innerHTML = "".
    // O sentinel é reconectado no finally após o Masonry estabilizar.
    if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);

    // Calcula colunas e preenche com skeletons antes da carga
    const targetCols = getColumnCount();
    grid.innerHTML = "";
    for (let i = 0; i < targetCols; i++) {
      const colDiv = document.createElement("div");
      colDiv.className = "masonry-column";
      // 2 skeletons por coluna para preencher a dobra inicial da tela
      colDiv.innerHTML = Array(2)
        .fill('<div class="skeleton-card"></div>')
        .join("");
      grid.appendChild(colDiv);
    }
  } else {
    // Scroll Infinito: adiciona um skeleton no final de cada coluna existente
    const cols = document.querySelectorAll(".masonry-column");
    cols.forEach((col) => {
      const skeleton = document.createElement("div");
      skeleton.className = "skeleton-card temp-skeleton";
      col.appendChild(skeleton);
    });
  }

  try {
    // --- 2. CHAMADA DOS DADOS (SUPABASE / VERCEL) ---
    let itens = [];

    // 🛡️ FILTROS "MEU QUARTO": Busca server-side direta pelos IDs do Set local.
    // Isso elimina a "loteria de paginação": em vez de buscar 20 itens aleatórios
    // e esperar que os marcados apareçam, buscamos EXATAMENTE os IDs que o usuário
    // marcou. Sem race condition, sem dependência de scroll infinito.
    if (filtroAtivo !== "todos" && buscaAtiva.length < 2) {
      // Seleciona o Set correto para o filtro ativo
      const setAtivo =
        filtroAtivo === "tive"
          ? tiveDoUsuario
          : filtroAtivo === "queria"
            ? queriaDoUsuario
            : curtidasDoUsuario;

      const idsFiltro = [...setAtivo];

      // Se o Set estiver vazio, não há nada a buscar
      if (idsFiltro.length === 0) {
        if (reset) grid.innerHTML = "";
        document
          .querySelectorAll(".temp-skeleton")
          .forEach((el) => el.remove());
        grid.innerHTML = `
          <div class="col-span-full text-center py-20">
            <p class="text-pink-500 font-retro text-xl">NENHUM ITEM AQUI AINDA</p>
            <p class="text-slate-500 font-orbitron text-xs mt-2">
              ${
                filtroAtivo === "tive"
                  ? "MARQUE OS BRINQUEDOS QUE VOCÊ TEVE"
                  : filtroAtivo === "queria"
                    ? "MARQUE OS BRINQUEDOS QUE VOCÊ QUERIA TER"
                    : "CURTA OS BRINQUEDOS QUE VOCÊ AMOU"
              }
            </p>
          </div>`;
        hasMais = false;
        return; // Sai do try, vai pro finally
      }

      // Busca todos os itens do filtro de uma vez (sem paginação — coleção pessoal
      // raramente terá centenas de itens).
      // ⚠️ IDs são VARCHAR "0052" no banco — NÃO converter para int, passar como string.
      const { data, error: filtroError } = await supabaseClient
        .from("brinquedos")
        .select("*")
        .in("id", idsFiltro);

      if (filtroError) throw filtroError;
      itens = data || [];
      hasMais = false; // Coleção pessoal: todos os itens chegam de uma vez
    } else if (buscaAtiva.length >= 2) {
      // BUSCA POR TEXTO: usa o RPC com unaccent
      const { data, error: rpcError } = await supabaseClient.rpc(
        "buscar_brinquedos_search",
        { termo_busca: buscaAtiva, cursor_val: cursor, limite_val: LIMITE },
      );
      if (rpcError) throw rpcError;
      itens = data || [];
    } else {
      // MODO NORMAL (Todos): paginação aleatória via Vercel
      const res = await fetch(
        `/api/brinquedos?cursor=${cursor}&limite=${LIMITE}&seed=${sessionSeed}`,
      );
      if (!res.ok) throw new Error("Falha na API");
      const data = await res.json();

      if (reset && data.total) {
        document.getElementById("heroCount").textContent = data.total;
        // Pré-computa o ranking via query dedicada ao Supabase em background
        requestAnimationFrame(() => { _prepararDadosRanking(); });
      }

      itens = data.itens || [];
      cursor = data.cursor;
      hasMais = data.temMais;
    }

    // --- 3. LIMPEZA DOS SKELETONS ---
    if (reset) {
      grid.innerHTML = ""; // Limpa tudo para o render() reconstruir as colunas
    } else {
      // Remove apenas os skeletons temporários do scroll
      document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
    }

    // --- 4. DEDUPLICAÇÃO: Garante unicidade antes de tocar no DOM ---
    // ✅ Filtra itens cujo ID já existe em allToys (memória) OU no DOM (zumbi)
    const idsEmMemoria = new Set(
      allToys.map((t) => String(t.id).padStart(4, "0")),
    );
    const itensNovos = itens.filter((toy) => {
      const idStr = String(toy.id).padStart(4, "0");
      return !idsEmMemoria.has(idStr);
    });

    // --- 5. RENDERIZAÇÃO DOS CARDS REAIS ---
    if (itensNovos.length > 0) {
      allToys = reset ? itensNovos : [...allToys, ...itensNovos];
      await render(itensNovos, !reset);

      // Ajuste de cursor manual para busca RPC
      if (buscaAtiva.length >= 2 && !reset) {
        cursor += itens.length;
      }
    } else if (reset) {
      // H2/H3 — w-full centraliza no masonry (display:flex, não CSS grid)
      const termoAtual = buscaAtiva || "";
      grid.innerHTML = `
        <div style="width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:5rem 1rem;gap:1rem;">
          <p class="text-pink-500 font-retro text-xl">ITEM NÃO ENCONTRADO</p>
          <p class="text-slate-500 font-orbitron text-xs">VERIFIQUE O TERMO</p>
          <button
            onclick="abrirSugestaoModal('${termoAtual}')"
            class="sugestao-trigger-btn mt-2"
            title="Você pode sugerir o item para que ele entre para a coleção do RetroBrinquedos"
          >
            ▶ SUGERIR ITEM
          </button>
        </div>`;
      hasMais = false;
    } else {
      hasMais = false;
    }
  } catch (error) {
    console.error("Erro na carga:", error);
    if (reset)
      grid.innerHTML =
        "<p class='text-center col-span-full text-pink-500 font-retro'>ERRO DE CONEXÃO COM O ARQUIVO</p>";
    document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
  } finally {
    isLoading = false;

    // H7/C4 — reconecta o sentinel ao DOM (foi removido no início do reset pelo C2)
    // e só então desliga o disjuntor, garantindo que o observer não dispara
    // antes do Masonry ter estabilizado completamente.
    // Timer estendido de 400→600ms: margem maior para mobile com muitos cards.
    setTimeout(() => {
      const mainElement = document.querySelector("main");
      if (mainElement && !sentinel.parentNode) {
        mainElement.appendChild(sentinel);
      }
      isSearching = false;
      // verificarSentinela só roda após isSearching=false — C3 garante proteção adicional
      verificarSentinela();
    }, 600);
  }
}

/* 3.4.1. Define colunas do grid pelo tamanho da tela */
function getColumnCount() {
  const width = window.innerWidth;
  if (width >= 1536) return 6; // Desktop Extra Largo
  if (width >= 1280) return 5; // Desktop Largo
  if (width >= 1024) return 4; // Desktop comum / Tablet Horizontal
  if (width >= 640) return 3; // Tablet Vertical
  return 2; // Mobile (Padrão)
}

/* 3.4.2. Gera código HTML dos LEDs de raridade */
function buildLedDisplay(value) {
  const v = Math.round(Math.min(10, Math.max(0, value)));
  function ledClass(idx) {
    if (idx > v) return "led";
    if (idx <= 6) return "led on-green";
    if (idx <= 8) return "led on-yellow";
    return "led on-red";
  }
  const leds = Array.from(
    { length: 10 },
    (_, i) => `<div class="${ledClass(i + 1)}"></div>`,
  ).join("");
  return `<div class="led-display"><div class="led-row">${leds}</div><div class="led-row">${leds}</div></div>`;
}

/* ---------------------------------------------------
   GERADOR DE CÓDIGO SUPER TRUNFO 3.4.2.B
--------------------------------------------------- */
function gerarIdSuperTrunfo(idBrinquedo) {
  // Converte o ID para número (caso seja string)
  const idNum =
    typeof idBrinquedo === "number"
      ? idBrinquedo
      : parseInt(String(idBrinquedo).replace(/\D/g, "")) || 0;

  // Padrão clássico de baralho: Letras de A a H, Números de 1 a 4
  const letras = ["A", "B", "C", "D", "E", "F", "G", "H"];

  // Multiplicadores primos (3 e 7) espalham os resultados para parecerem bem aleatórios
  const letra = letras[(idNum * 3) % letras.length];
  const numero = ((idNum * 7) % 4) + 1;

  return `${letra}${numero}`;
}

/* 3.4.2 C */
/* Função auxiliar para injetar transformações na URL do Cloudinary */
function otimizarUrlCloudinary(url, largura = 600) {
  if (!url || !url.includes("cloudinary.com")) return url;
  // f_auto: formato automático (WebP/AVIF)
  // q_auto: qualidade automática inteligente
  // w_XXX: redimensiona para a largura necessária
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${largura},c_limit/`);
}

/* 3.4.3. Monta e insere os cards 3D no HTML */
/* 3.4.3. MASONRY COM INSERÇÃO SEQUENCIAL E IMAGENS OTIMIZADAS */
async function render(items, append = false) {
  const grid = document.getElementById("toyGrid");
  const targetCols = getColumnCount();

  if (!append || currentCols !== targetCols) {
    grid.innerHTML = "";
    columnElements = [];
    currentCols = targetCols;
    for (let i = 0; i < currentCols; i++) {
      const colDiv = document.createElement("div");
      colDiv.className = "masonry-column";
      grid.appendChild(colDiv);
      columnElements.push(colDiv);
    }
  }

  // 🔄 LOOP SEQUENCIAL: Essencial para o cálculo de offsetHeight funcionar
  for (const toy of items) {
    const idNormalizado = String(toy.id).padStart(4, "0");

    // 🛡️ GUARDA DE UNICIDADE: Última linha de defesa antes de tocar no DOM.
    // Remove qualquer zumbi remanescente para garantir que o ID seja único.
    const cardZumbi = document.getElementById(`card-${idNormalizado}`);
    if (cardZumbi) cardZumbi.remove();

    const ledHTML = buildLedDisplay(toy.raridade);
    const isLiked = curtidasDoUsuario.has(idNormalizado);
    const isTive = tiveDoUsuario.has(idNormalizado);
    const isQueria = queriaDoUsuario.has(idNormalizado);
    const trunfoCode = toy.codigo_trunfo || gerarIdSuperTrunfo(toy.id);

    // ✅ CHAMADA DA OTIMIZAÇÃO: 600px para frente, 500px para o verso (menor)
    const urlFrenteOtimizada = otimizarUrlCloudinary(toy.url_frente, 600);
    const urlVersoOtimizada = otimizarUrlCloudinary(toy.url_verso, 500);

    const cardHTML = `
    <div class="masonry-item card-enter" id="card-${idNormalizado}">
      <div class="card-inner" onclick="handleFlip('${idNormalizado}')">
        <div class="card-front">
          <img src="${urlFrenteOtimizada}" alt="${toy.nome}" class="w-full h-auto block" loading="lazy">
        </div>
        <div class="card-back flex flex-col">
          <!-- NOVO CARD VERSO v2 — layout Super Trunfo real -->
          <div class="trunfo-header">
            <!-- Linha 1: grid 3 colunas [código | título central | ✕] -->
            <div class="trunfo-top-bar-v2">
              <span class="trunfo-code-v2">${trunfoCode}</span>
              <span class="trunfo-brand-v2">RETROBRINQUEDOS</span>
              <button class="trunfo-close-v2" onclick="handleFlip('${idNormalizado}'); event.stopPropagation();" title="Fechar">✕</button>
            </div>
            <!-- Linha 2: estrela + nome do brinquedo -->
            <div class="trunfo-title-area">
              <div class="trunfo-star"></div>
              <span class="trunfo-title-text">${toy.nome}</span>
            </div>
          </div>
          <div class="trunfo-photo-wrapper">
            <div class="trunfo-photo-frame">
              <img src="${urlVersoOtimizada}" alt="${toy.nome} verso" class="trunfo-photo" loading="lazy">
              <span class="trunfo-photo-year">${toy.ano}</span>
            </div>
          </div>

          <div class="trunfo-stats-area">
            <!-- Curiosidade em itálico -->
            <div class="trunfo-curiosidade-v2">"${toy.curiosidade}"</div>
            <!-- Atributos: label dourado | valor branco -->
            <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${toy.fabricante}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${toy.categoria}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${toy.tema}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Raridade</span><span class="trunfo-value">${toy.raridade}/10</span></div>
            <div class="trunfo-stat-row trunfo-stat-last"><span class="trunfo-label">Visualizações</span><span class="trunfo-value" id="views-${idNormalizado}">👁 ${toy.visualizacoes || 0}</span></div>
            <!-- Linha 15: EU TIVE | QUERIA TER -->
            <div class="trunfo-actions-v2">
              <button id="btn-tive-${idNormalizado}" class="action-btn-v2 action-tive ${isTive ? "active-tive" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'tive')">
                EU TIVE <span class="action-count-v2" id="count-tive-${idNormalizado}">${toy.tive_count || 0}</span>
              </button>
              <button id="btn-queria-${idNormalizado}" class="action-btn-v2 action-queria ${isQueria ? "active-queria" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'queria')">
                QUERIA TER <span class="action-count-v2" id="count-queria-${idNormalizado}">${toy.queria_count || 0}</span>
              </button>
            </div>
          </div>

          <!-- FOOTER: 3 botões iguais — Comentário | WhatsApp | Curtir -->
          <div class="trunfo-footer">
            <div class="footer-icons-container">

              <!-- 💬 Comentários — Bloco F: deslogado abre drawer em modo espia -->
              <button
                class="footer-tab-btn comment-tab-btn"
                onclick="abrirDrawerComentarios(event, '${idNormalizado}', '${toy.nome.replace(/'/g, "\\'")}'); event.stopPropagation();"
                title="${isUserLogged ? "Comentar" : "Ver comentários"}"
              >
                <svg class="tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.486 2 2 6.486 2 12c0 1.863.507 3.605 1.383 5.11L2 22l5.01-1.346A9.956 9.956 0 0 0 12 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a7.955 7.955 0 0 1-4.065-1.112l-.293-.173-3.006.808.829-2.927-.192-.302A7.947 7.947 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
                </svg>
              </button>

              <!-- 📲 WhatsApp — sempre ativo -->
              <button
                class="footer-tab-btn whatsapp-tab-btn"
                onclick="compartilharWhatsApp(event, '${idNormalizado}', '${toy.nome.replace(/'/g, "\\'").replace(/"/g, "&quot;")}'); event.stopPropagation();"
                title="Compartilhar no WhatsApp"
              >
                <svg class="tab-icon-svg whatsapp-tab-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </button>

              <!-- ❤ Curtida + contador -->
              <button
                id="heart-btn-${idNormalizado}"
                class="footer-tab-btn heart-tab-btn ${isLiked ? "liked" : ""} ${!isUserLogged ? "tab-locked" : ""}"
                onclick="${
                  isUserLogged
                    ? `toggleCurtida(event, '${idNormalizado}'); event.stopPropagation();`
                    : `event.stopPropagation(); mostrarMensagemLED('Faça login para curtir!');`
                }"
                title="${isUserLogged ? "Curtir" : "Faça login para curtir"}"
              >
                <svg class="heart-svg tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/>
                </svg>
                <span class="tab-count" id="count-${idNormalizado}">${toy.curtidas_count || 0}</span>
              </button>

            </div>
          </div>
        </div>
      </div>
    </div>`;

    /* 🎯 CÁLCULO PRECISO: Insere na coluna que está REALMENTE mais curta */
    const shortest = columnElements.reduce((min, col) =>
      col.offsetHeight < min.offsetHeight ? col : min,
    );

    shortest.insertAdjacentHTML("beforeend", cardHTML);

    // 💡 MASONRY PRECISO: Aguarda a imagem da frente carregar antes de medir
    // offsetHeight. Em mobile com conexão lenta o rAF duplo não é suficiente —
    // a imagem ainda não tem altura real quando medimos, causando desbalanceamento.
    const imgInserida = shortest.querySelector(
      `#card-${idNormalizado} .card-front img`,
    );
    if (imgInserida && !imgInserida.complete) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 800); // segurança: máx 800ms
        imgInserida.addEventListener(
          "load",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        imgInserida.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
    }

    // rAF duplo para garantir que o browser atualizou o layout após o load
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }
}

/* 3.5. MECÂNICA DE INTERAÇÃO (Flip e Desfocar) */

/* 3.5.1. Vira o card com cálculo de scroll dinâmico (Idêntico em Todas as Telas) */
const _cardsVistos = new Set(); // controle de sessão — 1 visualização por card

async function registrarVisualizacao(id) {
  if (_cardsVistos.has(id)) return; // já contou nessa sessão — ignora
  _cardsVistos.add(id);
  try {
    await supabaseClient.rpc("increment_visualizacoes", { card_id: id });
  } catch (_) {} // silencioso — não bloqueia o flip em caso de falha
}

function handleFlip(id) {
  // 🛡️ ESCUDO DE FOCO MOBILE (Anti-Bubbling Nativo)
  const evento = window.event;
  if (evento && evento.target) {
    const tag = evento.target.tagName.toLowerCase();
    if (
      tag === "input" ||
      tag === "button" ||
      tag === "svg" ||
      tag === "path" ||
      evento.target.closest(".comment-area")
    ) {
      return;
    }
  }

  // C3 — Mobile: abre modal centralizado com proporção de carta real
  if (window.innerWidth < 768) {
    abrirCardVersoMobile(id);
    return;
  }

  // Desktop: flip CSS original preservado integralmente
  const grid = document.getElementById("toyGrid");
  const card = document.getElementById(`card-${id}`);
  const isFlipped = card.classList.contains("is-flipped");

  if (grid.classList.contains("grid-focused") && !isFlipped) {
    return;
  }

  document
    .querySelectorAll(".masonry-item")
    .forEach((c) => c.classList.remove("is-flipped"));

  if (!isFlipped) {
    registrarVisualizacao(id); // fire-and-forget — não bloqueia o flip
    card.classList.add("is-flipped");
    grid.classList.add("grid-focused");

    const nav = document.querySelector("nav");
    const led = document.getElementById("ledPanel");
    let headerHeight = nav ? nav.getBoundingClientRect().height : 72;

    if (ledPainelAtivo && led) {
      headerHeight += led.getBoundingClientRect().height;
    }

    const yOffset = -(headerHeight + 16);
    const y = card.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: "smooth" });
  } else {
    grid.classList.remove("grid-focused");
  }
}

// C3 — Abre o verso do card num modal centralizado no mobile
function abrirCardVersoMobile(id) {
  const data = allToys.find(
    (t) => String(t.id).padStart(4, "0") === String(id).padStart(4, "0")
  );
  if (!data) return;

  registrarVisualizacao(String(data.id).padStart(4, "0")); // fire-and-forget

  const idNormalizado = String(data.id).padStart(4, "0");
  const urlVersoOtimizada = otimizarUrlCloudinary(data.url_verso, 500);
  const trunfoCode = data.codigo_trunfo || gerarIdSuperTrunfo(data.id);
  const isTive   = tiveDoUsuario.has(idNormalizado);
  const isQueria = queriaDoUsuario.has(idNormalizado);
  const isLiked  = curtidasDoUsuario.has(idNormalizado);

  const box = document.getElementById("cardVersoMobileBox");
  if (!box) return;

  box.innerHTML = `
    <div class="trunfo-header">
      <div class="trunfo-top-bar-v2">
        <span class="trunfo-code-v2">${trunfoCode}</span>
        <span class="trunfo-brand-v2">RETROBRINQUEDOS</span>
        <button class="trunfo-close-v2" onclick="fecharCardVersoMobile()" title="Fechar">✕</button>
      </div>
      <div class="trunfo-title-area">
        <div class="trunfo-star"></div>
        <span class="trunfo-title-text">${data.nome}</span>
      </div>
    </div>
    <div class="trunfo-photo-wrapper">
      <div class="trunfo-photo-frame">
        <img src="${urlVersoOtimizada}" alt="${data.nome}" class="trunfo-photo" loading="eager">
        <span class="trunfo-photo-year">${data.ano}</span>
      </div>
    </div>
    <div class="trunfo-stats-area">
      <!-- Curiosidade: área variável flex:1 com scroll se necessário -->
      <div class="trunfo-curiosidade-v2">"${data.curiosidade}"</div>
      <!-- Atributos ancorados na base -->
      <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${data.fabricante}</span></div>
      <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${data.categoria}</span></div>
      <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${data.tema}</span></div>
      <div class="trunfo-stat-row"><span class="trunfo-label">Raridade</span><span class="trunfo-value">${data.raridade}/10</span></div>
      <div class="trunfo-stat-row trunfo-stat-last"><span class="trunfo-label">Visualizações</span><span class="trunfo-value" id="m-views-${idNormalizado}">👁 ${data.visualizacoes || 0}</span></div>
      <!-- EU TIVE / QUERIA TER ancorados logo acima do footer -->
      <div class="trunfo-actions-v2">
        <button id="m-btn-tive-${idNormalizado}" class="action-btn-v2 action-tive ${isTive ? "active-tive" : ""}" onclick="toggleInteracaoModal(event, '${idNormalizado}', 'tive')">
          EU TIVE <span class="action-count-v2" id="m-count-tive-${idNormalizado}">${data.tive_count || 0}</span>
        </button>
        <button id="m-btn-queria-${idNormalizado}" class="action-btn-v2 action-queria ${isQueria ? "active-queria" : ""}" onclick="toggleInteracaoModal(event, '${idNormalizado}', 'queria')">
          QUERIA TER <span class="action-count-v2" id="m-count-queria-${idNormalizado}">${data.queria_count || 0}</span>
        </button>
      </div>
    </div>
    <div class="trunfo-footer">
      <div class="footer-icons-container">
        <button
          class="footer-tab-btn comment-tab-btn"
          onclick="abrirDrawerComentarios(event, '${idNormalizado}', '${data.nome.replace(/'/g, "\\'")}'); fecharCardVersoMobile();"
          title="${isUserLogged ? "Comentar" : "Ver comentários"}"
        >
          <svg class="tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.486 2 2 6.486 2 12c0 1.863.507 3.605 1.383 5.11L2 22l5.01-1.346A9.956 9.956 0 0 0 12 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a7.955 7.955 0 0 1-4.065-1.112l-.293-.173-3.006.808.829-2.927-.192-.302A7.947 7.947 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
        </button>
        <button
          class="footer-tab-btn whatsapp-tab-btn"
          onclick="compartilharWhatsApp(event, '${idNormalizado}', '${data.nome.replace(/'/g, "\\'").replace(/"/g, "&quot;")}'); fecharCardVersoMobile();"
          title="Compartilhar no WhatsApp"
        >
          <svg class="tab-icon-svg whatsapp-tab-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </button>
        <button
          id="m-heart-btn-${idNormalizado}"
          class="footer-tab-btn heart-tab-btn ${isLiked ? "liked" : ""} ${!isUserLogged ? "tab-locked" : ""}"
          onclick="toggleCurtidaModal(event, '${idNormalizado}')"
          title="${isUserLogged ? "Curtir" : "Faça login para curtir"}"
        >
          <svg class="heart-svg tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg>
          <span class="tab-count" id="m-count-${idNormalizado}">${data.curtidas_count || 0}</span>
        </button>
      </div>
    </div>`;

  const modal = document.getElementById("cardVersoMobileModal");
  if (modal) {
    // 2 — Efeito de saída no card frente: leve fade+scale antes do modal abrir
    const cardEl = document.getElementById(`card-${String(id).padStart(4, "0")}`);
    if (cardEl) {
      cardEl.style.transition = "opacity 0.15s ease, transform 0.15s ease";
      cardEl.style.opacity = "0.4";
      cardEl.style.transform = "scale(0.97)";
      setTimeout(() => {
        cardEl.style.opacity = "";
        cardEl.style.transform = "";
        cardEl.style.transition = "";
      }, 320);
    }
    // 3 — Reinicia a animação do box (necessário se o mesmo card for aberto 2x)
    box.style.animation = "none";
    box.offsetHeight; // reflow forçado — descarta o frame anterior
    box.style.animation = "";
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

// Toast de feedback dentro do modal — substitui LED coberto pelo overlay
let _toastTimer = null;
// Wrappers para ações no modal mobile — evita template literals aninhados
function toggleInteracaoModal(event, id, tipo) {
  if (!isUserLogged) {
    event.stopPropagation();
    mostrarToastModal("FAÇA LOGIN PARA INTERAGIR");
    return;
  }
  toggleInteracao(event, id, tipo);
}

function toggleCurtidaModal(event, id) {
  if (!isUserLogged) {
    event.stopPropagation();
    mostrarToastModal("FAÇA LOGIN PARA CURTIR");
    return;
  }
  toggleCurtida(event, id);
}

function mostrarToastModal(mensagem) {
  const toast = document.getElementById("cardVersoToast");
  if (!toast) return;
  clearTimeout(_toastTimer);
  toast.textContent = "⚡ " + mensagem;
  toast.classList.remove("hidden");
  toast.classList.add("card-verso-toast--visible");
  _toastTimer = setTimeout(() => {
    toast.classList.remove("card-verso-toast--visible");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2500);
}

function fecharCardVersoMobile(event) {
  // Se clicou no box interno, não fecha
  if (event && event.target !== document.getElementById("cardVersoMobileModal")) return;
  const modal = document.getElementById("cardVersoMobileModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

/* 3.5.2. Escuta cliques externos para fechar cards */
document.addEventListener("click", (event) => {
  const grid = document.getElementById("toyGrid");
  if (grid && grid.classList.contains("grid-focused")) {
    const flippedCard = document.querySelector(".masonry-item.is-flipped");
    if (flippedCard && !flippedCard.contains(event.target))
      resetarEstadoDosCards();
  }
});

function resetarEstadoDosCards() {
  const grid = document.getElementById("toyGrid");
  if (grid) grid.classList.remove("grid-focused");
  document.body.style.overflow = ""; // Garante scroll livre do body
  document
    .querySelectorAll(".masonry-item")
    .forEach((card) => card.classList.remove("is-flipped"));
}

/* Letras Vermelhas Piscantes de Alerta (Locked) — Bloqueado contra concorrência */
let ledLocked = false;

function mostrarMensagemLED(mensagem) {
  if (ledLocked) return; // Guarda de estado: impede que cliques múltiplos quebrem o ciclo
  ledLocked = true;

  const estavaDesligado = !ledPainelAtivo;
  ledTiltAtivo = true;

  const el = document.getElementById("ledContent");
  const painel = document.getElementById("ledPanel");
  if (!el || !painel) {
    ledLocked = false;
    return;
  }

  if (estavaDesligado) {
    painel.classList.remove("is-off");
    animarLigar();
  }

  el.style.animation = "none";
  el.offsetHeight; // Reflow forçado

  el.textContent = `⚡ ${mensagem} ⚡`;
  el.classList.add("tilt-mode");
  painel.style.borderColor = "rgba(255,32,32,0.6)";
  painel.style.boxShadow =
    "0 0 16px rgba(255,32,32,0.3) inset, 0 2px 8px rgba(0,0,0,0.4)";

  // Sequência fixa e síncrona: 6 passos (3 piscadas) com velocidade 20% mais lenta (850ms)
  let passo = 0;
  const totalPassos = 6;

  const piscadoLocked = setInterval(() => {
    el.style.opacity = el.style.opacity === "0" ? "1" : "0";
    passo++;

    if (passo >= totalPassos) {
      clearInterval(piscadoLocked);
      el.style.opacity = "1";
      ledTiltAtivo = false;
      ledLocked = false; // Libera o motor do LED

      painel.style.borderColor = "";
      painel.style.boxShadow = "";

      if (estavaDesligado) {
        animarDesligar(() => {
          painel.classList.add("is-off");
          el.classList.remove("tilt-mode");
          el.textContent = "";
        });
      } else {
        el.classList.remove("tilt-mode");
        el.textContent = "";
        iniciarCicloLED(); // Devolve para o fluxo normal do banco
      }
    }
  }, 850); // 20% mais lento que os 700ms originais do tilt comum
}

/* 3.5.3. COMPARTILHAMENTO DE MÍDIA NATIVA (MOBILE) OU LINK LIMPO (DESKTOP) */
async function compartilharWhatsApp(event, id, nome) {
  if (event) event.stopPropagation();

  // Localiza o brinquedo na memória RAM da aplicação (allToys)
  const toyData = allToys.find(
    (t) => String(t.id).padStart(4, "0") === String(id).padStart(4, "0"),
  );
  const urlImagemFrente = toyData ? toyData.url_frente : "";
  const urlSPA = window.location.origin + window.location.pathname;

  // Legenda rica que vai acoplada à foto real no Mobile
  const legendaText =
    `*RetroBrinquedos BR* — Você se lembra deste? *${nome}*\n` +
    `Reviva a nostalgia dos anos 80/90!\n\n` +
    `${urlSPA}`;

  // 📱 DIRECTIVA ESTRETA MOBILE: Só tenta compartilhar arquivo binário em telas menores que 768px
  if (
    window.innerWidth < 768 &&
    navigator.canShare &&
    navigator.share &&
    urlImagemFrente
  ) {
    try {
      const response = await fetch(urlImagemFrente);
      const blob = await response.blob();
      const arquivoImagem = new File(
        [blob],
        `${String(id).padStart(4, "0")}_frente.jpg`,
        { type: blob.type },
      );

      if (navigator.canShare({ files: [arquivoImagem] })) {
        await navigator.share({
          files: [arquivoImagem],
          title: "RetroBrinquedos BR",
          text: legendaText,
        });
        return; // Sucesso absoluto no mobile. Sai da função.
      }
    } catch (err) {
      console.warn(
        "Ambiente móvel barrou o arquivo, usando fallback textual...",
        err,
      );
    }
  }

  // 💻 DIRECTIVA ESTRETA DESKTOP / WHATSAPP WEB: Link limpo contextualizado que abre direto na aba
  const mensagemDesktop =
    `*RetroBrinquedos BR* — Você se lembra deste? *${nome}*\n` +
    `Reviva a nostalgia dos anos 80/90!\n\n` +
    `${urlSPA}`;

  window.open(
    `https://wa.me/?text=${encodeURIComponent(mensagemDesktop)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

/* 3.5.5. MODAL DE CARD COMPARTILHADO (Abolido e removido por decisão arquitetural) */
function fecharCardModal() {
  // Mantida apenas como casca de segurança caso algum clique zumbi a chame
  const modal = document.getElementById("cardCompartilhadoModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ============================================================
   3.5.4. DRAWER DE COMENTÁRIOS (Item 3.2)
   ============================================================ */
let drawerIdAtivo = null;
let drawerNomeAtivo = null;

async function abrirDrawerComentarios(event, id, nome) {
  if (event) event.stopPropagation();
  // Bloco F — Modo Espia: drawer abre para todos; input só aparece para logados

  drawerIdAtivo = id;
  drawerNomeAtivo = nome;

  document.getElementById("drawerNomeBrinquedo").textContent = nome;
  document.getElementById("drawerListaComentarios").innerHTML =
    '<p class="drawer-loading">Carregando...</p>';

  // Bloco F — controla visibilidade do input vs banner de login
  const inputArea  = document.getElementById("drawerInputArea");
  const loginBanner = document.getElementById("drawerLoginBanner");
  if (isUserLogged) {
    if (inputArea)   inputArea.classList.remove("hidden");
    if (loginBanner) loginBanner.classList.add("hidden");
    document.getElementById("drawerComentarioInput").value = "";
  } else {
    if (inputArea)   inputArea.classList.add("hidden");
    if (loginBanner) loginBanner.classList.remove("hidden");
  }

  const drawer = document.getElementById("comentariosDrawer");
  drawer.classList.add("open");
  document.body.classList.add("drawer-open");

  await carregarComentariosDrawer(id);
}

function fecharDrawerComentarios() {
  document.getElementById("comentariosDrawer").classList.remove("open");
  document.body.classList.remove("drawer-open");
  drawerIdAtivo = null;
  drawerNomeAtivo = null;
}

function fecharDrawerSeForaDoPanel(event) {
  if (event.target === document.getElementById("comentariosDrawer")) {
    fecharDrawerComentarios();
  }
}

async function carregarComentariosDrawer(id) {
  const lista = document.getElementById("drawerListaComentarios");

  // Roda estrita de 30 Emojis Temáticos Retro-Arcade
  const emojisRetro = [
    "🕹️",
    "👾",
    "🖖",
    "👹",
    "👻",
    "🎮",
    "🛸",
    "☄️",
    "🤖",
    "😊",
    "🔭",
    "💩",
    "📡",
    "🔫",
    "👨‍🚀",
    "🌌",
    "🚀",
    "🐙",
    "🪅",
    "🧸",
    "🧠",
    "🎯",
    "🏆",
    "💾",
    "📺",
    "📻",
    "🎲",
    "🃏",
    "🪀",
    "🪁",
  ];

  try {
    // Adicionado o campo 'usuario_nome' na projeção do SELECT
    const { data, error } = await supabaseClient
      .from("comentarios")
      .select("id, texto, created_at, usuario_id, usuario_nome")
      .eq("brinquedo_id", id)
      .eq("aprovado", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data || data.length === 0) {
      lista.innerHTML =
        '<p class="drawer-empty">Gostou da lembrança? Deixe seu comentário aqui! 🕹️</p>';
      return;
    }

    // Resgata dados da sessão para pintar o próprio nome em dourado retro
    const session = await supabaseClient.auth.getSession();
    const meuUser = session?.data?.session?.user;
    const meuId = meuUser?.id;

    const formatarData = (iso) => {
      const d = new Date(iso);
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
    };

    lista.innerHTML = data
      .map((c, i) => {
        const emoji = emojisRetro[i % emojisRetro.length]; // Garante a rotação exata entre os 30 itens
        const eMeu = meuId && c.usuario_id === meuId;

        // Resgata o nome gravado na tabela. Fallback para 'Jogador' se for nulo por segurança
        const nomeExibicao = c.usuario_nome || "Jogador";

        return `
        <div class="drawer-comentario">
          <div class="drawer-avatar-placeholder">${emoji}</div>
          <div class="drawer-comentario-body">
            <div class="drawer-meta">
              <span class="drawer-user${eMeu ? " drawer-user-me" : ""}">${nomeExibicao}</span>
              <span class="drawer-data">${formatarData(c.created_at)}</span>
            </div>
            <span class="drawer-texto">${c.texto}</span>
          </div>
        </div>`;
      })
      .join("");
  } catch (e) {
    lista.innerHTML =
      '<p class="drawer-empty">Gostou da lembrança? Deixe seu comentário aqui! 🕹️</p>';
    console.error("Erro comentários:", e);
  }
}

async function enviarComentarioDrawer() {
  if (!isUserLogged || !drawerIdAtivo) return; // ✅ Ajustado para a variável canônica do seu app.js

  const input = document.getElementById("drawerComentarioInput");
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;

  // 🛡️ Filtro Anti-Toxicidade Nativo integrado
  if (contemPalavraProibida(texto)) {
    dispararTiltBanimento("LINGUAGEM INADEQUADA DETECTADA");
    input.value = "";
    return;
  }

  try {
    const session = await supabaseClient.auth.getSession();
    const user = session?.data?.session?.user;
    if (!user) return;

    // Extrai o nome real completo dos metadados da sessão ativa (Google/Provedor)
    const nomeReal = user.user_metadata?.full_name || "Jogador";

    const { error } = await supabaseClient.from("comentarios").insert([
      {
        brinquedo_id: drawerIdAtivo, // ✅ Ajustado para persistir como String VARCHAR "0052"
        usuario_id: user.id,
        texto: texto,
        usuario_nome: nomeReal, // Snapshot do nome gravado no INSERT (Solução A)
        aprovado: true, // Aprovação automática pelo filtro de regex
      },
    ]);

    if (error) throw error;

    input.value = "";
    await carregarComentariosDrawer(drawerIdAtivo); // ✅ Atualiza a lista usando o ID ativo correto
    document.getElementById("drawerListaComentarios").scrollTop = 0;
  } catch (err) {
    console.error("Erro ao enviar comentário:", err);
    mostrarMensagemLED("ERRO AO PROCESSAR OPERAÇÃO NO BANCO");
  }
}

function handleDrawerEnter(event) {
  if (event.key === "Enter") enviarComentarioDrawer();
}

/* 3.5.6. MOTOR DO MODAL ESPELHO PARA SELEÇÃO MOBILE */
async function abrirModalEspelhoMobile(cardId) {
  try {
    // Busca o brinquedo direto na memória RAM (allToys) para resposta instantânea (0ms)
    const data = allToys.find(
      (t) => String(t.id).padStart(4, "0") === String(cardId).padStart(4, "0"),
    );
    if (!data) return;

    const idNormalizado = String(data.id).padStart(4, "0");
    const urlVersoOtimizada = otimizarUrlCloudinary(data.url_verso, 500);
    const trunfoCode = data.codigo_trunfo || gerarIdSuperTrunfo(data.id);
    const ledHTML = buildLedDisplay(data.raridade);

    // Alimenta o mesmo container de modal que o index.html já possui pronto
    document.getElementById("cardCompartilhadoContainer").innerHTML = `
      <div class="card-modal-trunfo">
        <div class="trunfo-header">
          <div class="trunfo-top-bar">
            <span>Super Trunfo • RetroBrinquedos</span>
            <span class="trunfo-code-badge">${trunfoCode}</span>
          </div>
          <div class="trunfo-title-area">
            <div class="trunfo-star"></div>
            <span class="trunfo-title-text">${data.nome}</span>
          </div>
        </div>
        <div class="trunfo-photo-wrapper">
          <div class="trunfo-photo-frame">
            <img src="${urlVersoOtimizada}" alt="${data.nome}" class="trunfo-photo">
            <span class="trunfo-photo-year">${data.ano}</span>
          </div>
        </div>
        <div class="trunfo-stats-area">
          <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${data.fabricante}</span></div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${data.categoria}</span></div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${data.tema}</span></div>
          <div class="trunfo-raridade-area">
            <div class="trunfo-raridade-header">
              <span class="trunfo-raridade-label">⬡ Raridade</span>
              <span class="trunfo-raridade-value">${data.raridade}/10</span>
            </div>
            ${ledHTML}
          </div>
          <div class="trunfo-curiosidade">"${data.curiosidade}"</div>
        </div>
        <div class="trunfo-footer">
          <div class="footer-icons-container">
            <button class="footer-tab-btn whatsapp-tab-btn w-full" onclick="compartilharWhatsApp(event, '${idNormalizado}', '${data.nome.replace(/'/g, "\\'")}')">
              <svg class="tab-icon-svg !w-5 !h-5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              <span class="text-[11px] font-orbitron uppercase tracking-wider text-white ml-1">Compartilhar Memória</span>
            </button>
          </div>
        </div>
      </div>`;

    // Remove temporariamente a frase de "Alguém compartilhou" se o clique veio do próprio celular
    const modalLabel = document.querySelector(".card-modal-label");
    if (modalLabel) modalLabel.style.display = "none";

    // Altera o texto do botão inferior para ficar contextualizado
    const modalCta = document.querySelector(".card-modal-cta");
    if (modalCta) modalCta.innerHTML = "✕ Voltar para o Quarto";

    // Abre o modal de visualização móvel de forma imediata
    document
      .getElementById("cardCompartilhadoModal")
      .classList.remove("hidden");
    document.body.style.overflow = "hidden"; // trava rolagem de fundo
  } catch (e) {
    console.error("Erro ao espelhar card mobile:", e);
  }
}

/* ============================================================
   3.6. BUSCA INTELIGENTE (Debounce, Trigger, Disjuntor e Reset Rápido - Item 2)
   ============================================================ */
let buscaAtiva = "";
let fetchAbortController = null; // H7+ — cancela fetch anterior se novo for disparado
let debounceTimer = null;

// Escuta a digitação reativa do usuário
// ── Sanitização XSS: remove tags HTML e caracteres perigosos do termo de busca
function sanitizarBusca(valor) {
  return valor
    .replace(/[<>"'`]/g, "")   // remove caracteres de injeção HTML/JS
    .replace(/\s+/g, " ")       // colapsa espaços múltiplos
    .trim()
    .toLowerCase()
    .slice(0, 60);              // limita tamanho máximo
}

// ── Núcleo da busca — compartilhado entre debounce e botão de busca forçada
async function _executarBusca(term) {
  if (term === buscaAtiva) return;

  // Trava busca vazia — orienta o usuário via LED
  if (term.length === 0 && buscaAtiva === "") {
    mostrarMensagemLED("DIGITE O TERMO QUE DESEJA BUSCAR");
    return;
  }

  // Cancela qualquer fetch anterior que ainda esteja em andamento
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();

  // H7/C1 — isSearching=true ANTES de qualquer outra operação
  isSearching = true;

  // H7/C1 — scroll síncrono ANTES de limpar o grid
  const secaoColecao = document.getElementById("colecao");
  if (secaoColecao) {
    secaoColecao.scrollIntoView({ behavior: "smooth" });
  }

  if (typeof resetarEstadoDosCards === "function") {
    resetarEstadoDosCards();
  }

  buscaAtiva = term;
  cursor = 0;
  allToys = [];
  hasMais = true;

  // Pausa para o scroll iniciar antes do grid esvaziar
  await new Promise(resolve => setTimeout(resolve, 80));

  await fetchBrinquedos(true);
}

// ── Busca forçada — disparada pelo botão de lupa ou Enter
// Cancela o debounce em andamento e executa imediatamente
function executarBuscaForçada() {
  const input = document.getElementById("searchInput");
  if (!input) return;
  const term = sanitizarBusca(input.value);

  if (term.length === 0) {
    mostrarMensagemLED("DIGITE O TERMO QUE DESEJA BUSCAR");
    input.focus();
    return;
  }

  clearTimeout(debounceTimer);
  _executarBusca(term);
}

// ── Listener do input: debounce 600ms + sanitização + Enter
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    executarBuscaForçada();
  }
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = sanitizarBusca(e.target.value);
  const clearBtn = document.getElementById("clearSearchBtn");

  // Controla visibilidade do botão ✕ de forma reativa
  if (clearBtn) {
    if (e.target.value.length > 0) {
      clearBtn.classList.remove("hidden");
    } else {
      clearBtn.classList.add("hidden");
    }
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    _executarBusca(term);
  }, 600);
});

/* 3.6.2. BOTÃO GATILHO DE RESET DA BUSCA COM APENAS UM CLIQUE (Item 2) */
async function limparBuscaRapida() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearSearchBtn");

  if (!input) return;

  // Limpa o valor físico do input e esconde o botão '✕' síncronamente
  input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");

  // Cancela qualquer timer de debounce que estivesse correndo em plano de fundo
  clearTimeout(debounceTimer);

  // Se a busca já estava vazia, não há necessidade de re-consultar o banco
  if (buscaAtiva === "") return;

  // 🛡️ DISJUNTOR SÍNCRONO: Neutraliza o sentinel enquanto o grid é esvaziado
  isSearching = true;

  // Destrava o estado tridimensional de foco do grid Masonry
  if (typeof resetarEstadoDosCards === "function") {
    resetarEstadoDosCards();
  }

  // Reseta completamente o estado global para a carga inicial
  buscaAtiva = "";
  cursor = 0;
  allToys = [];
  hasMais = true;

  // Dispara a carga para restaurar a grade de brinquedos original ('todos')
  await fetchBrinquedos(true);

  // Devolve o foco de tela de forma suave para o início da coleção
  const secaoColecao = document.getElementById("colecao");
  if (secaoColecao) {
    secaoColecao.scrollIntoView({ behavior: "smooth" });
  }
}

/* 3.7. ARCADE LOGIN E SISTEMA DE AVATARES */
const arcadeModal = document.getElementById("arcadeModal");
const arcadeScreen = document.getElementById("arcadeScreen");
const selectionScreen = document.getElementById("selectionScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const sf2CoinSound = new Audio("/sounds/street_fighter.mp3");

function login() {
  arcadeScreen.classList.remove("hidden");
  if (selectionScreen) selectionScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  arcadeModal.classList.remove("opacity-0", "pointer-events-none");
}

function closeModal() {
  arcadeScreen.classList.add("hidden");
  if (selectionScreen) selectionScreen.classList.add("hidden");
  gameOverScreen.classList.remove("hidden");
  setTimeout(
    () => arcadeModal.classList.add("opacity-0", "pointer-events-none"),
    1800,
  );
}

/* 3.7.2. MOTOR DE INSERÇÃO DE FICHA E LOGIN OAUTH (Item 1 — Correção Mobile Facebook) */
function handleCoinSelect(btn, provider) {
  sf2CoinSound.currentTime = 0;
  sf2CoinSound.play().catch(() => {});
  btn.classList.add("coin-inserted");

  const isMobile = window.innerWidth < 768;

  // Bloco C — Facebook no mobile: o setTimeout quebra a janela de confiança do
  // gesto do usuário e o browser bloqueia silenciosamente o redirect.
  // Solução: Facebook mobile dispara imediatamente (sem setTimeout), preservando
  // o vínculo direto com o gesto de clique exigido pelo Safari/Chrome mobile.
  // Google e X continuam no setTimeout (popup funciona neles).
  if (provider === "facebook" && isMobile) {
    supabaseClient.auth.signInWithOAuth({
      provider: "facebook",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        skipBrowserRedirect: true,
        queryParams: { display: "page" },
      },
    }).then(({ data, error }) => {
      if (error) {
        console.error("Erro Facebook mobile:", error);
        mostrarMensagemLED("ERRO NO SLOT FACEBOOK");
        btn.classList.remove("coin-inserted");
        return;
      }
      if (data?.url) window.location.href = data.url;
    });
    return; // sai da função — não entra no setTimeout abaixo
  }

  // Google, X e Facebook desktop: fluxo original com animação de 1.5s
  setTimeout(async () => {
    try {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          skipBrowserRedirect: isMobile,
        },
      });

      if (error) throw error;

      // Outros providers no mobile: redirect manual
      if (isMobile && data?.url) {
        window.location.href = data.url;
      }

    } catch (err) {
      console.error(`Erro na autenticação via moeda (${provider}):`, err);
      if (typeof mostrarMensagemLED === "function") {
        mostrarMensagemLED(`ERRO NO SLOT ${provider.toUpperCase()}`);
      }
      btn.classList.remove("coin-inserted");
    }
  }, 1500); // 1.5s preservado para a imersão da animação da ficha
}

function renderAvatarGrid() {
  const grid = document.getElementById("avatarGrid");
  grid.innerHTML = "";
  const selecionados = [
    ...getRandomFromRange(1, 80, 8),
    ...getRandomFromRange(81, 130, 5),
    ...getRandomFromRange(131, 150, 2),
  ];
  // Item 4 — idx diferencia os primeiros (eager) dos demais (lazy)
  selecionados.forEach((num, idx) => {
    // Item 4 — tenta WebP primeiro; onerror cai no PNG original sem quebrar nada
    const pathWebp = `/img/avatares/a${num.toString().padStart(2, "0")}.webp`;
    const pathPng = `/img/avatares/a${num.toString().padStart(2, "0")}.png`;
    // Os 3 primeiros ficam eager (aparecem imediatamente no modal);
    // os demais lazy para não bloquear o parser
    const loadStrategy = idx < 3 ? "eager" : "lazy";
    const item = document.createElement("div");
    item.className = "avatar-item rounded-md";
    item.innerHTML = `<img src="${pathWebp}" onerror="this.onerror=null;this.src='${pathPng}'" class="avatar-img" loading="${loadStrategy}" decoding="async" width="80" height="80" alt="Avatar ${num}">`;
    // Preserva o path PNG no localStorage para compatibilidade total
    item.onclick = () => {
      localStorage.setItem("retro_avatar", pathWebp);
      location.reload();
    };
    grid.appendChild(item);
  });
}

function getRandomFromRange(min, max, count) {
  const r = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return r.sort(() => Math.random() - 0.5).slice(0, count);
}

function updateNavWithAvatar(avatarPath, name) {
  // Usa o primeiro nome mas sem truncamento artificial por max-w fixo.
  // O CSS cuida do overflow apenas em telas muito pequenas.
  const firstName = name.split(" ")[0];

  document.getElementById("userArea").innerHTML = `
    <div class="flex items-center gap-1.5 md:gap-3 relative" id="avatarMenuWrapper">

      <!-- Nome + Player 1 -->
      <div class="flex flex-col items-end hidden sm:flex">
        <span class="text-[10px] md:text-xs text-cyan-400 font-orbitron uppercase tracking-widest leading-none">Player 1</span>
        <span class="text-[13px] md:text-base font-bold text-white uppercase tracking-tighter leading-tight max-w-[120px] md:max-w-[180px] truncate text-right">
          ${firstName}
        </span>
      </div>

      <!-- Avatar clicável que abre o dropdown -->
      <button
        id="avatarMenuBtn"
        onclick="toggleAvatarMenu(event)"
        class="w-[40px] h-[40px] md:w-11 md:h-11 rounded-full border-2 border-cyan-400 overflow-hidden bg-slate-900 shadow-[0_0_10px_rgba(34,211,238,0.4)] shrink-0 focus:outline-none hover:border-pink-500 transition-colors"
        aria-label="Menu do usuário"
      >
        <img src="${avatarPath}" 
          onerror="this.onerror=null;this.src=this.src.endsWith('.webp')?this.src.replace('.webp','.png'):this.src.replace('.png','.webp')" 
          class="w-full h-full object-contain" 
          alt="avatar">
      </button>

      <!-- Dropdown retrô -->
      <div
        id="avatarDropdown"
        class="hidden absolute top-[calc(100%+10px)] right-0 z-[200] min-w-[180px]
               bg-slate-900 border border-cyan-500/40 rounded-lg shadow-[0_0_20px_rgba(34,211,238,0.15)]
               overflow-hidden"
      >
        <!-- No mobile: cabeçalho visível. No desktop: o CSS 3D assume o controle via #avatarDropdown -->
        <div class="md:hidden px-4 py-2.5 border-b border-white/10 bg-black/30">
          <p class="font-orbitron text-[0.55rem] text-cyan-400/70 uppercase tracking-widest">Meu Quarto</p>
          <p class="font-bold text-white text-sm uppercase tracking-tight truncate">${firstName}</p>
        </div>

        <!-- Wrapper 3D: no desktop recebe a animação rotateY do CSS -->
        <div class="dropdown-3d-inner py-1">
          <button onclick="filtrarMeuQuarto('todos'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-slate-900 hover:bg-yellow-300 transition-colors flex items-center gap-2.5 whitespace-nowrap">
            <span class="text-base">🕹</span> Todos
          </button>
          <button onclick="filtrarMeuQuarto('tive'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-slate-900 hover:bg-yellow-300 transition-colors flex items-center gap-2.5 whitespace-nowrap">
            <span class="text-base">🏆</span> Fui Dono
          </button>
          <button onclick="filtrarMeuQuarto('queria'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-slate-900 hover:bg-yellow-300 transition-colors flex items-center gap-2.5 whitespace-nowrap">
            <span class="text-base">⭐</span> Queria Ter
          </button>
          <button onclick="filtrarMeuQuarto('curtidas'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-slate-900 hover:bg-yellow-300 transition-colors flex items-center gap-2.5 whitespace-nowrap">
            <span class="text-base">❤️</span> Favoritos
          </button>
          <button onclick="logOut()" class="dropdown-logout-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-pink-400 transition-colors flex items-center gap-2.5 whitespace-nowrap mt-1">
            <span class="text-base">⏏</span> Sair
          </button>
        </div>
      </div>
    </div>`;

  // A barra de filtros da nav fica oculta — os filtros agora vivem no dropdown
  document.getElementById("userFilters")?.classList.add("hidden");
}

/* Abre/fecha o dropdown do avatar */
function toggleAvatarMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById("avatarDropdown");
  if (!dropdown) return;
  dropdown.classList.toggle("hidden");
  // Item 6 — sincroniza .is-open no wrapper para pausar a animação neon via CSS
  const wrapper = document.getElementById("avatarMenuWrapper");
  if (wrapper)
    wrapper.classList.toggle("is-open", !dropdown.classList.contains("hidden"));
}

/* Fecha o dropdown ao clicar fora dele */
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("avatarMenuWrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById("avatarDropdown")?.classList.add("hidden");
    wrapper.classList.remove("is-open"); // Item 6 — remove is-open ao fechar por clique externo
  }
});

async function logOut() {
  await supabaseClient.auth.signOut();
  localStorage.removeItem("retro_avatar");
  localStorage.setItem("retro_led_boot", "logout");
  window.location.href = window.location.origin;
}

/* 3.8. GESTÃO DE DADOS (CURTIDAS E COLEÇÃO DO USUÁRIO) */

/* 3.8.1. Puxa perfil e preenche as Memórias Visuais (Sets) */
async function carregarInteracoesDoBanco(userId, tentativa = 1) {
  try {
    const [resCurtidas, resTive, resQueria] = await Promise.all([
      supabaseClient
        .from("curtidas")
        .select("brinquedo_id")
        .eq("usuario_id", userId),
      supabaseClient
        .from("interacoes_tive")
        .select("brinquedo_id")
        .eq("usuario_id", userId),
      supabaseClient
        .from("interacoes_queria")
        .select("brinquedo_id")
        .eq("usuario_id", userId),
    ]);

    // 🛡️ RETRY: Se qualquer query falhar e ainda temos tentativas, aguarda e tenta novamente.
    // Evita Sets vazios causados por cold start do Supabase ou token recém-renovado.
    const houveErro = resCurtidas.error || resTive.error || resQueria.error;
    if (houveErro && tentativa < 3) {
      console.warn(
        `carregarInteracoes: tentativa ${tentativa} falhou, retentando...`,
      );
      await new Promise((r) => setTimeout(r, 600 * tentativa));
      return carregarInteracoesDoBanco(userId, tentativa + 1);
    }

    if (resCurtidas.data)
      curtidasDoUsuario = new Set(
        resCurtidas.data.map((i) => String(i.brinquedo_id).padStart(4, "0")),
      );
    if (resTive.data)
      tiveDoUsuario = new Set(
        resTive.data.map((i) => String(i.brinquedo_id).padStart(4, "0")),
      );
    if (resQueria.data)
      queriaDoUsuario = new Set(
        resQueria.data.map((i) => String(i.brinquedo_id).padStart(4, "0")),
      );

    console.log(
      `✅ Interações carregadas — Tive: ${tiveDoUsuario.size} | Queria: ${queriaDoUsuario.size} | Curtidas: ${curtidasDoUsuario.size}`,
    );
  } catch (e) {
    console.error("Erro no carregamento de interações:", e);
  }
}

/* 3.8.2. Commits Otimistas (Altera local e envia pro banco) */
async function toggleCurtida(event, brinquedoId) {
  event.stopPropagation();
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) {
    dispararTilt("FAÇA LOGIN PARA CURTIR");
    return;
  }

  const userId = session.user.id;
  const idParaBanco = String(brinquedoId).padStart(4, "0");
  const isLiked = curtidasDoUsuario.has(idParaBanco);
  const btn = document.getElementById(`heart-btn-${idParaBanco}`);
  const countSpan = document.getElementById(`count-${idParaBanco}`);
  let count = parseInt(countSpan ? countSpan.innerText : "0") || 0;

  if (isLiked) {
    curtidasDoUsuario.delete(idParaBanco);
    if (btn) btn.classList.remove("liked");
    if (countSpan) countSpan.innerText = Math.max(0, count - 1);
    await supabaseClient
      .from("curtidas")
      .delete()
      .eq("usuario_id", userId)
      .eq("brinquedo_id", idParaBanco);
  } else {
    curtidasDoUsuario.add(idParaBanco);
    if (btn) {
      btn.classList.add("liked", "animating");
      setTimeout(() => btn.classList.remove("animating"), 600);
    }
    if (countSpan) countSpan.innerText = count + 1;
    await supabaseClient
      .from("curtidas")
      .insert([{ usuario_id: userId, brinquedo_id: idParaBanco }]);
  }
}

async function toggleInteracao(event, brinquedoId, tipo) {
  event.stopPropagation();
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    dispararTilt("FAÇA LOGIN PARA INTERAGIR");
    return;
  }

  const userId = session.user.id;
  const idParaBanco = String(brinquedoId).padStart(4, "0");

  // Variáveis para o alvo atual e para o seu "Oposto"
  let memorySet, tableName, activeClass;
  let oppSet, oppTable, oppClass, oppTipo;

  if (tipo === "tive") {
    memorySet = tiveDoUsuario;
    tableName = "interacoes_tive";
    activeClass = "active-tive";

    // Define o oposto
    oppSet = queriaDoUsuario;
    oppTable = "interacoes_queria";
    oppClass = "active-queria";
    oppTipo = "queria";
  } else {
    memorySet = queriaDoUsuario;
    tableName = "interacoes_queria";
    activeClass = "active-queria";

    // Define o oposto
    oppSet = tiveDoUsuario;
    oppTable = "interacoes_tive";
    oppClass = "active-tive";
    oppTipo = "tive";
  }

  const isAtivo = memorySet.has(idParaBanco);
  const btn = document.getElementById(`btn-${tipo}-${idParaBanco}`);
  const countSpan = document.getElementById(`count-${tipo}-${idParaBanco}`);
  let count = parseInt(countSpan ? countSpan.innerText : "0") || 0;

  if (isAtivo) {
    // Ação normal de REMOVER a própria marcação
    memorySet.delete(idParaBanco);
    if (btn) btn.classList.remove(activeClass);
    if (countSpan) countSpan.innerText = Math.max(0, count - 1);

    const { error } = await supabaseClient
      .from(tableName)
      .delete()
      .eq("usuario_id", userId)
      .eq("brinquedo_id", idParaBanco);

    if (error) {
      memorySet.add(idParaBanco);
      if (btn) btn.classList.add(activeClass);
      if (countSpan) countSpan.innerText = count;
    }
  } else {
    // 🔴 EXCLUSÃO MÚTUA: Se o oposto estiver marcado, remove ele primeiro!
    if (oppSet.has(idParaBanco)) {
      oppSet.delete(idParaBanco);
      const oppBtn = document.getElementById(`btn-${oppTipo}-${idParaBanco}`);
      const oppCountSpan = document.getElementById(
        `count-${oppTipo}-${idParaBanco}`,
      );
      let oppCount = parseInt(oppCountSpan ? oppCountSpan.innerText : "0") || 0;

      // UI Otimista: desmarca o botão oposto instantaneamente
      if (oppBtn) oppBtn.classList.remove(oppClass);
      if (oppCountSpan) oppCountSpan.innerText = Math.max(0, oppCount - 1);

      // Manda apagar do banco silenciosamente
      supabaseClient
        .from(oppTable)
        .delete()
        .eq("usuario_id", userId)
        .eq("brinquedo_id", idParaBanco)
        .then();
    }

    // Ação normal de ADICIONAR a marcação atual
    memorySet.add(idParaBanco);
    if (btn) btn.classList.add(activeClass);
    if (countSpan) countSpan.innerText = count + 1;

    const { error } = await supabaseClient
      .from(tableName)
      .insert([{ usuario_id: userId, brinquedo_id: idParaBanco }]);

    if (error) {
      memorySet.delete(idParaBanco);
      if (btn) btn.classList.remove(activeClass);
      if (countSpan) countSpan.innerText = count;
    }
  }
}

/* 3.8. FUNÇÃO DE FILTRO DO "MEU QUARTO" */
async function filtrarMeuQuarto(tipo) {
  // 1. Atualiza a variável global que o fetchBrinquedos usa
  filtroAtivo = tipo;

  // 2. Atualiza visualmente os botões
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  const btnAtivo = document.getElementById(`filter-${tipo}`);
  if (btnAtivo) btnAtivo.classList.add("active");

  // 🛡️ FIX BUSCA HERDADA: Limpa o termo de busca ao trocar de filtro.
  // Sem isso, um "bola" digitado em "Todos" seria herdado por "Fui Dono",
  // exibindo resultados de busca em vez da coleção pessoal.
  buscaAtiva = "";
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";

  // 🛡️ FIX 1.3: Limpa o estado de flip ANTES de reconstruir o grid.
  resetarEstadoDosCards();

  // 3. Reseta e recarrega o grid
  await fetchBrinquedos(true);
}

/* ============================================================
   SEÇÃO 3.9. PAINEL LED — ENGINE COMPLETA
   ============================================================ */

/* 3.9.1. ESTADO DO PAINEL */
let ledPainelAtivo = false; /*localStorage.getItem("led_painel") !== "off";*/
let ledFilaAtual = [];
let ledEmExibicao = false;
let ledTiltAtivo = false;
let ledGlitchSessao = false;
let ledEasterEggContador = 0;
let ledEasterEggTimer = null;

/* 3.9.2. CONTEÚDO FIXO — MENSAGENS FAKE (fallback) */
const LED_MENSAGENS_FAKE = [
  'JOGADOR_77 sobre He-Man Masters of Universe: "O melhor brinquedo da minha infância"',
  'CAROL_BH sobre Estrela Júpiter: "Ganhei de aniversário e nunca mais esqueci"',
  'MARCOS_SP sobre Robocop Estrela: "Tinha um e perdi na mudança, que saudade"',
  'NERD_RETRÔ sobre Tartarugas Ninja Glasslite: "Colecionei todos os personagens"',
  'ALINE_RJ sobre Boneca Susi Estrela: "Minha primeira Susi era loira"',
  'RETROGAMER sobre Super Nintendo: "Passei a infância inteira nesse videogame"',
  'PEDRO_MG sobre Hot Wheels Mattel: "Tinha uma pista enorme montada no quarto"',
  'TURMA_80s sobre Falcon Gulliver: "Meu pai jogava comigo todo fim de semana"',
  'CLASSICO_BR sobre Transformers Estrela: "Demorei anos para descobrir como transformar"',
  'RAINHA_90s sobre Polly Pocket: "Perdi todas as pecinhas pequenas"',
  'NINTENDISTA sobre Duck Hunt Nintendo: "Ficava pertinho da TV para não errar"',
  'PLAYER_DOS_8BITS sobre Atari 2600: "Meu primeiro videogame, nunca vou esquecer"',
  'NOSTALGIA_SP sobre Lego Fabuland: "Montei e desmontei centenas de vezes"',
  'RETROWAVE sobre Street Fighter Glasslite: "Hadouken! Aprendi esse golpe com 6 anos"',
  'FELIPPE_BH sobre Bandeirante: "O caminhão verde era o meu favorito"',
  'COLECIONADOR_RJ sobre Playmobil: "Ainda tenho alguns guardados na caixa original"',
  'GEEK_ANOS90 sobre Action Man Estrela: "Fiz uma corda de linha para ele descer"',
  'CRIANÇA_DE_80 sobre Scalextric: "A pista ficava no chão da sala o fim de semana inteiro"',
  'RETRÔ_GAMES sobre Nintendinho NES: "Soprava o cartucho e torcia para funcionar"',
  'MEMÓRIA_VIVA sobre Barbie Estrela: "Cortei o cabelo da minha e chorei depois"',
];

/* 3.9.3. FRASES DO SISTEMA */
const LED_FRASES_SISTEMA = [
  "PLEASE INSERT COIN",
  "VOLTAMOS EM BREVE...",
  "ISSO É TUDO PESSOAL!",
  "VOLTAMOS DEPOIS DOS RECLAMES DO PLIM-PLIM",
  "TILT !!!",
  "GAME OVER — CONTINUE?",
  "HIGH SCORE — SEU NOME AQUI",
  "PRESS START TO PLAY",
  "NÃO SE ESQUEÇA DE CURTIR SEUS BRINQUEDOS FAVORITOS",
  "COMPARTILHE SUAS MEMÓRIAS COM SEUS AMIGOS",
  "CLIQUE NO SWITCH PARA DESLIGAR ESSE PAINEL",
  "VOCÊ SE LEMBRA DESSE BRINQUEDO?",
  "REVIVA A MAGIA DA INFÂNCIA — RETROBRINQUEDOS BR",
];

/* 3.9.4. SPRITES ASCII PARA O PAINEL */
const LED_SPRITES = [
  " ᗧ · · · · · · ᗣ · · ᗣ · · ᗣ ", // Pac-Man comendo as pastilhas
  " ᗣ ᗣ ᗣ ᗣ · · · · · · · ᗤ ", // Pac-Man fugindo (Fantasma azul)
  " /M\\  \\o/  /M\\  \\o/       _A_ ", // Space Invaders (Nave atirando de baixo)
  " >===>  - - - - -  (O)  {X}  [||] ", // R-Type / Shmup (Nave atirando em inimigos)
  " |   ·             |      PONG      |             ·   | ", // Pong clássico
  " /\\   ·  ·  ·  *   O   o   . ", // Asteroids (Nave atirando nas pedras)
  " (>'-')>  ======O      <('-'<) ", // Street Fighter (Hadouken)
  " ~~~|===|~~~   [H]   ~~~|===|~~~ ", // River Raid (Helicóptero nas margens do rio)
];

/* 3.9.5. INICIALIZAÇÃO DO PAINEL */
function iniciarPainelLED(mensagemImediata) {
  const toggle = document.getElementById("ledToggleInput");
  if (toggle) toggle.checked = ledPainelAtivo;

  const painel = document.getElementById("ledPanel");
  if (!painel) return;

  if (ledPainelAtivo) {
    painel.classList.remove("is-off");
    animarLigar();

    // Exibe mensagem local imediata (zero latência) enquanto o fetch
    // do banco aquece — elimina o painel vazio nos cold starts.
    if (mensagemImediata) {
      const el = document.getElementById("ledContent");
      if (el) {
        el.classList.remove("tilt-mode");
        el.textContent = mensagemImediata;
        const duracao = Math.max(10, (mensagemImediata.length * 10 + window.innerWidth) / 80);
        el.style.animation = "none";
        el.offsetHeight; // reflow forçado
        el.style.animation = `ledScroll ${duracao}s linear 1`;
        el.addEventListener("animationend", () => iniciarCicloLED(), { once: true });
      }
    } else {
      setTimeout(() => iniciarCicloLED(), 800);
    }
  } else {
    painel.classList.add("is-off");
  }

  // Easter egg: 13 cliques no "R"
  const easterBtn = document.getElementById("easterEggBtn");
  if (easterBtn) {
    easterBtn.addEventListener("click", () => {
      ledEasterEggContador++;
      clearTimeout(ledEasterEggTimer);
      ledEasterEggTimer = setTimeout(() => {
        ledEasterEggContador = 0;
      }, 3000);
      if (ledEasterEggContador >= 13) {
        ledEasterEggContador = 0;
        dispararGlitch(6000);
      }
    });
  }

  // Glitch aleatório por sessão (15% de chance)
  if (Math.random() < 0.15) {
    ledGlitchSessao = true;
    const delay = 15000 + Math.random() * 40000;
    setTimeout(() => dispararGlitch(4000), delay);
  }
}

/* 3.9.6. TOGGLE ON/OFF DO PAINEL */
function toggleLedPanel(ligado) {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  ledPainelAtivo = ligado;
  localStorage.setItem("led_painel", ligado ? "on" : "off");

  if (ligado) {
    painel.classList.remove("is-off");
    animarLigar();
    setTimeout(() => iniciarCicloLED(), 800);
  } else {
    animarDesligar(() => painel.classList.add("is-off"));
  }
}

/* 3.9.7. ANIMAÇÕES DE LIGAR / DESLIGAR */
function animarLigar() {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  painel.classList.remove("powering-off");
  painel.classList.add("powering-on");
  setTimeout(() => painel.classList.remove("powering-on"), 500);
}

function animarDesligar(callback) {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  painel.classList.add("powering-off");
  setTimeout(() => {
    painel.classList.remove("powering-off");
    if (callback) callback();
  }, 500);
}

/* 3.9.8. ENGINE DA FILA DE MENSAGENS */
async function montarFila() {
  // Busca últimas mensagens reais do banco
  let mensagensReais = [];
  try {
    const { data, error } = await supabaseClient
      .from("feed_live")
      .select("usuario_nome, acao, brinquedo_nome, detalhe")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) {
      mensagensReais = data.map(
        (m) =>
          `${m.usuario_nome.toUpperCase()} sobre ${m.brinquedo_nome}${m.detalhe ? ': "' + m.detalhe + '"' : ""}`,
      );
    }
  } catch (e) {
    /* silencioso */
  }

  // Mescla reais + fake, prioriza reais
  const pool =
    mensagensReais.length >= 5
      ? mensagensReais
      : [...mensagensReais, ...LED_MENSAGENS_FAKE].slice(0, 20);

  // Escolhe quantidade randômica (10 a 20)
  const qtd = 10 + Math.floor(Math.random() * 11);
  const embaralhado = [...pool].sort(() => Math.random() - 0.5).slice(0, qtd);

  // Monta fila: mensagens + separador + frase/sprite
  const fila = [
    ...embaralhado,
    "   . . .   ",
    Math.random() < 0.4
      ? LED_SPRITES[Math.floor(Math.random() * LED_SPRITES.length)]
      : LED_FRASES_SISTEMA[
          Math.floor(Math.random() * LED_FRASES_SISTEMA.length)
        ],
  ];

  return fila;
}

/* 3.9.9. CICLO PRINCIPAL DE EXIBIÇÃO */
async function iniciarCicloLED() {
  if (!ledPainelAtivo || ledTiltAtivo) return;
  ledFilaAtual = await montarFila();
  exibirProximaMensagem();
}

function exibirProximaMensagem() {
  if (!ledPainelAtivo || ledTiltAtivo || ledFilaAtual.length === 0) {
    if (!ledTiltAtivo) iniciarCicloLED();
    return;
  }
  exibirFilaComoTicker(ledFilaAtual, () => {
    ledFilaAtual = [];
    setTimeout(() => iniciarCicloLED(), 1500);
  });
}

function exibirFilaComoTicker(fila, onComplete) {
  const el = document.getElementById("ledContent");
  if (!el) return;

  const SEP =
    "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0✦\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0";
  const textoCompleto = fila.join(SEP);

  el.classList.remove("tilt-mode");
  el.textContent = textoCompleto;

  const velocidade = 80; // px/s
  const larguraEstimada = textoCompleto.length * 10;
  const duracao = Math.max(
    10,
    (larguraEstimada + window.innerWidth) / velocidade,
  );

  el.style.animation = "none";
  el.offsetHeight; // reflow forçado
  el.style.animation = `ledScroll ${duracao}s linear 1`;

  const handler = () => {
    el.removeEventListener("animationend", handler);
    onComplete();
  };
  el.addEventListener("animationend", handler);
}

/* 3.9.10. MENSAGEM PRIORITÁRIA (TILT — GERAL) */
function dispararTilt(mensagem) {
  const estavaDesligado = !ledPainelAtivo;
  ledTiltAtivo = true;

  const el = document.getElementById("ledContent");
  const painel = document.getElementById("ledPanel");
  if (!el || !painel) return;

  if (estavaDesligado) {
    painel.classList.remove("is-off");
    animarLigar();
  }

  el.style.animation = "none";
  el.offsetHeight; // reflow

  el.textContent = `⚡ ${mensagem} ⚡${mensagem} ⚡${mensagem} ⚡`;
  el.classList.add("tilt-mode");
  painel.style.borderColor = "rgba(255,32,32,0.5)";
  painel.style.boxShadow =
    "0 0 16px rgba(255,32,32,0.2) inset, 0 2px 8px rgba(0,0,0,0.4)";

  let ciclo = 0;
  const totalCiclos = 3;
  const intervalo = 700;

  const piscar = setInterval(() => {
    el.style.opacity = el.style.opacity === "0" ? "1" : "0";
    ciclo++;
    if (ciclo >= totalCiclos * 2) {
      clearInterval(piscar);
      el.style.opacity = "1";
      ledTiltAtivo = false;

      painel.style.borderColor = "";
      painel.style.boxShadow = "";

      if (estavaDesligado) {
        // Mantém vermelho enquanto faz o fade off, só limpa no callback
        animarDesligar(() => {
          painel.classList.add("is-off");
          el.classList.remove("tilt-mode");
          el.textContent = "";
        });
      } else {
        // Apaga o texto temporariamente enquanto o Supabase carrega o próximo Ticker
        el.classList.remove("tilt-mode");
        el.textContent = "";
        iniciarCicloLED();
      }
    }
  }, intervalo);
}

/* 3.9.11. EFEITO GLITCH */
function dispararGlitch(duracao = 4000) {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  painel.classList.add("glitch-line");
  setTimeout(() => painel.classList.remove("glitch-line"), duracao);
}

/* 3.9.12. INJEÇÃO DE MENSAGEM PRIORITÁRIA (fura a fila) */
function ledInjetarPrioritario(texto) {
  ledFilaAtual.unshift(texto);
}

/* 3.9.13. REALTIME — RECEBE NOVAS MENSAGENS DO BANCO */
const feedChannel = supabaseClient.channel("museu-feed");
feedChannel
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "feed_live" },
    (payload) => {
      const m = payload.new;
      const txt = `${m.usuario_nome.toUpperCase()} ${m.acao} ${m.brinquedo_nome}${m.detalhe ? ' — "' + m.detalhe + '"' : ""}`;
      ledInjetarPrioritario(txt);
    },
  )
  .subscribe();

/* ============================================================
   SISTEMA DE FILTRO E MODERAÇÃO (ANTI-TOXICIDADE)
   ============================================================ */
const palavrasProibidas = [
  "lula",
  "bolsonaro",
  "bolsominion",
  "lule",
  "bozo",
  "fascista",
  "genocida",
  "mito",
  "comunista",
  "caralho",
  "porra",
  "puta",
  "buceta",
  "pica",
  "merda",
  "foder",
  "fode",
  "cu",
  "fdp",
  "cuzão",
  "desgraça",
  "desgrama",
  "penis",
  "pênis",
  "vagina",
  "xoxota",
  "xereca",
  "bosta",
  "arrombado",
  "cacete",
  "anus",
  "ânus",
];

// O \b garante que vai buscar a palavra exata (evita bloquear "curso" por causa de "cu")
const regexProibidas = new RegExp(
  `\\b(${palavrasProibidas.join("|")})\\b`,
  "i",
);

function contemPalavraProibida(texto) {
  return regexProibidas.test(texto);
}

/* TILT Vermelho Prolongado para Alerta / Banimento */
function dispararTiltBanimento(mensagem, tempoCongelado = 4000) {
  const estavaDesligado = !ledPainelAtivo;
  ledTiltAtivo = true;

  const el = document.getElementById("ledContent");
  const painel = document.getElementById("ledPanel");
  if (!el || !painel) return;

  if (estavaDesligado) {
    painel.classList.remove("is-off");
    animarLigar();
  }

  el.style.animation = "none";
  el.offsetHeight; // reflow

  el.textContent = `🚨 ${mensagem} 🚨`;
  el.classList.add("tilt-mode");
  painel.style.borderColor = "rgba(255,32,32,0.8)";
  painel.style.boxShadow =
    "0 0 16px rgba(255,32,32,0.5) inset, 0 2px 8px rgba(0,0,0,0.6)";

  el.style.opacity = "1";

  let ciclo = 0;
  const totalCiclos = 2;
  const intervalo = 1200;

  const piscar = setInterval(() => {
    el.style.opacity = el.style.opacity === "0" ? "1" : "0";
    ciclo++;
    if (ciclo >= totalCiclos * 2) {
      clearInterval(piscar);
      el.style.opacity = "1";

      setTimeout(() => {
        ledTiltAtivo = false;
        painel.style.borderColor = "";
        painel.style.boxShadow = "";

        if (estavaDesligado) {
          animarDesligar(() => {
            painel.classList.add("is-off");
            el.classList.remove("tilt-mode");
            el.textContent = "";
          });
        } else {
          el.classList.remove("tilt-mode");
          el.textContent = "";
          iniciarCicloLED();
        }
      }, tempoCongelado);
    }
  }, intervalo);
}

/* 3.9.14. ENVIO DE COMENTÁRIO DO CARD */
async function enviarComentario(idNormalizado, nomeBrinquedo) {
  if (!isUserLogged) {
    dispararTilt("FAÇA LOGIN PARA COMENTAR");
    return;
  }
  const input = document.getElementById(`comentario-input-${idNormalizado}`);
  const texto = input ? input.value.trim().substring(0, 140) : "";
  if (!texto) return;

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) return;

  const userId = session.user.id;
  const userName = session.user.user_metadata.full_name || "Player 1";

  // 🔴 FILTRO ANTI-TOXICIDADE: Sistema de 3 Vidas
  if (contemPalavraProibida(texto)) {
    input.value = "";

    const strikeKey = `retro_strikes_${userId}`;
    let strikes = parseInt(localStorage.getItem(strikeKey) || "0");
    strikes++;
    localStorage.setItem(strikeKey, strikes);

    if (strikes >= 3) {
      dispararTiltBanimento(
        "ÚLTIMO AVISO IGNORADO — SUA CONTA FOI BANIDA",
        4000,
      );
      await supabaseClient.from("lista_negra").insert([
        {
          usuario_id: userId,
          motivo: "Uso de palavras proibidas (3 infrações)",
        },
      ]);
      localStorage.removeItem(strikeKey);
      setTimeout(() => {
        logOut();
      }, 5500);
    } else {
      let chances = 3 - strikes;
      dispararTiltBanimento(
        `PALAVRA IMPRÓPRIA — VOCÊ TEM MAIS ${chances} CHANCE(S) ANTES DO BANIMENTO`,
        4000,
      );
    }
    return;
  }

  // ✅ GUARDA O PLACEHOLDER ORIGINAL E LIMPA O INPUT
  const placeholderOriginal = input.placeholder;
  input.value = "";

  const { error } = await supabaseClient.from("feed_live").insert([
    {
      usuario_nome: userName,
      acao: "transmitiu mensagem em",
      brinquedo_nome: nomeBrinquedo,
      detalhe: texto,
    },
  ]);

  if (error) {
    console.error("Erro no envio:", error);
    input.value = texto; // Devolve o texto caso a rede falhe
  } else {
    // 🎉 FEEDBACK VISUAL DE SUCESSO
    input.placeholder = "Enviada! ✉️";

    // Devolve o placeholder original ao normal após 2.5 segundos
    setTimeout(() => {
      if (input) input.placeholder = placeholderOriginal;
    }, 2500);
  }
}

function handleComentarioEnter(event, idNormalizado, nomeBrinquedo) {
  if (event.key === "Enter") {
    event.preventDefault();
    enviarComentario(idNormalizado, nomeBrinquedo);
  }
}
/* ============================================================
   SEÇÃO 3.10. INICIALIZAÇÃO DA APLICAÇÃO (BOOT)
   ============================================================ */

/* 3.10.1. Adapta o layout para mudanças de tela limpas */
let ultimaLarguraTela = window.innerWidth; // Salva a largura inicial
let resizeTimer;

window.addEventListener("resize", () => {
  const larguraAtual = window.innerWidth;

  // 🛡️ TRAVA ANTI-TECLADO: Se a largura não mudou (apenas a altura mudou), aborta!
  if (larguraAtual === ultimaLarguraTela) {
    return;
  }

  // Atualiza a memória com a nova largura
  ultimaLarguraTela = larguraAtual;

  // Lógica original: Reseta os cards e redesenha a grade se a tela de fato mudou de largura
  resetarEstadoDosCards();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // ✅ Usa render() com allToys deduplicated — allToys já é a fonte de verdade
    // após fetchBrinquedos filtrar por idsEmMemoria. Passamos false para forçar
    // reconstrução das colunas com o novo número de colunas.
    if (allToys && allToys.length > 0) {
      const unique = [
        ...new Map(
          allToys.map((t) => [String(t.id).padStart(4, "0"), t]),
        ).values(),
      ];
      render(unique, false);
    }
  }, 250);
});

/* 3.10.2. Chama Auth, recupera tokens e desenha primeira página */
/* 3.10.2. Chama Auth, recupera tokens e desenha primeira página */
async function init() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  let _nomeUsuarioBoot = ""; // içado para o escopo do init — usado na mensagem LED

  if (session) {
    // 🔴 CHECAGEM DE BANIMENTO NO BOOT
    const { data: banData } = await supabaseClient
      .from("lista_negra")
      .select("id")
      .eq("usuario_id", session.user.id)
      .limit(1);

    if (banData && banData.length > 0) {
      // O usuário está na lista negra! Desloga e avisa.
      await supabaseClient.auth.signOut();
      localStorage.removeItem("retro_avatar");
      isUserLogged = false;
      document.body.classList.add("app-unlogged");

      // Dispara o alerta após 1 segundo para a tela já ter carregado
      setTimeout(() => {
        dispararTiltBanimento(
          "ACESSO NEGADO — CONTA BANIDA POR VIOLAÇÃO DE TERMOS",
        );
      }, 1000);
    } else {
      // ✅ Tudo certo, fluxo de login normal
      isUserLogged = true;
      document.body.classList.remove("app-unlogged");
      const userName = session.user.user_metadata.full_name || "Player 1";
      _nomeUsuarioBoot = userName.split(" ")[0]; // primeiro nome para o LED

      // 🛡️ AWAIT GARANTIDO: Os Sets de interações DEVEM estar populados
      // antes de fetchBrinquedos(true) ser chamado, caso contrário os filtros
      // "Meu Quarto" encontram Sets vazios e não exibem nenhum card.
      await carregarInteracoesDoBanco(session.user.id);

      const savedAvatar = localStorage.getItem("retro_avatar");
      if (savedAvatar) {
        updateNavWithAvatar(savedAvatar, userName);
      } else {
        login();
        arcadeScreen.classList.add("hidden");
        selectionScreen.classList.remove("hidden");
        renderAvatarGrid();
      }
    }
  }

  // 🔤 Pré-carrega a fonte do painel LED durante o boot (painel ainda oculto),
  // eliminando o delay de 3–4s no primeiro acionamento do toggle.
  new FontFace("LEDDisplay", "url(/fonts/advanced_led_board-7.ttf)")
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => {}); // silencioso — fallback Courier New se o arquivo estiver ausente

  // 🛡️ setupObserver() antes do fetch para que o IntersectionObserver
  // já esteja ativo quando os cards forem inseridos no DOM.
  setupObserver();
  await fetchBrinquedos(true);
  ajustarPainelLED();

  // 🎬 Detecta o contexto de boot para exibir mensagem imediata no LED
  // (elimina painel vazio durante cold start do Supabase)
  const bootFlag = localStorage.getItem("retro_led_boot");
  localStorage.removeItem("retro_led_boot"); // consome a flag — uso único

  let mensagemBoot;
  if (bootFlag === "logout") {
    mensagemBoot = "Até logo — Volte sempre para reviver a magia da infância ✦ RetroBrinquedos BR";
  } else if (isUserLogged) {
    const saudacao = _nomeUsuarioBoot ? "Bem-vindo de volta, " + _nomeUsuarioBoot + "!" : "Bem-vindo de volta!";
    mensagemBoot = saudacao + " ✦ Curta as cartas, marque seus brinquedos e deixe um comentário";
  } else {
    mensagemBoot = "Bem-vindo ao RetroBrinquedos BR — O museu dos brinquedos inesquecíveis ✦ Clique em qualquer carta para revelar a ficha Super Trunfo";
  }

  iniciarPainelLED(mensagemBoot);
}

function ajustarPainelLED() {
  const nav = document.querySelector("nav");
  const painel = document.getElementById("ledPanel");
  if (!nav || !painel) return;
  const alturaNav = nav.getBoundingClientRect().height;
  painel.style.top = alturaNav + "px";

  const hero = document.querySelector(".hero-section");
  const ledHeight =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--led-height",
      ),
    ) || 42;
  if (hero) hero.style.paddingTop = alturaNav + ledHeight + "px";
}

// Recalcula se a navbar mudar de tamanho (ex: wrap no mobile)
window.addEventListener("resize", ajustarPainelLED);

// ============================================================
// H4 — MODAL DISCLAIMER / DIREITOS AUTORAIS
// ============================================================
function abrirDisclaimerModal() {
  const modal = document.getElementById("disclaimerModal");
  if (modal) modal.classList.remove("hidden");
}
function fecharDisclaimerModal() {
  const modal = document.getElementById("disclaimerModal");
  if (modal) modal.classList.add("hidden");
}

// ============================================================
// H5 — MODAIS DE FABRICANTES
// ============================================================
function abrirFabricanteModal(num) {
  fecharFabricanteModal();
  const modal = document.getElementById("fabricanteModal" + num);
  if (modal) modal.classList.remove("hidden");
}
function fecharFabricanteModal() {
  for (let i = 1; i <= 8; i++) {
    const m = document.getElementById("fabricanteModal" + i);
    if (m) m.classList.add("hidden");
  }
}


// ============================================================
// Item 11 — FORMULÁRIO ARCADE DE SUGESTÃO DE BRINQUEDO
// EmailJS: service_v7nw2eu / template_o5kwy8p / public key: 03eueUb3Hz_PxWXj2
// ============================================================

// Inicializa EmailJS uma única vez após o DOM carregar
window.addEventListener("load", () => {
  if (typeof emailjs !== "undefined") {
    emailjs.init("03eueUb3Hz_PxWXj2");
  }
});

async function abrirSugestaoModal(termoPreenchido = "") {
  // Verifica sessão ativa via Supabase (padrão do projeto — não há currentUser global)
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userLogado = sessionData?.session?.user;

  if (!userLogado) {
    // Visitante deslogado — feedback no painel LED, consistente com o fluxo de comentários
    dispararTiltBanimento("⚠ FAÇA LOGIN PARA SUGERIR UM ITEM", 3000);
    return;
  }

  const modal = document.getElementById("sugestaoModal");
  if (!modal) return;

  // Pré-preenche o nome com o termo buscado (remove espaços extras do RPC)
  const inputNome = document.getElementById("sug_nome");
  if (inputNome && termoPreenchido) {
    inputNome.value = termoPreenchido.trim();
  }

  _sugestaoResetUI();
  modal.classList.remove("hidden");
  if (inputNome) setTimeout(() => inputNome.focus(), 80);
}

function fecharSugestaoModal() {
  const modal = document.getElementById("sugestaoModal");
  if (modal) modal.classList.add("hidden");
  _sugestaoResetUI();
}

function _sugestaoResetUI() {
  const feedback = document.getElementById("sugestaoFeedback");
  if (feedback) {
    feedback.textContent = "";
    feedback.className = "hidden sugestao-feedback mb-4";
  }
  const btn   = document.getElementById("sugestaoEnviarBtn");
  const label = document.getElementById("sugestaoEnviarLabel");
  if (btn)   btn.disabled = false;
  if (label) label.textContent = "▶ ENVIAR SUGESTÃO";
}

async function enviarSugestao() {
  // Revalida sessão no momento do envio
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userLogado = sessionData?.session?.user;
  if (!userLogado) {
    fecharSugestaoModal();
    dispararTiltBanimento("⚠ SESSÃO EXPIRADA. FAÇA LOGIN NOVAMENTE.", 3000);
    return;
  }

  const nome       = (document.getElementById("sug_nome")?.value       || "").trim();
  const fabricante = (document.getElementById("sug_fabricante")?.value || "").trim();
  const ano        = (document.getElementById("sug_ano")?.value        || "").trim();
  const categoria  = (document.getElementById("sug_categoria")?.value  || "").trim();
  const tema       = (document.getElementById("sug_tema")?.value       || "").trim();
  const link       = (document.getElementById("sug_link")?.value       || "").trim();
  const obs        = (document.getElementById("sug_obs")?.value        || "").trim();

  const btn   = document.getElementById("sugestaoEnviarBtn");
  const label = document.getElementById("sugestaoEnviarLabel");

  // Validação: nome obrigatório
  if (!nome) {
    _sugestaoMostrarFeedback("⚠ O nome do brinquedo é obrigatório.", "erro");
    document.getElementById("sug_nome")?.focus();
    return;
  }

  // Filtro anti-toxicidade — reutiliza contemPalavraProibida() já existente
  const camposTexto = [nome, fabricante, categoria, tema, obs];
  for (const campo of camposTexto) {
    if (campo && contemPalavraProibida(campo)) {
      fecharSugestaoModal();
      dispararTiltBanimento("⚠ CONTEÚDO INAPROPRIADO DETECTADO", 4000);
      return;
    }
  }

  btn.disabled = true;
  label.textContent = "⏳ ENVIANDO...";

  const usuarioNome = userLogado.user_metadata?.full_name || userLogado.email || "Usuário";

  try {
    // 1. Persistir no Supabase (tabela sugestoes)
    const { error: dbError } = await supabaseClient
      .from("sugestoes")
      .insert({
        usuario_id:      userLogado.id,
        usuario_nome:    usuarioNome,
        nome_brinquedo:  nome,
        fabricante:      fabricante || null,
        ano:             ano        || null,
        categoria:       categoria  || null,
        tema:            tema       || null,
        link_referencia: link       || null,
        observacao:      obs        || null,
        status:          "pendente",
      });

    if (dbError) throw dbError;

    // 2. Disparar e-mail via EmailJS
    await emailjs.send("service_v7nw2eu", "template_o5kwy8p", {
      usuario_nome:    usuarioNome,
      nome_brinquedo:  nome,
      fabricante:      fabricante  || "—",
      ano:             ano         || "—",
      categoria:       categoria   || "—",
      tema:            tema        || "—",
      link_referencia: link        || "—",
      observacao:      obs         || "—",
    });

    _sugestaoMostrarFeedback(
      "✔ SUGESTÃO ENVIADA! Obrigado, " + usuarioNome.split(" ")[0] + "!",
      "sucesso"
    );
    label.textContent = "✔ ENVIADO";

    // Limpa campos após sucesso
    ["sug_nome","sug_fabricante","sug_ano","sug_categoria","sug_tema","sug_link","sug_obs"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });

    setTimeout(() => {
      fecharSugestaoModal();
      // H1 — limpa busca e recarrega grid após envio bem-sucedido
      const searchInput = document.getElementById("searchInput");
      const clearBtn    = document.getElementById("clearSearchBtn");
      if (searchInput) {
        searchInput.value = "";
        buscaAtiva = "";
        if (clearBtn) clearBtn.classList.add("hidden");
      }
      fetchBrinquedos(true);
    }, 2800);

  } catch (err) {
    console.error("Erro ao enviar sugestão:", err);
    _sugestaoMostrarFeedback("✖ ERRO AO ENVIAR. Tente novamente.", "erro");
    btn.disabled = false;
    label.textContent = "▶ ENVIAR SUGESTÃO";
  }
}

function _sugestaoMostrarFeedback(mensagem, tipo) {
  const feedback = document.getElementById("sugestaoFeedback");
  if (!feedback) return;
  feedback.textContent = mensagem;
  feedback.className = `sugestao-feedback mb-4 ${tipo === "sucesso" ? "sugestao-feedback--ok" : "sugestao-feedback--erro"}`;
  feedback.classList.remove("hidden");
}

// Escape fecha todos os modais do site
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    fecharSugestaoModal();
    fecharDisclaimerModal();
    fecharFabricanteModal();
  }
});


init();

// C2 — remove hint dos logos após animação
setTimeout(() => {
  const firstLogo = document.querySelector(".hero-brand-btn:first-child");
  if (firstLogo) firstLogo.classList.add("hint-done");
}, 6200);
