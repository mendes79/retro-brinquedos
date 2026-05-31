/* ============================================================
   RetroBrinquedos BR — Catálogo Nostálgico de Brinquedos
   Arquivo    : app.js
   Versão     : 2.0
   Atualizado : 28/05/2026

   Descrição:
   Lógica completa da SPA (Single Page Application). Gerencia:
   autenticação social (Google/Facebook via Supabase), catálogo
   masonry com scroll infinito, interações do usuário (curtidas,
   EU TIVE, QUERIA TER, comentários), busca com debounce e
   AbortController, painel LED ticker com realtime Supabase,
   ranking/pódio, modais estáticos, History API para o botão
   Voltar mobile e easter eggs.

   Histórico de versões:
   v2.0 (28/05/2026) — Reorganização em blocos e documentação
============================================================ */

// ================================================================
// 1. CONFIGURAÇÃO E ESTADO GLOBAL
// ================================================================

// 1.1 — Conexão com o Supabase — chave anon (pública, segura para o frontend)
const urlDB = "https://gsiyknrzjwhdaqhfzimc.supabase.co";
const chaveDB =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzaXlrbnJ6andoZGFxaGZ6aW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTYxNTUsImV4cCI6MjA5MjQ3MjE1NX0.hRr5Ku3JILqFTvaz94Xryr8U5ZZ0brqJ1MCoXXaFxDM";
const supabaseClient = window.supabase.createClient(urlDB, chaveDB);

/* 3.2. ESTADO GLOBAL DA APLICAÇÃO (Variáveis em Memória) */

// 1.2 — Variáveis de estado global — lidas e modificadas ao longo de toda a SPA
let allToys = [];
let cursor = 0;
const LIMITE = 24;
let isLoading = false;
let hasMais = true;
let sessionSeed = Math.random(); //Mudado para 'let' para permitir que o Loop Infinito resete o sorteio global do banco
let isUserLogged = false;
let curtidasDoUsuario = new Set();
let tiveDoUsuario = new Set();
let queriaDoUsuario = new Set();
let currentCols = 0;
let columnElements = [];
let filtroAtivo = "todos"; // 'todos', 'tive', 'queria', 'curtidas'
let isSearching = false; // 🛡️ DISJUNTOR FIX 6.5: Trava o scroll infinito automático durante o reset da busca

// 🌐 FLAGS DE CONTROLE DE HISTÓRICO (HISTORY API - BOTÃO VOLTAR MOBILE)
let retroSincronizandoHistorico = false;

// 1.3 — Sentinel — div invisível ao fim de <main>, observada pelo IntersectionObserver para scroll infinito
const sentinel = document.createElement("div");
sentinel.id = "scrollSentinel";
sentinel.className =
  "w-full h-10 col-span-full mt-4 opacity-0 pointer-events-none";

/* 🎧 ESCUTADOR DO BOTÃO VOLTAR FÍSICO/GESTUAL MÓVEL (HISTORY API) */

// ================================================================
// 2. BOOT E INICIALIZAÇÃO
// ================================================================

// 2.1 — verificarSentinela — verifica se o sentinel ainda está visível após um fetch
// e dispara novo lote se necessário (cobre o gap do desktop com 6 colunas)
function verificarSentinela() {
  if (!hasMais || isSearching) return;
  requestAnimationFrame(() => {
    const rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 1200 && !isLoading && !isSearching) {
      fetchBrinquedos();
    }
  });
}

/* 3.11.1. Monta o vigia de scroll dinâmico (único ponto de disparo) */

// 2.2 — setupObserver — cria o IntersectionObserver (rootMargin 1200px) que monitora o sentinel
// e aciona fetchBrinquedos() ao aproximar-se do fim do catálogo
function setupObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !isLoading && hasMais && !isSearching) {
        fetchBrinquedos();
      }
    },
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

// 2.3 — ajustarPainelLED — posiciona o painel LED exatamente abaixo da navbar e ajusta o padding-top da hero section para não ficar oculto
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

// 2.4 — Listener de resize para o LED — reposiciona o painel ao redimensionar a janela
window.addEventListener("resize", ajustarPainelLED);

// 2.5 — Resize inteligente do grid masonry — redistribui os cards entre as novas colunas sem recarregar imagens quando o número de colunas muda
let ultimaLarguraTela = window.innerWidth;
let resizeTimer;

window.addEventListener("resize", () => {
  const larguraAtual = window.innerWidth;

  // Se a largura física real não mudou (ignora bugs de scroll em navegadores móveis), sai de cena
  if (larguraAtual === ultimaLarguraTela) {
    return;
  }
  ultimaLarguraTela = larguraAtual;

  // Desliga o foco dos cards para evitar quebras visuais de flip ativo
  resetarEstadoDosCards();
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    const grid = document.getElementById("toyGrid");
    const targetCols = getColumnCount();

    // 🛡️ DISJUNTOR CRÍTICO: Se o número ideal de colunas não mudou, não há motivo para mexer no DOM
    if (!grid || currentCols === targetCols) return;

    console.log(
      `%c 📱 [RESIZE INTELIGENTE] Movendo colunas de ${currentCols} para ${targetCols} sem reconstruir o DOM!`,
      "color: #eab308; font-weight: bold;",
    );

    // 1. Captura e isola todos os cartões físicos que já estão renderizados e vivos na tela
    const cardsVivos = Array.from(grid.querySelectorAll(".masonry-item"));

    if (cardsVivos.length === 0) return;

    // 2. Limpa o esqueleto do grid de colunas antigo e prepara os novos contêineres de colunas
    grid.innerHTML = "";
    columnElements = [];
    currentCols = targetCols;

    for (let i = 0; i < currentCols; i++) {
      const colDiv = document.createElement("div");
      colDiv.className = "masonry-column";
      grid.appendChild(colDiv);
      columnElements.push(colDiv);
    }

    // 3. Distribui os mesmos nós do DOM existentes entre as novas colunas com performance instantânea
    // O appendChild preserva as instâncias, o cache das imagens e evita o reflow pesado do innerHTML!
    cardsVivos.forEach((card) => {
      const shortest = columnElements.reduce((min, col) =>
        col.offsetHeight < min.offsetHeight ? col : min,
      );
      shortest.appendChild(card);
    });

    console.log(
      "%c 📱 [RESIZE] Grid reorganizado com sucesso em milissegundos!",
      "color: #22c55e;",
    );
  }, 250);
});

// 2.6 — Inicialização do SDK EmailJS — executada uma única vez ao carregar a página
window.addEventListener("load", () => {
  if (typeof emailjs !== "undefined") {
    emailjs.init("03eueUb3Hz_PxWXj2");
  }
});

// 2.7 — init — função principal de boot. Verifica sessão e banimento, carrega interações, configura o observer,
// busca o catálogo e o ranking em paralelo e inicia o painel LED com mensagem contextual
async function init() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  let _nomeUsuarioBoot = "";

  if (session) {
    const { data: banData } = await supabaseClient
      .from("lista_negra")
      .select("id")
      .eq("usuario_id", session.user.id)
      .limit(1);

    if (banData && banData.length > 0) {
      await supabaseClient.auth.signOut();
      localStorage.removeItem("retro_avatar");
      isUserLogged = false;
      document.body.classList.add("app-unlogged");

      setTimeout(() => {
        dispararTiltBanimento(
          "ACESSO NEGADO — CONTA BANIDA POR VIOLAÇÃO DE TERMOS",
        );
      }, 1000);
    } else {
      isUserLogged = true;
      document.body.classList.remove("app-unlogged");
      const userName = session.user.user_metadata.full_name || "Player 1";
      _nomeUsuarioBoot = userName.split(" ")[0];

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

  new FontFace("LEDDisplay", "url(/fonts/advanced_led_board-7.ttf)")
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => {});

  setupObserver();

  // 🚀 PIPELINE DE BOOT PARALELO: Dispara o carregamento do catálogo principal
  // e o ranking estático unificado RPC simultaneamente para máxima performance.
  ajustarPainelLED();

  await Promise.all([fetchBrinquedos(true), _prepararDadosRanking()]);

  const bootFlag = localStorage.getItem("retro_led_boot");
  localStorage.removeItem("retro_led_boot");

  let messageBoot;
  if (bootFlag === "logout") {
    messageBoot =
      "Até logo — Volte sempre para reviver a magia da infância ✦ RetroBrinquedos BR";
  } else if (isUserLogged) {
    const saudacao = _nomeUsuarioBoot
      ? "Bem-vindo de volta, " + _nomeUsuarioBoot + "!"
      : "Bem-vindo de volta!";
    messageBoot =
      saudacao +
      " ✦ Curta as cartas, marque seus brinquedos e deixe um comentário";
  } else {
    messageBoot =
      "Bem-vindo ao RetroBrinquedos BR — O museum dos brinquedos inesquecíveis ✦ Clique em qualquer carta para revelar a ficha Super Trunfo";
  }

  iniciarPainelLED(messageBoot);
}

// ================================================================
// 3. CATÁLOGO — FETCH, MASONRY E HELPERS
// ================================================================

// 3.1 — getColumnCount — retorna o número ideal de colunas do masonry para a largura atual da janela
function getColumnCount() {
  const width = window.innerWidth;
  if (width >= 1536) return 6;
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 640) return 3;
  return 2;
}

// 3.2 — buildLedDisplay — monta o HTML do indicador LED de raridade (verde ≤6, amarelo ≤8, vermelho >8)
// Está em desuso no momento dada a reestrutução do Card Verso Super Trunfo, mas pode ser facilmente adaptado
// para um componente de barra de raridade ou similar no futuro
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

// 3.3 — gerarIdSuperTrunfo — gera um código de carta estilo Super Trunfo (ex: A1, B3) a partir do ID numérico do brinquedo. Determinístico.
function gerarIdSuperTrunfo(idBrinquedo) {
  const idNum =
    typeof idBrinquedo === "number"
      ? idBrinquedo
      : parseInt(String(idBrinquedo).replace(/\D/g, "")) || 0;

  const letras = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const letra = letras[(idNum * 3) % letras.length];
  const numero = ((idNum * 7) % 4) + 1;

  return `${letra}${numero}`;
}

// 3.4 — otimizarUrlCloudinary — injeta parâmetros de transformação automática (f_auto, q_auto, w_N) na URL do Cloudinary
function otimizarUrlCloudinary(url, largura = 600) {
  if (!url || !url.includes("cloudinary.com")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${largura},c_limit/`);
}

// 3.5 — render — motor masonry. Para cada item: insere o HTML do card na coluna mais curta, aguarda o load da imagem (timeout 800ms)
// e executa duplo rAF antes do próximo card. Usa for...of, nunca .forEach.
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

  for (const toy of items) {
    const idNormalizado = String(toy.id).padStart(4, "0");

    // 💡 SOLUÇÃO: Lê a identidade única da semente para gerenciar o nó no DOM
    const elementoDomId = toy.domUniqueId || `card-${idNormalizado}`;

    // Remove apenas se colidir na mesma semente por erro de rede reativo
    const cardZumbi = document.getElementById(elementoDomId);
    if (cardZumbi) cardZumbi.remove();

    const ledHTML = buildLedDisplay(toy.raridade);
    const isLiked = curtidasDoUsuario.has(idNormalizado);
    const isTive = tiveDoUsuario.has(idNormalizado);
    const isQueria = queriaDoUsuario.has(idNormalizado);
    const trunfoCode = toy.codigo_trunfo || gerarIdSuperTrunfo(toy.id);

    const urlFrenteOtimizada = otimizarUrlCloudinary(toy.url_frente, 600);
    const urlVersoOtimizada = otimizarUrlCloudinary(toy.url_verso, 500);

    const cardHTML = `
    <div class="masonry-item card-enter" id="${elementoDomId}">
      <div class="card-inner" onclick="handleFlip('${idNormalizado}')">
        <div class="card-front">
          <img src="${urlFrenteOtimizada}" alt="${toy.nome}" class="w-full h-auto block" loading="lazy">
        </div>
        <div class="card-back flex flex-col">
          <div class="trunfo-header">
            <div class="trunfo-top-bar-v2">
              <span class="trunfo-code-v2">${trunfoCode}</span>
              <span class="trunfo-brand-v2">RETROBRINQUEDOS</span>
              <button class="trunfo-close-v2" onclick="handleFlip('${idNormalizado}'); event.stopPropagation();" title="Fechar">✕</button>
            </div>
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
            <div class="trunfo-curiosidade-v2">"${toy.curiosidade}"</div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${toy.fabricante}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${toy.categoria}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${toy.tema}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Raridade</span><span class="trunfo-value">${toy.raridade}/10</span></div>
            <div class="trunfo-stat-row trunfo-stat-last"><span class="trunfo-label">Visualizações</span><span class="trunfo-value" id="views-${idNormalizado}">👁 ${toy.visualizacoes || 0}</span></div>
            <div class="trunfo-actions-v2">
              <button id="btn-tive-${idNormalizado}" class="action-btn-v2 action-tive ${isTive ? "active-tive" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'tive')">
                EU TIVE <span class="action-count-v2" id="count-tive-${idNormalizado}">${toy.tive_count || 0}</span>
              </button>
              <button id="btn-queria-${idNormalizado}" class="action-btn-v2 action-queria ${isQueria ? "active-queria" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'queria')">
                QUERIA TER <span class="action-count-v2" id="count-queria-${idNormalizado}">${toy.queria_count || 0}</span>
              </button>
            </div>
          </div>

          <div class="trunfo-footer">
            <div class="footer-icons-container">
              <button
                class="footer-tab-btn comment-tab-btn"
                onclick="abrirDrawerComentarios(event, '${idNormalizado}', '${toy.nome.replace(/'/g, "\\'")}'); event.stopPropagation();"
                title="${isUserLogged ? "Comentar" : "Ver comentários"}"
              >
                <svg class="tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.486 2 2 6.486 2 12c0 1.863.507 3.605 1.383 5.11L2 22l5.01-1.346A9.956 9.956 0 0 0 12 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a7.955 7.955 0 0 1-4.065-1.112l-.293-.173-3.006.808.829-2.927-.192-.302A7.947 7.947 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
                </svg>
              </button>

              <button
                class="footer-tab-btn whatsapp-tab-btn"
                onclick="compartilharWhatsApp(event, '${idNormalizado}', '${toy.nome.replace(/'/g, "\\'").replace(/"/g, "&quot;")}'); event.stopPropagation();"
                title="Compartilhar no WhatsApp"
              >
                <svg class="tab-icon-svg whatsapp-tab-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </button>

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

    const shortest = columnElements.reduce((min, col) =>
      col.offsetHeight < min.offsetHeight ? col : min,
    );

    shortest.insertAdjacentHTML("beforeend", cardHTML);

    const imgInserida = shortest.querySelector(
      `#${elementoDomId} .card-front img`,
    );
    if (imgInserida && !imgInserida.complete) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 800);
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

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }
}

// 3.6 — fetchBrinquedos — busca dados e aciona render(). Três fluxos: (A) filtro pessoal via Set em memória,
// (B) busca textual via RPC, (C) catálogo padrão via API Vercel com seed + cursor. Implementa disjuntores isLoading, hasMais e isSearching.
async function fetchBrinquedos(reset = false) {
  // 🛰️ TRACE 1: Entrada da função
  console.log(
    "%c 🟢 [TRACE 1] Entrou em fetchBrinquedos",
    "color: #00ff00; font-weight: bold;",
    { reset, isLoading, hasMais, cursor },
  );

  if (isLoading || (!hasMais && !reset)) {
    console.log(
      "%c ⚠️ [TRACE 1.1] Bloqueado pelos disjuntores iniciais",
      "color: #yellow;",
    );
    return;
  }
  isLoading = true;

  // 🛰️ TRACE 2: Captura do DOM
  const grid = document.getElementById("toyGrid");
  console.log(
    "%c 📦 [TRACE 2] Elemento toyGrid capturado:",
    "color: #00ffff;",
    grid,
  );

  if (!grid) {
    console.error(
      "%c ❌ [TRACE 2.1] ERRO CRÍTICO: O elemento #toyGrid NÃO existe no HTML!",
      "background: red; color: white;",
    );
    isLoading = false;
    return;
  }

  if (reset) {
    console.log(
      "%c 🔄 [TRACE 3] Executando bloco RESET (Limpeza do catálogo)",
      "color: #magenta;",
    );
    cursor = 0;
    allToys = [];
    hasMais = true;

    try {
      if (sentinel && sentinel.parentNode) {
        sentinel.parentNode.removeChild(sentinel);
        console.log(
          "%c 🚏 [TRACE 3.1] Sentinela removido do DOM temporariamente",
          "color: #gray;",
        );
      }
    } catch (e) {
      console.warn("Aviso no gerenciamento do sentinela:", e);
    }

    const targetCols =
      typeof getColumnCount === "function" ? getColumnCount() : 3;
    console.log(
      "%c 📊 [TRACE 3.2] Colunas calculadas:",
      "color: #magenta;",
      targetCols,
    );

    grid.innerHTML = "";
    for (let i = 0; i < targetCols; i++) {
      const colDiv = document.createElement("div");
      colDiv.className = "masonry-column";
      colDiv.innerHTML = Array(2)
        .fill('<div class="skeleton-card"></div>')
        .join("");
      grid.appendChild(colDiv);
    }
  } else {
    console.log(
      "%c 📥 [TRACE 3] Executando bloco SCROLL (Injetando skeletons temporários)",
      "color: #cyan;",
    );
    const cols = document.querySelectorAll(".masonry-column");
    cols.forEach((col) => {
      const skeleton = document.createElement("div");
      skeleton.className = "skeleton-card temp-skeleton";
      col.appendChild(skeleton);
    });
  }

  try {
    let itens = [];

    // 🛰️ TRACE 4: Estados dos Filtros Globais
    console.log(
      "%c 🔍 [TRACE 4] Avaliando filtros de busca:",
      "color: #orange;",
      {
        filtroAtivo:
          typeof filtroAtivo !== "undefined" ? filtroAtivo : "não definido",
        buscaAtiva:
          typeof buscaAtiva !== "undefined" ? buscaAtiva : "não definido",
        LIMITE: typeof LIMITE !== "undefined" ? LIMITE : "não definido",
      },
    );

    if (
      typeof filtroAtivo !== "undefined" &&
      filtroAtivo !== "todos" &&
      typeof buscaAtiva !== "undefined" &&
      buscaAtiva.length < 2
    ) {
      console.log(
        "%c 🗂️ [TRACE 4.1] Entrou no fluxo de Filtros Pessoais (Tive/Queria/Curtidas)",
        "color: #orange;",
      );
      const setAtivo =
        filtroAtivo === "tive"
          ? typeof tiveDoUsuario !== "undefined"
            ? tiveDoUsuario
            : new Set()
          : filtroAtivo === "queria"
            ? typeof queriaDoUsuario !== "undefined"
              ? queriaDoUsuario
              : new Set()
            : typeof curtidasDoUsuario !== "undefined"
              ? curtidasDoUsuario
              : new Set();

      const idsFiltro = [...setAtivo];
      console.log("IDs no set ativo do usuário:", idsFiltro);

      if (idsFiltro.length === 0) {
        if (reset) grid.innerHTML = "";
        document
          .querySelectorAll(".temp-skeleton")
          .forEach((el) => el.remove());
        grid.innerHTML = `
          <div class="col-span-full text-center py-20">
            <p class="text-pink-500 font-retro text-xl">NENHUM ITEM AQUI AINDA</p>
          </div>`;
        hasMais = false;
        return;
      }

      const { data, error: filtroError } = await supabaseClient
        .from("brinquedos")
        .select("*")
        .in("id", idsFiltro);

      if (filtroError) throw filtroError;
      itens = data || [];
      hasMais = false;
    } else if (typeof buscaAtiva !== "undefined" && buscaAtiva.length >= 2) {
      console.log(
        "%c 🔤 [TRACE 4.2] Entrou no fluxo de Busca por Texto RPC",
        "color: #orange;",
      );
      const { data, error: rpcError } = await supabaseClient.rpc(
        "buscar_brinquedos_search",
        { termo_busca: buscaAtiva, cursor_val: cursor, limite_val: LIMITE },
      );
      if (rpcError) throw rpcError;
      itens = data || [];
    } else {
      // 🚀 CANAL PADRÃO DO CATÁLOGO
      const limiteRequisitado = typeof LIMITE !== "undefined" ? LIMITE : 24;
      const urlCompleta = `/api/brinquedos?cursor=${cursor}&limite=${limiteRequisitado}&seed=${sessionSeed}`;

      console.log(
        "%c 🌐 [TRACE 4.3] Disparando Fetch para a API Vercel:",
        "color: #green; font-weight: bold;",
        urlCompleta,
      );

      const res = await fetch(urlCompleta);
      if (!res.ok) throw new Error("Falha na API");

      const data = await res.json();
      console.log(
        "%c 📥 [TRACE 4.4] Resposta recebida da API:",
        "color: #green;",
        data,
      );

      if (reset && data.total) {
        console.log(
          "%c 🔢 [TRACE 4.5] Atualizando heroCount para:",
          "color: #green;",
          data.total,
        );
        const heroCountEl = document.getElementById("heroCount");
        if (heroCountEl) heroCountEl.textContent = data.total;
      }

      itens = data.itens || [];
      cursor = data.cursor;
      hasMais = data.temMais;

      // 🔄 LOOP INFINITO (ANTECIPAÇÃO SILENCIOSA)
      if (itens.length < limiteRequisitado) {
        const sementeAntiga = sessionSeed;
        sessionSeed = Math.random();
        cursor = 0;
        hasMais = true;

        console.log(
          `%c 🔄 [LOOP INFINITO ACTIVATED] %c Semente antiga (${sementeAntiga.toFixed(4)}) finalizada. Nova semente gerada: (${sessionSeed.toFixed(4)}). Cursor resetado para 0!`,
          "background: #ec4899; color: #fff; padding: 3px; font-weight: bold;",
          "color: #06b6d4;",
        );

        // 💡 GATILHO EASTER EGG: Dispara a bandeirada do Enduro na virada de semente
        if (typeof animarBandeirasEnduro === "function") {
          animarBandeirasEnduro();
        }

        // 🔥 VALIDAÇÃO BLINDADA: Se o lote veio vazio por ser múltiplo exato, prepara os estados na memória
        // e deixa que o sentinela ou o scroll natural puxem a rodada subsequente de forma assíncrona.
        if (itens.length === 0) {
          console.log(
            "%c 🚀 [GATILHO SEGURO] Lote vazio detectado. Semente e cursor resetados na memória. Aguardando próximo pulso de scroll para evitar avalanche.",
            "color: #ff9800; font-weight: bold;",
          );
          hasMais = true;
          isLoading = false;
          return;
        }
      }
    }

    // 🛰️ TRACE 5: Processamento pós-busca
    console.log(
      "%c 🛠️ [TRACE 5] Processando itens para renderização. Qtd recebida:",
      "color: #blue;",
      itens.length,
    );

    if (reset) {
      grid.innerHTML = "";
    } else {
      document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
    }

    // --- DEDUPLICAÇÃO INTELIGENTE POR LOTE ---
    const idsNoLoteAtual = new Set();
    const itensNovos = [];

    itens.forEach((toy) => {
      const idStr = String(toy.id).padStart(4, "0");
      if (!idsNoLoteAtual.has(idStr)) {
        idsNoLoteAtual.add(idStr);
        const sToken = sessionSeed.toString().substring(2, 6);
        itensNovos.push({
          ...toy,
          domUniqueId: `card-${idStr}_s${sToken}`,
        });
      }
    });

    console.log(
      "%c 🛠️ [TRACE 5.1] Itens filtrados novos únicos gerados:",
      "color: #blue;",
      itensNovos.length,
    );

    if (itensNovos.length > 0) {
      allToys = reset ? itensNovos : [...allToys, ...itensNovos];

      console.log(
        "%c 🎨 [TRACE 5.2] Chamando função render()...",
        "color: #purple;",
      );
      await render(itensNovos, !reset);

      // 💡 FIX: Aspas corrigidas na string do log abaixo
      console.log(
        "%c 🎨 [TRACE 5.3] Função render() finalizada com sucesso.",
        "color: #purple;",
      );

      if (
        typeof buscaAtiva !== "undefined" &&
        buscaAtiva.length >= 2 &&
        !reset
      ) {
        cursor += itens.length;
      }
    } else if (reset) {
      console.log(
        "%c 🛑 [TRACE 5.4] Nenhum item encontrado no reset.",
        "color: #red;",
      );
      const termoAtual = typeof buscaAtiva !== "undefined" ? buscaAtiva : "";
      grid.innerHTML = `<div class="text-center py-20"><p class="text-pink-500 font-retro text-xl">ITEM NÃO ENCONTRADO</p></div>`;
      hasMais = false;
    } else {
      hasMais = false;
    }
  } catch (error) {
    console.error(
      "%c 💥 [TRACE ERRO] O pipeline quebrou dentro do bloco try!",
      "background: red; color: white; font-weight: bold;",
      error,
    );
    if (reset)
      grid.innerHTML =
        "<p class='text-center col-span-full text-pink-500 font-retro'>ERRO DE CONEXÃO COM O ARQUIVO</p>";
    document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
  } finally {
    isLoading = false;
    console.log(
      "%c 🏁 [TRACE FINALLY] Executando finalizadores de ciclo",
      "color: #gray;",
    );

    setTimeout(() => {
      try {
        const mainElement = document.querySelector("main");
        if (mainElement && sentinel && !sentinel.parentNode) {
          mainElement.appendChild(sentinel);
          console.log(
            "%c 🚏 [TRACE FINALLY] Sentinela re-acoplado ao main",
            "color: #gray;",
          );
        }
        isSearching = false;
        if (typeof verificarSentinela === "function") verificarSentinela();
      } catch (e) {
        console.warn("Aviso no finally do sentinel:", e);
      }
    }, 600);
  }
}

// ================================================================
// 4. CARDS — FLIP, VISUALIZAÇÃO E COMPARTILHAMENTO
// ================================================================

// 4.1 — _cardsVistos + registrarVisualizacao — incrementa o contador de visualizações via RPC,
// garantindo que cada card seja contado apenas uma vez por sessão
const _cardsVistos = new Set();

async function registrarVisualizacao(id) {
  if (_cardsVistos.has(id)) return;
  _cardsVistos.add(id);
  try {
    await supabaseClient.rpc("increment_visualizacoes", { card_id: id });
  } catch (_) {}
}

// 4.2 — handleFlip — gerencia o flip frente/verso. Desktop (≥768px): aplica CSS is-flipped + scroll suave.
// Mobile (<768px): delega para abrirCardVersoMobile(). Ignora cliques em botões, SVGs e inputs.
function handleFlip(id) {
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

  if (window.innerWidth < 768) {
    abrirCardVersoMobile(id);
    return;
  }

  const grid = document.getElementById("toyGrid");

  // 💡 CORREÇÃO: Busca primeiro pelo ID único da semente atual, se não achar, tenta o ID clássico
  const sToken =
    typeof sessionSeed !== "undefined"
      ? sessionSeed.toString().substring(2, 6)
      : "";
  let card =
    document.getElementById(`card-${id}_s${sToken}`) ||
    document.getElementById(`card-${id}`);

  if (!card) return; // Proteção caso o elemento sumer do DOM

  const isFlipped = card.classList.contains("is-flipped");

  if (grid.classList.contains("grid-focused") && !isFlipped) {
    return;
  }

  document
    .querySelectorAll(".masonry-item")
    .forEach((c) => c.classList.remove("is-flipped"));

  if (!isFlipped) {
    registrarVisualizacao(id);
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

// 4.3 — abrirCardVersoMobile — abre o modal do verso em telas < 768px com arquitetura de duas faces 3D reais
function abrirCardVersoMobile(id) {
  const data = allToys.find(
    (t) => String(t.id).padStart(4, "0") === String(id).padStart(4, "0"),
  );
  if (!data) return;

  registrarVisualizacao(String(data.id).padStart(4, "0"));

  const idNormalizado = String(data.id).padStart(4, "0");
  const urlVersoOtimizada = otimizarUrlCloudinary(data.url_verso, 500);
  const trunfoCode = data.codigo_trunfo || gerarIdSuperTrunfo(data.id);
  const isTive = tiveDoUsuario.has(idNormalizado);
  const isQueria = queriaDoUsuario.has(idNormalizado);
  const isLiked = curtidasDoUsuario.has(idNormalizado);

  const box = document.getElementById("cardVersoMobileBox");
  if (!box) return;

  // Guarda de forma blindada o id atual como atributo de dados no container externo
  box.setAttribute("data-current-id", idNormalizado);

  const sToken =
    typeof sessionSeed !== "undefined"
      ? sessionSeed.toString().substring(2, 6)
      : "";
  const cardOrigem =
    document.getElementById(`card-${idNormalizado}_s${sToken}`) ||
    document.getElementById(`card-${idNormalizado}`);
  const overlay = document.getElementById("cardVersoMobileModal");

  // Captura a foto da frente do card original para alimentar a face frontal do modal
  let urlFrenteOriginal = data.url_frente;
  if (cardOrigem) {
    const imgFrente = cardOrigem.querySelector(".card-front img");
    if (imgFrente) urlFrenteOriginal = imgFrente.src;
  }

  let rectInicial = {
    left: window.innerWidth / 2 - 75,
    top: window.innerHeight / 2 - 115,
    width: 150,
    height: 230,
  };
  if (cardOrigem) {
    rectInicial = cardOrigem.getBoundingClientRect();
  }

  if (overlay) {
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    overlay.style.opacity = "0";
  }

  // Injeção da arquitetura sanduíche legítima de Duas Faces Reais
  box.innerHTML = `
    <div class="card-mobile-inner" id="cardMobileInnerEngine">
      
      <div class="card-mobile-face face-frente" id="cardMobileFaceFrenteEngine">
        <img src="${urlFrenteOriginal}" alt="${data.nome} frente" loading="eager">
      </div>

      <div class="card-mobile-face face-verso">
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
          <div class="trunfo-curiosidade-scroll-box">
            <div class="trunfo-curiosidade-v2">"${data.curiosidade}"</div>
          </div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${data.fabricante}</span></div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${data.categoria}</span></div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${data.tema}</span></div>
          <div class="trunfo-stat-row"><span class="trunfo-label">Raridade</span><span class="trunfo-value">${data.raridade}/10</span></div>
          <div class="trunfo-stat-row trunfo-stat-last"><span class="trunfo-label">Visualizações</span><span class="trunfo-value" id="m-views-${idNormalizado}"><span class="trunfo-view-icon">👁</span> ${data.visualizacoes || 0}</span></div>
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
            <button class="footer-tab-btn comment-tab-btn" onclick="abrirDrawerComentarios(event, '${idNormalizado}', '${data.nome.replace(/'/g, "\\'")}'); fecharCardVersoMobile();" title="${isUserLogged ? "Comentar" : "Ver comentários"}"><svg class="tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.486 2 2 6.486 2 12c0 1.863.507 3.605 1.383 5.11L2 22l5.01-1.346A9.956 9.956 0 0 0 12 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a7.955 7.955 0 0 1-4.065-1.112l-.293-.173-3.006.808.829-2.927-.192-.302A7.947 7.947 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg></button>
            <button class="footer-tab-btn whatsapp-tab-btn" onclick="compartilharWhatsApp(event, '${idNormalizado}', '${data.nome.replace(/'/g, "\\'").replace(/"/g, "&quot;")}'); fecharCardVersoMobile();" title="Compartilhar no WhatsApp"><svg class="tab-icon-svg whatsapp-tab-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></button>
            <button id="m-heart-btn-${idNormalizado}" class="footer-tab-btn heart-tab-btn ${isLiked ? "liked" : ""} ${!isUserLogged ? "tab-locked" : ""}" onclick="toggleCurtidaModal(event, '${idNormalizado}')" title="${isUserLogged ? "Curtir" : "Faça login para curtir"}"><svg class="heart-svg tab-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg><span class="tab-count" id="m-count-${idNormalizado}">${data.curtidas_count || 0}</span></button>
          </div>
        </div>
      </div>

    </div>`;

  const rectFinal = box.getBoundingClientRect();

  const deltaX =
    rectInicial.left +
    rectInicial.width / 2 -
    (rectFinal.left + rectFinal.width / 2);
  const deltaY =
    rectInicial.top +
    rectInicial.height / 2 -
    (rectFinal.top + rectFinal.height / 2);
  const escalaX = rectInicial.width / rectFinal.width;
  const escalaY = rectInicial.height / rectFinal.height;

  const engine = document.getElementById("cardMobileInnerEngine");
  if (engine) engine.style.transform = "rotateY(0deg)";

  box.style.transition = "none";
  box.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${escalaX}, ${escalaY})`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (overlay) {
        overlay.style.transition = "opacity 0.2s linear";
        overlay.style.opacity = "1";
      }
      document.body.style.overflow = "hidden";

      // Abre expandindo e centralizando a órbita na tela — 0.68s para maior suavidade
      box.style.transition = "transform 0.68s cubic-bezier(0.2, 0.8, 0.2, 1)";
      box.style.transform = "translate(0px, 0px) scale(1, 1)";

      setTimeout(() => {
        if (engine) engine.classList.add("is-flipped-mobile");
      }, 60);
    });
  });

  history.pushState({ modal: "cardVersoMobile" }, "");
}

// 4.4 — mostrarToastModal — exibe feedback dentro do modal mobile (substitui o painel LED que fica coberto pelo overlay nesse contexto)
let _toastTimer = null;

/* ============================================================
   CORREÇÃO DO TOAST EXCLUSIVO DO MODAL MOBILE
   ============================================================ */
function mostrarToastModal(mensagem) {
  const toast = document.getElementById("cardVersoToast");
  if (!toast) return;
  clearTimeout(_toastTimer);

  // 💡 FIX: Mudado de 'message' para 'mensagem' para ler o parâmetro correto!
  toast.textContent = "⚡ " + mensagem;

  toast.classList.remove("hidden");
  toast.classList.add("card-verso-toast--visible");
  _toastTimer = setTimeout(() => {
    toast.classList.remove("card-verso-toast--visible");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2500);
}

// 4.5 — toggleInteracaoModal — wrapper para toggleInteracao() que exibe o toast do modal se o usuário não estiver logado
function toggleInteracaoModal(event, id, tipo) {
  if (!isUserLogged) {
    if (event) event.stopPropagation();
    mostrarToastModal("FAÇA LOGIN PARA INTERAGIR");
    return;
  }
  toggleInteracao(event, id, tipo);
}

// 4.6 — toggleCurtidaModal — wrapper para toggleCurtida() com suporte ao toast do modal mobile
function toggleCurtidaModal(event, id) {
  if (!isUserLogged) {
    if (event) event.stopPropagation();
    mostrarToastModal("FAÇA LOGIN PARA CURTIR");
    return;
  }
  toggleCurtida(event, id);
}

// 4.7 — fecharCardVersoMobile — fecha o modal mobile executando o desgiro inverso legítimo para revelar a frente
function fecharCardVersoMobile(event, veioDoPopstate = false) {
  if (event && event.target !== document.getElementById("cardVersoMobileModal"))
    return;

  const modal = document.getElementById("cardVersoMobileModal");
  const box = document.getElementById("cardVersoMobileBox");
  const engine = document.getElementById("cardMobileInnerEngine");
  const faceFrente = document.getElementById("cardMobileFaceFrenteEngine");

  if (modal && box && engine) {
    // 1. Desgira a folha interna de volta para 0deg, revelando a imagem da FRENTE em pleno ar
    engine.classList.remove("is-flipped-mobile");

    // 2. LEITURA SEGURA DO DATASET DE ORIGEM
    const idNormalizado = box.getAttribute("data-current-id") || "";
    const sToken =
      typeof sessionSeed !== "undefined"
        ? sessionSeed.toString().substring(2, 6)
        : "";
    const cardOrigem =
      document.getElementById(`card-${idNormalizado}_s${sToken}`) ||
      document.getElementById(`card-${idNormalizado}`);

    let rectInicial = {
      left: window.innerWidth / 2 - 75,
      top: window.innerHeight / 2 - 115,
      width: 150,
      height: 230,
    };
    if (cardOrigem) {
      rectInicial = cardOrigem.getBoundingClientRect();
    }

    // 🎯 ESTRATÉGIA ABORDAGEM B: No instante do fechamento, força a face da frente a assumir
    // a proporção geométrica exata do card de destino. Isso anula a escala assimétrica
    // e impede a GPU do smartphone de achatar a foto horizontalmente nos frames finais.
    if (faceFrente) {
      faceFrente.style.width = `${rectInicial.width}px`;
      faceFrente.style.height = `${rectInicial.height}px`;
      faceFrente.style.top = "50%";
      faceFrente.style.left = "50%";
      faceFrente.style.transform = "translate(-50%, -50%) rotateY(0deg)";
      faceFrente.style.borderRadius = "1rem";
    }

    const rectFinal = box.getBoundingClientRect();
    const deltaX =
      rectInicial.left +
      rectInicial.width / 2 -
      (rectFinal.left + rectFinal.width / 2);
    const deltaY =
      rectInicial.top +
      rectInicial.height / 2 -
      (rectFinal.top + rectFinal.height / 2);
    const escalaX = rectInicial.width / rectFinal.width;
    const escalaY = rectInicial.height / rectFinal.height;

    // 3. Sincroniza o esvaecimento do overlay e encolhe o box de volta para o Masonry (0.62s)
    modal.style.transition = "opacity 0.55s linear";
    modal.style.opacity = "0";

    box.style.transition = "transform 0.62s cubic-bezier(0.2, 0.8, 0.2, 1)";
    box.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${escalaX}, ${escalaY})`;

    setTimeout(() => {
      modal.classList.add("hidden");
      document.body.style.overflow = "";

      // Limpa os estilos injetados e remove o atributo temporário para o próximo clique
      box.style.transform = "";
      box.style.transition = "";
      box.removeAttribute("data-current-id");
      if (faceFrente) {
        faceFrente.style.width = "";
        faceFrente.style.height = "";
        faceFrente.style.top = "";
        faceFrente.style.left = "";
        faceFrente.style.transform = "";
        faceFrente.style.borderRadius = "";
      }
    }, 620); // Perfeitamente casado com os 0.62s do box transition
  } else if (modal) {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 4.8 — Listener de click global — fecha o card flipado ao clicar fora dele no desktop
document.addEventListener("click", (event) => {
  const grid = document.getElementById("toyGrid");
  if (grid && grid.classList.contains("grid-focused")) {
    const flippedCard = document.querySelector(".masonry-item.is-flipped");
    if (flippedCard && !flippedCard.contains(event.target))
      resetarEstadoDosCards();
  }
});

// 4.9 — resetarEstadoDosCards — remove is-flipped de todos os cards e restaura o overflow do body
function resetarEstadoDosCards() {
  const grid = document.getElementById("toyGrid");
  if (grid) grid.classList.remove("grid-focused");
  document.body.style.overflow = "";
  document
    .querySelectorAll(".masonry-item")
    .forEach((card) => card.classList.remove("is-flipped"));
}

// 4.10 — compartilharWhatsApp — mobile: tenta Web Share API com a imagem como File;
// desktop/fallback: link wa.me com texto pré-formatado
async function compartilharWhatsApp(event, id, nome) {
  if (event) event.stopPropagation();

  const toyData = allToys.find(
    (t) => String(t.id).padStart(4, "0") === String(id).padStart(4, "0"),
  );
  const urlImagemFrente = toyData ? toyData.url_frente : "";
  const urlSPA = window.location.origin + window.location.pathname;

  const legendaText =
    `*RetroBrinquedos BR* — Você se lembra deste? *${nome}*\n` +
    `Reviva a nostalgia dos anos 80/90!\n\n` +
    `${urlSPA}`;

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
        return;
      }
    } catch (err) {
      console.warn(
        "Ambiente móvel barrou o arquivo, usando fallback textual...",
        err,
      );
    }
  }

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

// 4.11 — fecharCardModal — fecha o modal de card compartilhado e restaura o scroll
function fecharCardModal() {
  const modal = document.getElementById("cardCompartilhadoModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ============================================================
   3.5.4. DRAWER DE COMENTÁRIOS
   ============================================================ */

// 4.12 — abrirModalEspelhoMobile — monta a ficha completa do brinquedo no #cardCompartilhadoModal
// (usado pelo fluxo de URL compartilhada ?card=XXXX)
async function abrirModalEspelhoMobile(cardId) {
  try {
    const data = allToys.find(
      (t) => String(t.id).padStart(4, "0") === String(cardId).padStart(4, "0"),
    );
    if (!data) return;

    const idNormalizado = String(data.id).padStart(4, "0");
    const urlVersoOtimizada = otimizarUrlCloudinary(data.url_verso, 500);
    const trunfoCode = data.codigo_trunfo || gerarIdSuperTrunfo(data.id);
    const ledHTML = buildLedDisplay(data.raridade);

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

    const modalLabel = document.querySelector(".card-modal-label");
    if (modalLabel) modalLabel.style.display = "none";

    const modalCta = document.querySelector(".card-modal-cta");
    if (modalCta) modalCta.innerHTML = "✕ Voltar para o Quarto";

    document
      .getElementById("cardCompartilhadoModal")
      .classList.remove("hidden");
    document.body.style.overflow = "hidden";
  } catch (e) {
    console.error("Erro ao espelhar card mobile:", e);
  }
}

/* ============================================================
   3.6. BUSCA INTELIGENTE
   ============================================================ */

// ================================================================
// 5. INTERAÇÕES DO USUÁRIO — CURTIDAS, EU TIVE E QUERIA TER
// ================================================================

// 5.1 — carregarInteracoesDoBanco — carrega em memória os três Sets de interações do usuário com 3 queries paralelas
// e até 3 tentativas com backoff exponencial
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

// 5.2 — toggleCurtida — adiciona ou remove uma curtida com atualização otimista da UI.
// Sincroniza botões do grid e do modal mobile simultaneamente via querySelectorAll.
async function toggleCurtida(event, brinquedoId) {
  if (event) event.stopPropagation();
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

  // 💡 CORREÇÃO MOBILE + DESKTOP: Captura seletores universais para atualizar clones síncronos
  const botoesGrid = document.querySelectorAll(
    `[id^="heart-btn-${idParaBanco}"]`,
  );
  const botaoModalMobile = document.getElementById(
    `m-heart-btn-${idParaBanco}`,
  );
  const contadores = document.querySelectorAll(
    `[id^="count-${idParaBanco}"], #m-count-${idParaBanco}`,
  );

  // Pega o valor atual do primeiro contador válido encontrado
  let count = 0;
  const primeiroContador =
    document.getElementById(`count-${idParaBanco}`) ||
    document.getElementById(`m-count-${idParaBanco}`);
  if (primeiroContador) {
    count = parseInt(primeiroContador.innerText) || 0;
  }

  if (isLiked) {
    curtidasDoUsuario.delete(idParaBanco);
    botoesGrid.forEach((btn) => btn.classList.remove("liked"));
    if (botaoModalMobile) botaoModalMobile.classList.remove("liked");
    contadores.forEach((c) => (c.innerText = Math.max(0, count - 1)));

    await supabaseClient
      .from("curtidas")
      .delete()
      .eq("usuario_id", userId)
      .eq("brinquedo_id", idParaBanco);
  } else {
    curtidasDoUsuario.add(idParaBanco);
    botoesGrid.forEach((btn) => {
      btn.classList.add("liked", "animating");
      setTimeout(() => btn.classList.remove("animating"), 600);
    });
    if (botaoModalMobile) botaoModalMobile.classList.add("liked");
    contadores.forEach((c) => (c.innerText = count + 1));

    await supabaseClient
      .from("curtidas")
      .insert([{ usuario_id: userId, brinquedo_id: idParaBanco }]);
  }
}

// 5.3 — toggleInteracao — adiciona ou remove EU TIVE / QUERIA TER. As opções são mutuamente exclusivas:
// marcar uma remove a outra automaticamente. Inclui rollback em memória se o banco falhar.
async function toggleInteracao(event, brinquedoId, tipo) {
  if (event) event.stopPropagation();
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    dispararTilt("FAÇA LOGIN PARA INTERAGIR");
    return;
  }

  const userId = session.user.id;
  const idParaBanco = String(brinquedoId).padStart(4, "0");

  let memorySet, tableName, activeClass;
  let oppSet, oppTable, oppClass, oppTipo;

  if (tipo === "tive") {
    memorySet = tiveDoUsuario;
    tableName = "interacoes_tive";
    activeClass = "active-tive";

    oppSet = queriaDoUsuario;
    oppTable = "interacoes_queria";
    oppClass = "active-queria";
    oppTipo = "queria";
  } else {
    memorySet = queriaDoUsuario;
    tableName = "interacoes_queria";
    activeClass = "active-queria";

    oppSet = tiveDoUsuario;
    oppTable = "interacoes_tive";
    oppClass = "active-tive";
    oppTipo = "tive";
  }

  const isAtivo = memorySet.has(idParaBanco);

  // 💡 CORREÇÃO UNIVERSAL: Captura botões do grid, do modal mobile e os contadores sincronizados
  const botoesGrid = document.querySelectorAll(
    `[id^="btn-${tipo}-${idParaBanco}"]`,
  );
  const botaoModalMobile = document.getElementById(
    `m-btn-${tipo}-${idParaBanco}`,
  );
  const contadores = document.querySelectorAll(
    `[id^="count-${tipo}-${idParaBanco}"], #m-count-${tipo}-${idParaBanco}`,
  );

  let count = 0;
  const primeiroContador =
    document.getElementById(`count-${tipo}-${idParaBanco}`) ||
    document.getElementById(`m-count-${tipo}-${idParaBanco}`);
  if (primeiroContador) {
    count = parseInt(primeiroContador.innerText) || 0;
  }

  if (isAtivo) {
    memorySet.delete(idParaBanco);
    botoesGrid.forEach((btn) => btn.classList.remove(activeClass));
    if (botaoModalMobile) botaoModalMobile.classList.remove(activeClass);
    contadores.forEach((c) => (c.innerText = Math.max(0, count - 1)));

    const { error } = await supabaseClient
      .from(tableName)
      .delete()
      .eq("usuario_id", userId)
      .eq("brinquedo_id", idParaBanco);

    if (error) {
      memorySet.add(idParaBanco);
      botoesGrid.forEach((btn) => btn.classList.add(activeClass));
      if (botaoModalMobile) botaoModalMobile.classList.add(activeClass);
      contadores.forEach((c) => (c.innerText = count));
    }
  } else {
    if (oppSet.has(idParaBanco)) {
      oppSet.delete(idParaBanco);

      const oppBotoesGrid = document.querySelectorAll(
        `[id^="btn-${oppTipo}-${idParaBanco}"]`,
      );
      const oppBotaoModalMobile = document.getElementById(
        `m-btn-${oppTipo}-${idParaBanco}`,
      );
      const oppContadores = document.querySelectorAll(
        `[id^="count-${oppTipo}-${idParaBanco}"], #m-count-${oppTipo}-${idParaBanco}`,
      );

      let oppCount = 0;
      const primeiroOppContador =
        document.getElementById(`count-${oppTipo}-${idParaBanco}`) ||
        document.getElementById(`m-count-${oppTipo}-${idParaBanco}`);
      if (primeiroOppContador) {
        oppCount = parseInt(primeiroOppContador.innerText) || 0;
      }

      oppBotoesGrid.forEach((btn) => btn.classList.remove(oppClass));
      if (oppBotaoModalMobile) oppBotaoModalMobile.classList.remove(oppClass);
      oppContadores.forEach((c) => (c.innerText = Math.max(0, oppCount - 1)));

      supabaseClient
        .from(oppTable)
        .delete()
        .eq("usuario_id", userId)
        .eq("brinquedo_id", idParaBanco)
        .then();
    }

    memorySet.add(idParaBanco);
    botoesGrid.forEach((btn) => btn.classList.add(activeClass));
    if (botaoModalMobile) botaoModalMobile.classList.add(activeClass);
    contadores.forEach((c) => (c.innerText = count + 1));

    const { error } = await supabaseClient
      .from(tableName)
      .insert([{ usuario_id: userId, brinquedo_id: idParaBanco }]);

    if (error) {
      memorySet.delete(idParaBanco);
      botoesGrid.forEach((btn) => btn.classList.remove(activeClass));
      if (botaoModalMobile) botaoModalMobile.classList.remove(activeClass);
      contadores.forEach((c) => (c.innerText = count));
    }
  }
}

// 5.4 — filtrarMeuQuarto — aplica o filtro de coleção pessoal (todos/tive/queria/curtidas),
// atualiza o botão ativo na barra de filtros e recarrega o grid
async function filtrarMeuQuarto(tipo) {
  filtroAtivo = tipo;

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  const btnAtivo = document.getElementById(`filter-${tipo}`);
  if (btnAtivo) btnAtivo.classList.add("active");

  buscaAtiva = "";
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";

  resetarEstadoDosCards();

  await fetchBrinquedos(true);
}

/* ============================================================
   SEÇÃO 3.9. PAINEL LED — ENGINE COMPLETA
   ============================================================ */

// ================================================================
// 6. BUSCA INTELIGENTE
// ================================================================

// 6.1 — Variáveis de estado da busca — termo ativo, AbortController para cancelar fetches anteriores e timer de debounce
let buscaAtiva = "";
let fetchAbortController = null;
let debounceTimer = null;

// 6.2 — sanitizarBusca — remove caracteres XSS, colapsa espaços, converte para lowercase e limita a 60 caracteres
function sanitizarBusca(valor) {
  return valor
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 60);
}

// 6.3 — _executarBusca — cancela fetch anterior via AbortController, ativa isSearching e dispara fetchBrinquedos(true).
// Guard: ignora se o termo não mudou.
async function _executarBusca(term) {
  if (term === buscaAtiva) return;

  if (term.length === 0 && buscaAtiva === "") {
    mostrarMensagemLED("DIGITE O TERMO QUE DESEJA BUSCAR");
    return;
  }

  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();

  isSearching = true;

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

  await new Promise((resolve) => setTimeout(resolve, 80));

  await fetchBrinquedos(true);
}

// 6.4 — executarBuscaForçada — ignora o debounce e dispara a busca imediatamente
// (acionada pelo botão lupa ou pela tecla Enter) - correção em 2026-05-29, a grafia estava ejecutarBuscaForçada() no HTML,
// mas a função estava definida como executarBuscaForçada() — agora ambas estão alinhadas para evitar confusão futura!
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

// 6.5 — Event listeners do campo de busca — keydown Enter: busca forçada imediata; input: debounce de 600ms
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    executarBuscaForçada();
  }
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = sanitizarBusca(e.target.value);
  const clearBtn = document.getElementById("clearSearchBtn");

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

// 6.6 — limparBuscaRapida — limpa o campo, zera buscaAtiva e restaura o catálogo completo
async function limparBuscaRapida() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearSearchBtn");

  if (!input) return;

  input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");

  clearTimeout(debounceTimer);

  if (buscaAtiva === "") return;

  isSearching = true;

  if (typeof resetarEstadoDosCards === "function") {
    resetarEstadoDosCards();
  }

  buscaAtiva = "";
  cursor = 0;
  allToys = [];
  hasMais = true;

  await fetchBrinquedos(true);

  const secaoColecao = document.getElementById("colecao");
  if (secaoColecao) {
    secaoColecao.scrollIntoView({ behavior: "smooth" });
  }
}

/* 3.7. ARCADE LOGIN E SISTEMA DE AVATARES */

// ================================================================
// 7. DRAWER DE COMENTÁRIOS
// ================================================================

// 7.1 — Variáveis de estado do drawer — ID e nome do brinquedo cujo drawer está aberto no momento
let drawerIdAtivo = null;
let drawerNomeAtivo = null;

// 7.2 — abrirDrawerComentarios — abre o painel, exibe área de input apenas para logados,
// empilha histórico e carrega os comentários do banco
async function abrirDrawerComentarios(event, id, nome) {
  if (event) event.stopPropagation();

  drawerIdAtivo = id;
  drawerNomeAtivo = nome;

  document.getElementById("drawerNomeBrinquedo").textContent = nome;
  document.getElementById("drawerListaComentarios").innerHTML =
    '<p class="drawer-loading">Carregando...</p>';

  const inputArea = document.getElementById("drawerInputArea");
  const loginBanner = document.getElementById("drawerLoginBanner");
  if (isUserLogged) {
    if (inputArea) inputArea.classList.remove("hidden");
    if (loginBanner) loginBanner.classList.add("hidden");
    document.getElementById("drawerComentarioInput").value = "";
  } else {
    if (inputArea) inputArea.classList.add("hidden");
    if (loginBanner) loginBanner.classList.remove("hidden");
  }

  const drawer = document.getElementById("comentariosDrawer");
  drawer.classList.add("open");
  document.body.classList.add("drawer-open");

  // Empilha histórico fictício
  history.pushState({ modal: "comentariosDrawer" }, "");

  await carregarComentariosDrawer(id);
}

// 7.3 — fecharDrawerComentarios — fecha o painel, limpa o estado e sincroniza a pilha de histórico
function fecharDrawerComentarios(veioDoPopstate = false) {
  document.getElementById("comentariosDrawer").classList.remove("open");
  document.body.classList.remove("drawer-open");
  drawerIdAtivo = null;
  drawerNomeAtivo = null;

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 7.4 — fecharDrawerSeForaDoPanel — fecha o drawer ao clicar no overlay fora do painel
function fecharDrawerSeForaDoPanel(event) {
  if (event.target === document.getElementById("comentariosDrawer")) {
    fecharDrawerComentarios();
  }
}

// 7.5 — carregarComentariosDrawer — busca até 50 comentários aprovados do Supabase e
// renderiza a lista com emojis retrô rotativos como avatares
async function carregarComentariosDrawer(id) {
  const lista = document.getElementById("drawerListaComentarios");

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
        const emoji = emojisRetro[i % emojisRetro.length];
        const eMeu = meuId && c.usuario_id === meuId;
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

// 7.6 — enviarComentarioDrawer — valida, modera e grava o comentário no Supabase.
// Recarrega a lista e faz scroll para o topo ao concluir.
async function enviarComentarioDrawer() {
  if (!isUserLogged || !drawerIdAtivo) return;

  const input = document.getElementById("drawerComentarioInput");
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;

  if (contemPalavraProibida(texto)) {
    dispararTiltBanimento("LINGUAGEM INADEQUADA DETECTADA");
    input.value = "";
    return;
  }

  try {
    const session = await supabaseClient.auth.getSession();
    const user = session?.data?.session?.user;
    if (!user) return;

    const nomeReal = user.user_metadata?.full_name || "Jogador";

    const { error } = await supabaseClient.from("comentarios").insert([
      {
        brinquedo_id: drawerIdAtivo,
        usuario_id: user.id,
        texto: texto,
        usuario_nome: nomeReal,
        aprovado: true,
      },
    ]);

    if (error) throw error;

    input.value = "";
    await carregarComentariosDrawer(drawerIdAtivo);
    document.getElementById("drawerListaComentarios").scrollTop = 0;
  } catch (err) {
    console.error("Erro ao enviar comentário:", err);
    mostrarMensagemLED("ERRO AO PROCESSAR OPERAÇÃO NO BANCO");
  }
}

// 7.7 — handleDrawerEnter — envia o comentário ao pressionar Enter no input do drawer
function handleDrawerEnter(event) {
  if (event.key === "Enter") enviarComentarioDrawer();
}

// 7.8 — [LEGADO] enviarComentario — versão anterior usada pelo card verso desktop.
// Inclui sistema de strikes: 3 infrações geram banimento e logout automático.
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
    input.value = texto;
  } else {
    input.placeholder = "Enviada! ✉️";
    setTimeout(() => {
      if (input) input.placeholder = placeholderOriginal;
    }, 2500);
  }
}

// 7.9 — [LEGADO] handleComentarioEnter — aciona enviarComentario ao pressionar Enter no input do card verso desktop
function handleComentarioEnter(event, idNormalizado, nomeBrinquedo) {
  if (event.key === "Enter") {
    event.preventDefault();
    enviarComentario(idNormalizado, nomeBrinquedo);
  }
}

/* ============================================================
   SEÇÃO 3.10. INICIALIZAÇÃO DA APLICAÇÃO (BOOT)
   ============================================================ */

// ================================================================
// 8. ARCADE LOGIN E SISTEMA DE AVATARES
// ================================================================

// 8.1 — Referências aos elementos do Arcade Modal e instância do som de ficha do Street Fighter 2
const arcadeModal = document.getElementById("arcadeModal");
const arcadeScreen = document.getElementById("arcadeScreen");
const selectionScreen = document.getElementById("selectionScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const sf2CoinSound = new Audio("/sounds/street_fighter.mp3");

// 8.2 — login — abre o modal arcade na tela INSERT COIN e empilha um estado no histórico para capturar o botão Voltar
function login() {
  arcadeScreen.classList.remove("hidden");
  if (selectionScreen) selectionScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  arcadeModal.classList.remove("opacity-0", "pointer-events-none");

  // Empilha o estado do Arcade para capturar o botão voltar do smartphone
  history.pushState({ modal: "arcadeLogin" }, "");
}

// Substitui a antiga função 'closeModal' para prever a desistencia com logout forçado

// 8.3 — fecharArcadePorDesistencia — exibe a tela GAME OVER e força logout para derrubar o token Supabase incompleto
// (usuário autenticado mas sem avatar selecionado)
function fecharArcadePorDesistencia(veioDoPopstate = false) {
  arcadeScreen.classList.add("hidden");
  if (selectionScreen) selectionScreen.classList.add("hidden");
  gameOverScreen.classList.remove("hidden");

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }

  setTimeout(async () => {
    arcadeModal.classList.add("opacity-0", "pointer-events-none");
    // Executa o logout forçado para derrubar o token Supabase incompleto sem avatar selecionado
    await logOut();
  }, 1800);
}

// Mantém a assinatura legada caso algum evento inline chame por ela

// 8.4 — closeModal — alias legado de fecharArcadePorDesistencia(), mantido para compatibilidade com eventos inline no HTML
function closeModal() {
  fecharArcadePorDesistencia(false);
}

// 8.5 — handleCoinSelect — dispara o fluxo OAuth ao clicar em uma moeda.
// Facebook mobile usa redirect (skipBrowserRedirect); Google e Facebook desktop usam popup.
function handleCoinSelect(btn, provider) {
  sf2CoinSound.currentTime = 0;
  sf2CoinSound.play().catch(() => {});
  btn.classList.add("coin-inserted");

  const isMobile = window.innerWidth < 768;

  if (provider === "facebook" && isMobile) {
    supabaseClient.auth
      .signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          skipBrowserRedirect: true,
          queryParams: { display: "page" },
        },
      })
      .then(({ data, error }) => {
        if (error) {
          console.error("Erro Facebook mobile:", error);
          mostrarMensagemLED("ERRO NO SLOT FACEBOOK");
          btn.classList.remove("coin-inserted");
          return;
        }
        if (data?.url) window.location.href = data.url;
      });
    return;
  }

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
  }, 1500);
}

// 8.6 — renderAvatarGrid — monta a grade de avatares com seleção aleatória ponderada:
// 8 comuns (1-80), 5 raros (81-130), 2 lendários (131-150)
function renderAvatarGrid() {
  const grid = document.getElementById("avatarGrid");
  grid.innerHTML = "";
  const selecionados = [
    ...getRandomFromRange(1, 80, 8),
    ...getRandomFromRange(81, 130, 5),
    ...getRandomFromRange(131, 150, 2),
  ];
  selecionados.forEach((num, idx) => {
    const pathWebp = `/img/avatares/a${num.toString().padStart(2, "0")}.webp`;
    const pathPng = `/img/avatares/a${num.toString().padStart(2, "0")}.png`;
    const loadStrategy = idx < 3 ? "eager" : "lazy";
    const item = document.createElement("div");
    item.className = "avatar-item rounded-md";
    item.innerHTML = `<img src="${pathWebp}" onerror="this.onerror=null;this.src='${pathPng}'" class="avatar-img" loading="${loadStrategy}" decoding="async" width="80" height="80" alt="Avatar ${num}">`;
    item.onclick = () => {
      localStorage.setItem("retro_avatar", pathWebp);
      location.reload();
    };
    grid.appendChild(item);
  });
}

// 8.7 — getRandomFromRange — retorna N números únicos aleatórios entre min e max (inclusive).
// Auxiliar de renderAvatarGrid().
function getRandomFromRange(min, max, count) {
  const r = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return r.sort(() => Math.random() - 0.5).slice(0, count);
}

// 8.8 — updateNavWithAvatar — substitui o botão ENTRAR pelo avatar do usuário logado,
// com dropdown contendo filtros de coleção e botão de logout
function updateNavWithAvatar(avatarPath, name) {
  const firstName = name.split(" ")[0];

  document.getElementById("userArea").innerHTML = `
    <div class="flex items-center gap-1.5 md:gap-3 relative" id="avatarMenuWrapper">
      <div class="flex flex-col items-end hidden sm:flex">
        <span class="text-[10px] md:text-xs text-cyan-400 font-orbitron uppercase tracking-widest leading-none">Player 1</span>
        <span class="text-[13px] md:text-base font-bold text-white uppercase tracking-tighter leading-tight max-w-[120px] md:max-w-[180px] truncate text-right">
          ${firstName}
        </span>
      </div>

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

      <div
        id="avatarDropdown"
        class="hidden absolute top-[calc(100%+10px)] right-0 z-[200] min-w-[180px]
               bg-slate-900 border border-cyan-500/40 rounded-lg shadow-[0_0_20px_rgba(34,211,238,0.15)]
               overflow-hidden"
      >
        <div class="md:hidden px-4 py-2.5 border-b border-white/10 bg-black/30">
          <p class="font-orbitron text-[0.55rem] text-cyan-400/70 uppercase tracking-widest">Meu Quarto</p>
          <p class="font-bold text-white text-sm uppercase tracking-tight truncate">${firstName}</p>
        </div>

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

  document.getElementById("userFilters")?.classList.add("hidden");
}

// 8.9 — toggleAvatarMenu — alterna a visibilidade do dropdown do avatar na navbar
function toggleAvatarMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById("avatarDropdown");
  if (!dropdown) return;
  dropdown.classList.toggle("hidden");
  const wrapper = document.getElementById("avatarMenuWrapper");
  if (wrapper)
    wrapper.classList.toggle("is-open", !dropdown.classList.contains("hidden"));
}

// 8.10 — Listener de click global — fecha o dropdown do avatar ao clicar em qualquer área fora dele
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("avatarMenuWrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById("avatarDropdown")?.classList.add("hidden");
    wrapper.classList.remove("is-open");
  }
});

// 8.11 — logOut — faz signOut no Supabase, limpa localStorage e redireciona para a página inicial no estado deslogado
async function logOut() {
  await supabaseClient.auth.signOut();
  localStorage.removeItem("retro_avatar");
  localStorage.setItem("retro_led_boot", "logout");
  window.location.href = window.location.origin;
}

/* 3.8. GESTÃO DE DADOS (CURTIDAS E COLEÇÃO DO USUÁRIO) */

// ================================================================
// 9. MODERAÇÃO E ANTI-TOXICIDADE
// ================================================================

// 9.1 — palavrasProibidas — lista de termos banidos (política + palavrões).
// Aplicada a comentários, sugestões e nomes de usuário.
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

// 9.2 — regexProibidas — regex compilada uma única vez a partir da lista, com flags case-insensitive e word boundaries
const regexProibidas = new RegExp(
  `\\b(${palavrasProibidas.join("|")})\\b`,
  "i",
);

// 9.3 — contemPalavraProibida — retorna true se o texto passado contiver alguma palavra da lista proibida
function contemPalavraProibida(texto) {
  return regexProibidas.test(texto);
}

// ================================================================
// 10. PAINEL LED — ENGINE COMPLETA
// ================================================================

// 10.1 — Variáveis de estado do painel — ativo/inativo, fila de mensagens, flags de tilt/glitch e contador do easter egg
let ledPainelAtivo = false;
let ledFilaAtual = [];
let ledEmExibicao = false;
let ledTiltAtivo = false;
let ledGlitchSessao = false;
let ledEasterEggContador = 0;
let ledEasterEggTimer = null;

// 10.2 — LED_MENSAGENS_FAKE — pool de 20 mensagens de usuários fictícios,
// exibidas quando o feed_live do Supabase tem menos de 5 entradas reais
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
  'FEED_LIVE sobre Bandeirante: "O caminhão verde era o meu favorito"',
  'COLECIONADOR_RJ sobre Playmobil: "Ainda tenho alguns guardados na caixa original"',
  'GEEK_ANOS90 sobre Action Man Estrela: "Fiz uma corda de linha para ele descer"',
  'CRIANÇA_DE_80 sobre Scalextric: "A pista ficava no chão da sala o fim de semana inteiro"',
  'RETRÔ_GAMES sobre Nintendinho NES: "Soprava o cartucho e torcia para funcionar"',
  'MEMÓRIA_VIVA sobre Barbie Estrela: "Cortei o cabelo da minha e chorei depois"',
];

// 10.3 — LED_FRASES_SISTEMA — frases em estilo arcade intercaladas no ciclo do ticker LED
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
  "COMPARTILHE SUAS MEMÓRIAS COM SEUS BESTS!",
  "CLIQUE NO SWITCH PARA DESLIGAR ESSE PAINEL",
  "VOCÊ SE LEMBRA DESSE BRINQUEDO?",
  "REVIVA A MAGIA DA INFÂNCIA — RETROBRINQUEDOS BR",
];

// 10.4 — LED_SPRITES — personagens ASCII de jogos clássicos (Pac-Man, Pong, Space Invaders) sorteados como easter egg no LED
const LED_SPRITES = [
  " ᗧ · · · · · · ᗣ · · ᗣ · · ᗣ ",
  " ᗣ ᗣ ᗣ ᗣ · · · · · · · ᗤ ",
  " /M\\  \\o/  /M\\  \\o/       _A_ ",
  " >===>  - - - - -  (O)  {X}  [||] ",
  " |   ·             |      PONG      |             ·   | ",
  " /\\   ·  ·  ·  * O   o   . ",
  " (>'-')>  ======O      <('-'<) ",
  " ~~~|===|~~~   [H]   ~~~|===|~~~ ",
];

// 10.5 — iniciarPainelLED — configura o estado inicial do painel. Se ligado: anima a ligar e exibe a mensagem imediata.
// Configura o easter egg dos 13 cliques e o glitch aleatório da sessão (15% de chance).
function iniciarPainelLED(mensagemImediata) {
  const toggle = document.getElementById("ledToggleInput");
  if (toggle) toggle.checked = ledPainelAtivo;

  const painel = document.getElementById("ledPanel");
  if (!painel) return;

  if (ledPainelAtivo) {
    painel.classList.remove("is-off");
    animarLigar();

    if (mensagemImediata) {
      const el = document.getElementById("ledContent");
      if (el) {
        el.classList.remove("tilt-mode");
        el.textContent = mensagemImediata;
        const duracao = Math.max(
          10,
          (mensagemImediata.length * 10 + window.innerWidth) / 80,
        );
        el.style.animation = "none";
        el.offsetHeight;
        el.style.animation = `ledScroll ${duracao}s linear 1`;
        el.addEventListener("animationend", () => iniciarCicloLED(), {
          once: true,
        });
      }
    } else {
      setTimeout(() => iniciarCicloLED(), 800);
    }
  } else {
    painel.classList.add("is-off");
  }

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

  if (Math.random() < 0.15) {
    ledGlitchSessao = true;
    const delay = 15000 + Math.random() * 40000;
    setTimeout(() => dispararGlitch(4000), delay);
  }
}

// 10.6 — toggleLedPanel — liga ou desliga o painel pelo switch da navbar, persistindo a preferência no localStorage
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

// 10.7 — animarLigar — aplica a classe CSS de animação de ligar (flash verde) ao painel
function animarLigar() {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  painel.classList.remove("powering-off");
  painel.classList.add("powering-on");
  setTimeout(() => painel.classList.remove("powering-on"), 500);
}

// 10.8 — animarDesligar — anima o desligamento e executa o callback ao final da transição
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

// 10.9 — ledLocked + mostrarMensagemLED — exibe mensagem informativa curta no LED (ex: "Faça login para curtir").
// ledLocked evita sobreposição de chamadas concorrentes.
let ledLocked = false;

function mostrarMensagemLED(mensagem) {
  if (ledLocked) return;
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
  el.offsetHeight;

  el.textContent = `⚡ ${mensagem} ⚡`;
  el.classList.add("tilt-mode");
  painel.style.borderColor = "rgba(255,32,32,0.6)";
  painel.style.boxShadow =
    "0 0 16px rgba(255,32,32,0.3) inset, 0 2px 8px rgba(0,0,0,0.4)";

  let passo = 0;
  const totalPassos = 6;

  const piscadoLocked = setInterval(() => {
    el.style.opacity = el.style.opacity === "0" ? "1" : "0";
    passo++;

    if (passo >= totalPassos) {
      clearInterval(piscadoLocked);
      el.style.opacity = "1";
      ledTiltAtivo = false;
      ledLocked = false;

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
    }
  }, 850);
}

// 10.10 — dispararTilt — alerta simples no LED: 3 piscadas vermelhas. Usado para ações que exigem login (curtir, interagir).
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
  el.offsetHeight;

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
    }
  }, intervalo);
}

// 10.11 — dispararTiltBanimento — alerta severo de moderação: borda vermelha intensa,
// 2 piscadas longas e período de congelamento configurável
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
  el.offsetHeight;

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

// 10.12 — dispararGlitch — adiciona o glitch visual temporário ao painel (classe CSS glitch-line com animação de deslocamento)
function dispararGlitch(duracao = 4000) {
  const painel = document.getElementById("ledPanel");
  if (!painel) return;
  painel.classList.add("glitch-line");
  setTimeout(() => painel.classList.remove("glitch-line"), duracao);
}

// 10.13 — ledInjetarPrioritario — insere uma mensagem no início da fila atual para exibição imediata no próximo ciclo
function ledInjetarPrioritario(texto) {
  ledFilaAtual.unshift(texto);
}

// 10.14 — montarFila — compõe a fila do próximo ciclo: busca mensagens reais do feed_live,
// completa com fake se <5 reais, e adiciona sprite ou frase do sistema no final
async function montarFila() {
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
  } catch (e) {}

  const pool =
    mensagensReais.length >= 5
      ? mensagensReais
      : [...mensagensReais, ...LED_MENSAGENS_FAKE].slice(0, 20);

  const qtd = 10 + Math.floor(Math.random() * 11);
  const embaralhado = [...pool].sort(() => Math.random() - 0.5).slice(0, qtd);

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

// 10.15 — iniciarCicloLED — ponto de entrada do ciclo: monta a fila e dispara a exibição do ticker
async function iniciarCicloLED() {
  if (!ledPainelAtivo || ledTiltAtivo) return;
  ledFilaAtual = await montarFila();
  exibirProximaMensagem();
}

// 10.16 — exibirProximaMensagem — controla o fluxo da fila; reinicia um novo ciclo quando a fila esvazia
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

// 10.17 — exibirFilaComoTicker — concatena todas as mensagens da fila com separadores e anima como ticker scrollável via animação CSS ledScroll
function exibirFilaComoTicker(fila, onComplete) {
  const el = document.getElementById("ledContent");
  if (!el) return;

  const SEP =
    "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0✦\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0";
  const textoCompleto = fila.join(SEP);

  el.classList.remove("tilt-mode");
  el.textContent = textoCompleto;

  const velocidade = 80;
  const larguraEstimada = textoCompleto.length * 10;
  const duracao = Math.max(
    10,
    (larguraEstimada + window.innerWidth) / velocidade,
  );

  el.style.animation = "none";
  el.offsetHeight;
  el.style.animation = `ledScroll ${duracao}s linear 1`;

  const handler = () => {
    el.removeEventListener("animationend", handler);
    onComplete();
  };
  el.addEventListener("animationend", handler);
}

// 10.18 — feedChannel — canal Realtime do Supabase. Escuta INSERTs em feed_live
// e injeta cada nova mensagem no início da fila via ledInjetarPrioritario()
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

// ================================================================
// 11. RANKING E PÓDIO
// ================================================================

// 11.1 — Variáveis de estado do ranking — cache dos dados carregados no boot e modo ativo ("curtidas" | "visualizacoes")
let _rankingDados = null;
let _rankingModoAtivo = "curtidas"; // "curtidas" | "visualizacoes"

// Refatorada para buscar direto do banco via RPC de forma assíncrona no segundo zero

// 11.2 — _prepararDadosRanking — busca o Top 3 de curtidas e visualizações via RPC obter_podio_ranking no boot
// (em paralelo ao fetchBrinquedos) e faz prefetch silencioso das imagens
async function _prepararDadosRanking() {
  if (_rankingDados) return; // Evita requisições duplicadas se já carregado na sessão

  try {
    // Invoca a procedure SQL criada no Supabase
    const { data, error } = await supabaseClient.rpc("obter_podio_ranking");

    if (error) throw error;

    if (data) {
      _rankingDados = {
        curtidas: data.curtidas || [],
        visualizacoes: data.visualizacoes || [],
        timestamp: new Date().toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      // Prefetch silencioso em background das imagens do pódio global
      const todasImagens = [
        ..._rankingDados.curtidas,
        ..._rankingDados.visualizacoes,
      ];
      const vistas = new Set();
      for (const toy of todasImagens) {
        if (vistas.has(toy.id)) continue;
        vistas.add(toy.id);
        const url = _imagemRankingURL(toy.url_frente || "");
        if (url) {
          const img = new Image();
          img.src = url;
        }
      }
    }
  } catch (err) {
    console.error("Erro ao processar dados do pódio via RPC:", err);
    // Fallback seguro de inicialização para não quebrar a UI em caso de falha de rede
    _rankingDados = {
      curtidas: [],
      visualizacoes: [],
      timestamp: "Indisponível",
    };
  }
}

// 11.3 — _imagemRankingURL — transforma a URL do Cloudinary para thumbnail quadrado de 80×80px (c_fill, g_auto)
function _imagemRankingURL(url) {
  if (!url || !url.includes("cloudinary.com")) return url || "";
  return url.replace(
    "/upload/",
    "/upload/f_auto,q_auto,w_80,h_80,c_fill,g_auto/",
  );
}

// 11.4 — _renderizarListaRanking — popula a lista #rankingLista no modal com os dados do cache, alternando entre modo curtidas e visualizações
function _renderizarListaRanking(modo) {
  const lista = document.getElementById("rankingLista");
  const titulo = document.getElementById("rankingTitulo");
  if (!lista || !_rankingDados) return;

  const isCurtidas = modo === "curtidas";
  titulo.textContent = isCurtidas
    ? "Brinquedos mais Curtidos"
    : "Brinquedos mais Visualizados";

  const itens = _rankingDados[modo];
  lista.innerHTML = itens
    .map((toy, i) => {
      const pos = i + 1;
      const imgURL = _imagemRankingURL(toy.url_frente || "");
      const valor = isCurtidas
        ? toy.curtidas_count || 0
        : toy.visualizacoes || 0;
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
    })
    .join("");
}

// Alterada para abrir instantaneamente com base nos dados cacheados do boot

// 11.5 — abrirRankingModal — exibe o modal de pódio com os dados do cache e empilha histórico para o botão Voltar
function abrirRankingModal() {
  const modal = document.getElementById("rankingModal");
  if (!modal) return;

  _renderizarListaRanking(_rankingModoAtivo);

  const ts = document.getElementById("rankingTimestamp");
  if (ts && _rankingDados) {
    ts.textContent = "Atualizado em: " + _rankingDados.timestamp;
  }

  _sincronizarBotoesRanking(_rankingModoAtivo);

  modal.classList.remove("hidden");
  modal.classList.add("flex");

  history.pushState({ modal: "ranking" }, "");
}

// 11.6 — fecharRankingModal — fecha o modal de ranking e sincroniza a pilha de histórico
function fecharRankingModal(event, veioDoPopstate = false) {
  const modal = document.getElementById("rankingModal");
  if (!modal) return;
  if (event && event.target !== modal) return;

  modal.classList.add("hidden");
  modal.classList.remove("flex");

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 11.7 — trocarRanking — alterna entre os modos curtidas e visualizações e atualiza a lista e os botões de toggle
function trocarRanking(modo) {
  _rankingModoAtivo = modo;
  _renderizarListaRanking(modo);
  _sincronizarBotoesRanking(modo);
}

// 11.8 — _sincronizarBotoesRanking — aplica as classes CSS de ativo/inativo nos botões de toggle do modal do pódio
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

// ================================================================
// 12. MODAIS ESTÁTICOS — DISCLAIMER, FABRICANTES E SUGESTÃO
// ================================================================

// 12.1 — abrirDisclaimerModal — abre o modal de direitos autorais e empilha histórico
function abrirDisclaimerModal() {
  const modal = document.getElementById("disclaimerModal");
  if (modal) {
    modal.classList.remove("hidden");
    history.pushState({ modal: "disclaimer" }, "");
  }
}

// 12.2 — fecharDisclaimerModal — fecha o modal de disclaimer e sincroniza a pilha de histórico
function fecharDisclaimerModal(veioDoPopstate = false) {
  const modal = document.getElementById("disclaimerModal");
  if (modal) modal.classList.add("hidden");

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 12.3 — abrirFabricanteModal — abre o modal de história do fabricante (1 a 8).
// Fecha qualquer outro modal de fabricante antes de abrir o novo.
function abrirFabricanteModal(num) {
  fecharFabricanteModal(true);
  const modal = document.getElementById("fabricanteModal" + num);
  if (modal) {
    modal.classList.remove("hidden");
    history.pushState({ modal: "fabricanteModal" + num }, "");
  }
}

// 12.4 — fecharFabricanteModal — varre e fecha todos os modais de fabricante abertos (1 a 8) em uma única chamada
function fecharFabricanteModal(veioDoPopstate = false) {
  let modalEstavaAberto = false;
  for (let i = 1; i <= 8; i++) {
    const m = document.getElementById("fabricanteModal" + i);
    if (m && !m.classList.contains("hidden")) {
      m.classList.add("hidden");
      modalEstavaAberto = true;
    }
  }

  if (modalEstavaAberto && !veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 12.5 — abrirSugestaoModal — abre o modal de sugestão de brinquedo. Exige login. Pré-preenche o nome se termoPreenchido for passado.
async function abrirSugestaoModal(termoPreenchido = "") {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userLogado = sessionData?.session?.user;

  if (!userLogado) {
    dispararTiltBanimento("⚠ FAÇA LOGIN PARA SUGERIR UM ITEM", 3000);
    return;
  }

  const modal = document.getElementById("sugestaoModal");
  if (!modal) return;

  const inputNome = document.getElementById("sug_nome");
  if (inputNome && termoPreenchido) {
    inputNome.value = termoPreenchido.trim();
  }

  _sugestaoResetUI();
  modal.classList.remove("hidden");

  history.pushState({ modal: "sugestao" }, "");

  if (inputNome) setTimeout(() => inputNome.focus(), 80);
}

// 12.6 — fecharSugestaoModal — fecha o modal de sugestão, reseta o formulário e sincroniza o histórico
function fecharSugestaoModal(veioDoPopstate = false) {
  const modal = document.getElementById("sugestaoModal");
  if (modal) modal.classList.add("hidden");
  _sugestaoResetUI();

  if (!veioDoPopstate) {
    retroSincronizandoHistorico = true;
    history.back();
  }
}

// 12.7 — _sugestaoResetUI — reseta o texto de feedback e reabilita o botão de envio do formulário
function _sugestaoResetUI() {
  const feedback = document.getElementById("sugestaoFeedback");
  if (feedback) {
    feedback.textContent = "";
    feedback.className = "hidden sugestao-feedback mb-4";
  }
  const btn = document.getElementById("sugestaoEnviarBtn");
  const label = document.getElementById("sugestaoEnviarLabel");
  if (btn) btn.disabled = false;
  if (label) label.textContent = "▶ ENVIAR SUGESTÃO";
}

// 12.8 — enviarSugestao — valida os campos, modera o conteúdo, grava no Supabase e dispara e-mail de notificação
// via EmailJS. Fecha o modal e recarrega o catálogo após 2.8s.
async function enviarSugestao() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userLogado = sessionData?.session?.user;
  if (!userLogado) {
    fecharSugestaoModal();
    dispararTiltBanimento("⚠ SESSÃO EXPIRADA. FAÇA LOGIN NOVAMENTE.", 3000);
    return;
  }

  const nome = (document.getElementById("sug_nome")?.value || "").trim();
  const fabricante = (
    document.getElementById("sug_fabricante")?.value || ""
  ).trim();
  const ano = (document.getElementById("sug_ano")?.value || "").trim();
  const categoria = (
    document.getElementById("sug_categoria")?.value || ""
  ).trim();
  const tema = (document.getElementById("sug_tema")?.value || "").trim();
  const link = (document.getElementById("sug_link")?.value || "").trim();
  const obs = (document.getElementById("sug_obs")?.value || "").trim();

  const btn = document.getElementById("sugestaoEnviarBtn");
  const label = document.getElementById("sugestaoEnviarLabel");

  if (!nome) {
    _sugestaoMostrarFeedback("⚠ O nome do brinquedo é obrigatório.", "erro");
    document.getElementById("sug_nome")?.focus();
    return;
  }

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

  const usuarioNome =
    userLogado.user_metadata?.full_name || userLogado.email || "Usuário";

  try {
    const { error: dbError } = await supabaseClient.from("sugestoes").insert({
      usuario_id: userLogado.id,
      usuario_nome: usuarioNome,
      nome_brinquedo: nome,
      fabricante: fabricante || null,
      ano: ano || null,
      categoria: categoria || null,
      tema: tema || null,
      link_referencia: link || null,
      observacao: obs || null,
      status: "pendente",
    });

    if (dbError) throw dbError;

    await emailjs.send("service_v7nw2eu", "template_o5kwy8p", {
      usuario_nome: usuarioNome,
      nome_brinquedo: nome,
      fabricante: fabricante || "—",
      ano: ano || "—",
      categoria: categoria || "—",
      tema: tema || "—",
      link_referencia: link || "—",
      observacao: obs || "—",
    });

    _sugestaoMostrarFeedback(
      "✔ SUGESTÃO ENVIADA! Obrigado, " + usuarioNome.split(" ")[0] + "!",
      "sucesso",
    );
    label.textContent = "✔ ENVIADO";

    [
      "sug_nome",
      "sug_fabricante",
      "sug_ano",
      "sug_categoria",
      "sug_tema",
      "sug_link",
      "sug_obs",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    setTimeout(() => {
      fecharSugestaoModal();
      const searchInput = document.getElementById("searchInput");
      const clearBtn = document.getElementById("clearSearchBtn");
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

// 12.9 — _sugestaoMostrarFeedback — exibe mensagem de sucesso ou erro inline abaixo do formulário
function _sugestaoMostrarFeedback(mensagem, tipo) {
  const feedback = document.getElementById("sugestaoFeedback");
  if (!feedback) return;
  feedback.textContent = mensagem;
  feedback.className = `sugestao-feedback mb-4 ${tipo === "sucesso" ? "sugestao-feedback--ok" : "sugestao-feedback--erro"}`;
  feedback.classList.remove("hidden");
}

// 12.10 — Listener de tecla Escape — fecha qualquer modal estático que esteja aberto (sugestão, disclaimer, fabricantes, ranking)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    fecharSugestaoModal();
    fecharDisclaimerModal();
    fecharFabricanteModal();
    fecharRankingModal();
  }
});

// ================================================================
// 13. HISTORY API — BOTÃO VOLTAR MOBILE
// ================================================================

// 13.1 — Listener popstate — máquina de estados dos modais.
// Cada modal empilha um estado com history.pushState(). Este listener identifica qual modal está aberto
// e chama sua função de fechar ao pressionar o botão Voltar físico/gestual do mobile.
window.addEventListener("popstate", (event) => {
  if (retroSincronizandoHistorico) {
    retroSincronizandoHistorico = false;
    return;
  }

  let modalFechado = false;

  // 0. Máquina de Estados do Arcade / Login / Avatar
  const arcadeModal = document.getElementById("arcadeModal");
  if (arcadeModal && !arcadeModal.classList.contains("pointer-events-none")) {
    const gameOverScreen = document.getElementById("gameOverScreen");
    const arcadeScreen = document.getElementById("arcadeScreen");
    const selectionScreen = document.getElementById("selectionScreen");

    if (gameOverScreen && gameOverScreen.classList.contains("hidden")) {
      // Usuário estava no INSERT COIN ou SELECT PLAYER -> Vai para o GAME OVER
      if (arcadeScreen) arcadeScreen.classList.add("hidden");
      if (selectionScreen) selectionScreen.classList.add("hidden");
      gameOverScreen.classList.remove("hidden");
    } else {
      // Usuário já estava no GAME OVER e apertou voltar de novo -> Desiste e desloga
      fecharArcadePorDesistencia(true);
    }
    return;
  }

  // 1. Card Verso Mobile Modal
  const cardMobileModal = document.getElementById("cardVersoMobileModal");
  if (cardMobileModal && !cardMobileModal.classList.contains("hidden")) {
    fecharCardVersoMobile(null, true);
    modalFechado = true;
  }

  // 2. Drawer de Comentários
  const comentariosDrawer = document.getElementById("comentariosDrawer");
  if (comentariosDrawer && comentariosDrawer.classList.contains("open")) {
    fecharDrawerComentarios(true);
    modalFechado = true;
  }

  // 3. Sugestão Modal
  const sugestaoModal = document.getElementById("sugestaoModal");
  if (sugestaoModal && !sugestaoModal.classList.contains("hidden")) {
    fecharSugestaoModal(true);
    modalFechado = true;
  }

  // 4. Modais de Fabricantes (Varre todos do 1 ao 8)
  for (let i = 1; i <= 8; i++) {
    const fabModal = document.getElementById("fabricanteModal" + i);
    if (fabModal && !fabModal.classList.contains("hidden")) {
      fecharFabricanteModal(true);
      modalFechado = true;
      break;
    }
  }

  // 5. Disclaimer Modal
  const disclaimerModal = document.getElementById("disclaimerModal");
  if (disclaimerModal && !disclaimerModal.classList.contains("hidden")) {
    fecharDisclaimerModal(true);
    modalFechado = true;
  }

  // 6. Ranking Modal
  const rankingModal = document.getElementById("rankingModal");
  if (rankingModal && !rankingModal.classList.contains("hidden")) {
    fecharRankingModal(null, true);
    modalFechado = true;
  }
});

/* 3.3. INFINITE SCROLL E CHAMADAS DE API */

/* 3.3.2. Verifica se o sentinel ainda está visível após um fetch terminar
   e dispara mais um lote se necessário — cobre o gap do desktop (6 colunas) */

// ================================================================
// 14. EASTER EGGS E NOSTALGIA
// ================================================================

// 14.1 — animarBandeirasEnduro — pisca as bandeirinhas estilo Enduro (Atari 2600) ao completar um loop do catálogo,
// quando a semente é reconfigurada para a próxima rodada
function animarBandeirasEnduro() {
  const flagsImg = document.getElementById("enduroFlags");
  if (!flagsImg) return;

  console.log(
    "%c 🏎️ [EASTER EGG] Enduro Stage Clear! Piscando bandeirinhas...",
    "color: #22c55e; font-weight: bold;",
  );

  // Remove a trava de fluxo do DOM e força a imagem a começar invisível
  flagsImg.classList.remove("hidden");
  flagsImg.classList.remove("opacity-100");
  flagsImg.classList.add("opacity-0");

  let piscadas = 0;
  const maxPiscadas = 3;

  // Ciclo de pisca clássico retrô (400ms visível, 400ms invisível)
  const cicloPisca = setInterval(() => {
    if (flagsImg.classList.contains("opacity-0")) {
      flagsImg.classList.remove("opacity-0");
      flagsImg.classList.add("opacity-100");
    } else {
      flagsImg.classList.remove("opacity-100");
      flagsImg.classList.add("opacity-0");
      piscadas++;

      // Ao fechar as 3 piscadas completas na tela, desliga o circuito
      if (piscadas >= maxPiscadas) {
        clearInterval(cicloPisca);
        setTimeout(() => {
          flagsImg.classList.add("hidden"); // Devolve a propriedade oculta ao fluxo
        }, 300);
      }
    }
  }, 700);
}

// ================================================================
// ENTRY POINT — Dispara a inicialização da aplicação
// ================================================================

init();

// Hint visual nos logos de fabricantes: destaca o primeiro logo nos primeiros 6.2s
setTimeout(() => {
  const firstLogo = document.querySelector(".hero-brand-btn:first-child");
  if (firstLogo) firstLogo.classList.add("hint-done");
}, 6200);
