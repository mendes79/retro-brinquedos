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
const sessionSeed = Math.random();
let isUserLogged = false;
let curtidasDoUsuario = new Set();
let tiveDoUsuario = new Set();
let queriaDoUsuario = new Set();
let currentCols = 0;
let columnElements = [];
let filtroAtivo = "todos"; // 'todos', 'tive', 'queria', 'curtidas'

const sentinel = document.createElement("div");
sentinel.id = "scrollSentinel";
sentinel.className =
  "w-full h-10 col-span-full mt-4 opacity-0 pointer-events-none";

/* 3.3. INFINITE SCROLL E CHAMADAS DE API */

/* 3.3.2. Verifica se o sentinel ainda está visível após um fetch terminar
   e dispara mais um lote se necessário — cobre o gap do desktop (6 colunas) */
function verificarSentinela() {
  if (!hasMais) return;
  // Aguarda o browser pintar os novos cards antes de medir
  requestAnimationFrame(() => {
    const rect = sentinel.getBoundingClientRect();
    // ✅ Margem generosa: cobre mesmo telas 4K com 6 colunas
    if (rect.top < window.innerHeight + 1200 && !isLoading) {
      fetchBrinquedos();
    }
  });
}

/* 3.11.1. Monta o vigia de scroll dinâmico (único ponto de disparo) */
function setupObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      // isIntersecting garante que só dispara quando realmente visível
      if (entries[0].isIntersecting && !isLoading && hasMais) {
        fetchBrinquedos();
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

async function fetchBrinquedos(reset = false) {
  if (isLoading || (!hasMais && !reset)) return;
  isLoading = true;

  const grid = document.getElementById("toyGrid");

  // --- 1. FASE DE PREPARAÇÃO (EXIBIÇÃO DOS SKELETONS) ---
  if (reset) {
    cursor = 0;
    allToys = [];
    hasMais = true;

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
        filtroAtivo === "tive"   ? tiveDoUsuario :
        filtroAtivo === "queria" ? queriaDoUsuario :
                                   curtidasDoUsuario;

      const idsFiltro = [...setAtivo];

      // Se o Set estiver vazio, não há nada a buscar
      if (idsFiltro.length === 0) {
        if (reset) grid.innerHTML = "";
        document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
        grid.innerHTML = `
          <div class="col-span-full text-center py-20">
            <p class="text-pink-500 font-retro text-xl">NENHUM ITEM AQUI AINDA</p>
            <p class="text-slate-500 font-orbitron text-xs mt-2">
              ${filtroAtivo === "tive"    ? "MARQUE OS BRINQUEDOS QUE VOCÊ TEVE" :
                filtroAtivo === "queria"  ? "MARQUE OS BRINQUEDOS QUE VOCÊ QUERIA TER" :
                                            "CURTA OS BRINQUEDOS QUE VOCÊ AMOU"}
            </p>
          </div>`;
        hasMais = false;
        return; // Sai do try, vai pro finally
      }

      // Busca todos os itens do filtro de uma vez (sem paginação — coleção pessoal
      // raramente terá centenas de itens)
      const { data, error: filtroError } = await supabaseClient
        .from("brinquedos")
        .select("*")
        .in("id", idsFiltro.map((id) => parseInt(id, 10)));

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
    const idsEmMemoria = new Set(allToys.map((t) => String(t.id).padStart(4, "0")));
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
      grid.innerHTML = `
        <div class="col-span-full text-center py-20">
          <p class="text-pink-500 font-retro text-xl">NENHUM ITEM ENCONTRADO</p>
          <p class="text-slate-500 font-orbitron text-xs mt-2">VERIFIQUE O TERMO OU SUA COLEÇÃO</p>
        </div>`;
      hasMais = false;
    } else {
      hasMais = false;
    }
  } catch (error) {
    console.error("Erro na carga:", error);
    // Limpeza de emergência em caso de falha na rede
    if (reset)
      grid.innerHTML =
        "<p class='text-center col-span-full text-pink-500 font-retro'>ERRO DE CONEXÃO COM O ARQUIVO</p>";
    document.querySelectorAll(".temp-skeleton").forEach((el) => el.remove());
  } finally {
    isLoading = false;
    // Delay para garantir que o DOM se estabilizou
    setTimeout(verificarSentinela, 300);
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
          <div class="trunfo-header">
            <div class="trunfo-top-bar">
              <span>Super Trunfo • RetroBrinquedos</span>
              <span class="trunfo-code-badge">${trunfoCode}</span>
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
            <div class="trunfo-stat-row"><span class="trunfo-label">Fabricante</span><span class="trunfo-value">${toy.fabricante}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Categoria</span><span class="trunfo-value">${toy.categoria}</span></div>
            <div class="trunfo-stat-row"><span class="trunfo-label">Tema</span><span class="trunfo-value">${toy.tema}</span></div>
            <div class="trunfo-raridade-area">
              <div class="trunfo-raridade-header">
                <span class="trunfo-raridade-label">⬡ Raridade</span>
                <span class="trunfo-raridade-value">${toy.raridade}/10</span>
              </div>
              ${ledHTML}
            </div>
            <div class="trunfo-curiosidade">"${toy.curiosidade}"</div>
            
            <div class="trunfo-actions-area">
              <button id="btn-tive-${idNormalizado}" class="action-btn ${isTive ? "active-tive" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'tive')">
                <span class="action-label">Eu Tive</span>
                <span class="action-count" id="count-tive-${idNormalizado}">${toy.tive_count || 0}</span>
              </button>
              <button id="btn-queria-${idNormalizado}" class="action-btn ${isQueria ? "active-queria" : ""}" onclick="toggleInteracao(event, '${idNormalizado}', 'queria')">
                <span class="action-label">Queria Ter</span>
                <span class="action-count" id="count-queria-${idNormalizado}">${toy.queria_count || 0}</span>
              </button>
            </div>
          </div>
          
          <div class="comment-area px-2 py-2 bg-[#050505] border-t border-white/5 flex flex-nowrap gap-2 items-center" onclick="event.stopPropagation()">
              <span class="chat-arrow text-[#39ff14] font-orbitron text-[0.55rem] shrink-0">></span>
              <input 
                type="text" 
                id="comentario-input-${idNormalizado}" 
                name="comentario-${idNormalizado}" 
                autocomplete="off" 
                maxlength="140" 
                class="chat-input flex-1 bg-transparent border-b border-[#39ff14]/20 text-white text-[0.6rem] px-1 py-1 outline-none font-mono placeholder-slate-700 focus:border-[#39ff14] transition-colors w-0" 
                placeholder="Mensagem..." 
                onkeypress="handleComentarioEnter(event, '${idNormalizado}', '${toy.nome}')" 
                ${!isUserLogged ? 'disabled placeholder="Faça login..."' : ""}
              >
              <button onclick="enviarComentario('${idNormalizado}', '${toy.nome}'); event.stopPropagation();" class="chat-send-btn text-cyan-400 hover:text-pink-500 font-orbitron text-[0.55rem] tracking-tighter uppercase font-bold shrink-0" ${!isUserLogged ? "disabled" : ""}>SEND</button>
          </div>

          <div class="trunfo-footer">
            <span class="trunfo-footer-logo">RETROBRINQUEDOS</span>
            <div class="like-container">
              <button id="heart-btn-${idNormalizado}" class="heart-btn ${isLiked ? "liked" : ""}" onclick="toggleCurtida(event, '${idNormalizado}')">
                <svg class="heart-svg" viewBox="0 0 14 15" xmlns="http://www.w3.org/2000/svg"><path d="M4 5V3H6V5H8V3H10V5H12V9H10V11H8V13H6V11H4V9H2V5Z" /></svg>
                <div class="heart-tooltip">Faça login para curtir</div>
              </button>
              <span class="like-count" id="count-${idNormalizado}">${toy.curtidas_count || 0}</span>
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

    // 💡 A NOVA SOLUÇÃO: Esperamos dois frames de animação em vez de um.
    // Isso dá tempo para o navegador processar o 'height: auto' da imagem
    // inserida e atualizar o offsetHeight da coluna de forma precisa.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }
}

/* 3.5. MECÂNICA DE INTERAÇÃO (Flip e Desfocar) */

/* 3.5.1. Vira o card com cálculo de scroll dinâmico */
function handleFlip(id) {
  // 🛡️ ESCUDO DE FOCO MOBILE (Anti-Bubbling Nativo)
  // Verifica onde o usuário tocou antes de tentar girar a carta
  const evento = window.event;
  if (evento && evento.target) {
    const tag = evento.target.tagName.toLowerCase();

    // Se tocou em um campo de texto, botão, SVG (ícones) ou dentro da área do chat, ABORTA o giro!
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

  const grid = document.getElementById("toyGrid");
  const card = document.getElementById(`card-${id}`);
  const isFlipped = card.classList.contains("is-flipped");

  // Trava de propagação (Missclick de fundo)
  if (grid.classList.contains("grid-focused") && !isFlipped) {
    return;
  }

  // Remove a classe de todas as cartas
  document
    .querySelectorAll(".masonry-item")
    .forEach((c) => c.classList.remove("is-flipped"));

  // Se não estava virada, vira agora e ajusta o scroll
  if (!isFlipped) {
    card.classList.add("is-flipped");
    grid.classList.add("grid-focused");

    // 📏 CÁLCULO DINÂMICO DE ALTURA DO CABEÇALHO
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
    // Se já estava virada, fecha e tira o foco do grid
    grid.classList.remove("grid-focused");
  }
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
  document
    .querySelectorAll(".masonry-item")
    .forEach((card) => card.classList.remove("is-flipped"));
}

/* 3.6. BUSCA INTELIGENTE (Debounce e Trigger - Versão Blindada) */
let buscaAtiva = "";
let debounceTimer = null;

document.getElementById("searchInput").addEventListener("input", (e) => {
  // ✅ Normalização imediata para evitar problemas de Case-Sensitive
  const term = e.target.value.trim().toLowerCase();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // ✅ Bloqueia disparos redundantes se o termo for idêntico ao anterior
    if (term === buscaAtiva) return;

    // Atualiza o estado global da busca
    buscaAtiva = term;

    // ✅ Forçamos o reset das variáveis de paginação antes de chamar o fetch
    cursor = 0;
    allToys = [];
    hasMais = true;

    // Chama a carga principal com a flag de reset ativada
    fetchBrinquedos(true);
  }, 600); // 600ms de respiro para estabilizar o processo anterior
});

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

function handleCoinSelect(btn, provider) {
  sf2CoinSound.currentTime = 0;
  sf2CoinSound.play().catch(() => {});
  btn.classList.add("coin-inserted");
  setTimeout(async () => {
    await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  }, 1500);
}

function renderAvatarGrid() {
  const grid = document.getElementById("avatarGrid");
  grid.innerHTML = "";
  const selecionados = [
    ...getRandomFromRange(1, 80, 8),
    ...getRandomFromRange(81, 130, 5),
    ...getRandomFromRange(131, 150, 2),
  ];
  selecionados.forEach((num) => {
    const path = `/img/avatares/a${num.toString().padStart(2, "0")}.png`;
    const item = document.createElement("div");
    item.className = "avatar-item rounded-md";
    item.innerHTML = `<img src="${path}" class="avatar-img">`;
    item.onclick = () => {
      localStorage.setItem("retro_avatar", path);
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
        <img src="${avatarPath}" class="w-full h-full object-contain" alt="avatar">
      </button>

      <!-- Dropdown retrô -->
      <div
        id="avatarDropdown"
        class="hidden absolute top-[calc(100%+10px)] right-0 z-[200] min-w-[180px]
               bg-slate-900 border border-cyan-500/40 rounded-lg shadow-[0_0_20px_rgba(34,211,238,0.15)]
               overflow-hidden"
      >
        <!-- Cabeçalho do menu -->
        <div class="px-4 py-2.5 border-b border-white/10 bg-black/30">
          <p class="font-orbitron text-[0.55rem] text-cyan-400/70 uppercase tracking-widest">Meu Quarto</p>
          <p class="font-bold text-white text-sm uppercase tracking-tight truncate">${firstName}</p>
        </div>

        <!-- Itens de filtro -->
        <div class="py-1">
          <button onclick="filtrarMeuQuarto('todos'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-white hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5">
            <span class="text-base">🕹</span> Todos
          </button>
          <button onclick="filtrarMeuQuarto('tive'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-white hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5">
            <span class="text-base">🏆</span> Fui Dono
          </button>
          <button onclick="filtrarMeuQuarto('queria'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-white hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5">
            <span class="text-base">⭐</span> Queria Ter
          </button>
          <button onclick="filtrarMeuQuarto('curtidas'); toggleAvatarMenu()" class="dropdown-filter-item w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-300 hover:text-white hover:bg-cyan-500/10 transition-colors flex items-center gap-2.5">
            <span class="text-base">❤️</span> Favoritos
          </button>
        </div>

        <!-- Separador + Sair -->
        <div class="border-t border-white/10">
          <button onclick="logOut()" class="w-full text-left px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-pink-400 hover:text-white hover:bg-pink-600/20 transition-colors flex items-center gap-2.5">
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
}

/* Fecha o dropdown ao clicar fora dele */
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("avatarMenuWrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById("avatarDropdown")?.classList.add("hidden");
  }
});

async function logOut() {
  await supabaseClient.auth.signOut();
  localStorage.removeItem("retro_avatar");
  window.location.href = window.location.origin;
}

/* 3.8. GESTÃO DE DADOS (CURTIDAS E COLEÇÃO DO USUÁRIO) */

/* 3.8.1. Puxa perfil e preenche as Memórias Visuais (Sets) */
async function carregarInteracoesDoBanco(userId, tentativa = 1) {
  try {
    const [resCurtidas, resTive, resQueria] = await Promise.all([
      supabaseClient.from("curtidas").select("brinquedo_id").eq("usuario_id", userId),
      supabaseClient.from("interacoes_tive").select("brinquedo_id").eq("usuario_id", userId),
      supabaseClient.from("interacoes_queria").select("brinquedo_id").eq("usuario_id", userId),
    ]);

    // 🛡️ RETRY: Se qualquer query falhar e ainda temos tentativas, aguarda e tenta novamente.
    // Evita Sets vazios causados por cold start do Supabase ou token recém-renovado.
    const houveErro = resCurtidas.error || resTive.error || resQueria.error;
    if (houveErro && tentativa < 3) {
      console.warn(`carregarInteracoes: tentativa ${tentativa} falhou, retentando...`);
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

    console.log(`✅ Interações carregadas — Tive: ${tiveDoUsuario.size} | Queria: ${queriaDoUsuario.size} | Curtidas: ${curtidasDoUsuario.size}`);
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

  // 🛡️ FIX 1.3: Limpa o estado de flip ANTES de reconstruir o grid.
  // Sem isso, o `grid-focused` fica preso no DOM da sessão anterior
  // e bloqueia o flip de todos os cards do novo filtro.
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
  "JOGADOR_77 curtiu He-Man Masters of Universe",
  "CAROL_BH marcou EU TIVE em Estrela Júpiter",
  "MARCOS_SP marcou QUERIA TER em Robocop Estrela",
  "NERD_RETRÔ curtiu Tartarugas Ninja Glasslite",
  "ALINE_RJ marcou EU TIVE em Boneca Susi Estrela",
  "RETROGAMER marcou QUERIA TER em Super Nintendo",
  "PEDRO_MG curtiu Hot Wheels Mattel Anos 90",
  "TURMA_80s marcou EU TIVE em Falcon Gulliver",
  "CLASSICO_BR curtiu Transformers Estrela",
  "RAINHA_90s marcou QUERIA TER em Polly Pocket",
  "NINTENDISTA curtiu Duck Hunt Nintendo",
  "PLAYER_DOS_8BITS marcou EU TIVE em Atari 2600",
  "NOSTALGIA_SP curtiu Lego Fabuland anos 80",
  "RETROWAVE marcou QUERIA TER em Street Fighter Glasslite",
  "FELIPPE_BH curtiu Brinquedo da Bandeirante",
  "COLECIONADOR_RJ marcou EU TIVE em Playmobil",
  "GEEK_ANOS90 curtiu Action Man Estrela",
  "CRIANÇA_DE_80 marcou QUERIA TER em Scalextric",
  "RETRÔ_GAMES curtiu Nintendinho NES",
  "MEMÓRIA_VIVA marcou EU TIVE em Barbie Estrela anos 80",
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
function iniciarPainelLED() {
  const toggle = document.getElementById("ledToggleInput");
  if (toggle) toggle.checked = ledPainelAtivo;

  const painel = document.getElementById("ledPanel");
  if (!painel) return;

  if (ledPainelAtivo) {
    painel.classList.remove("is-off");
    animarLigar();
    setTimeout(() => iniciarCicloLED(), 800);
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
          `${m.usuario_nome.toUpperCase()} ${m.acao} ${m.brinquedo_nome}${m.detalhe ? ' — "' + m.detalhe + '"' : ""}`,
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
      const unique = [...new Map(allToys.map((t) => [String(t.id).padStart(4, "0"), t])).values()];
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

  // 🛡️ setupObserver() antes do fetch para que o IntersectionObserver
  // já esteja ativo quando os cards forem inseridos no DOM.
  setupObserver();
  await fetchBrinquedos(true);
  ajustarPainelLED();
  iniciarPainelLED();
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

init();