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

const sentinel = document.createElement("div");
sentinel.id = "scrollSentinel";
sentinel.className =
  "w-full h-10 col-span-full mt-4 opacity-0 pointer-events-none";

/* 3.3. INFINITE SCROLL E CHAMADAS DE API */

/* 3.3.1. Função de requisição do Supabase/Vercel API */
async function fetchBrinquedos(reset = false) {
  if (isLoading || (!hasMais && !reset)) return;
  isLoading = true;

  if (reset) {
    cursor = 0;
    allToys = [];
    hasMais = true;
    document.getElementById("toyGrid").innerHTML = "";
  }

  try {
    if (buscaAtiva.length >= 2) {
      // Usa RPC nativa do banco para buscas via texto
      const { data: itens, error: rpcError } = await supabaseClient.rpc(
        "buscar_brinquedos_search",
        { termo_busca: buscaAtiva, cursor_val: cursor, limite_val: LIMITE },
      );
      if (rpcError) throw rpcError;
      if (itens && itens.length > 0) {
        allToys = [...allToys, ...itens];
        cursor = cursor + itens.length;
        hasMais = itens.length === LIMITE;
        render(itens, !reset);
      } else {
        hasMais = false;
      }
    } else {
      // Chama API Node (Vercel) padrão
      const res = await fetch(
        `/api/brinquedos?cursor=${cursor}&limite=${LIMITE}&seed=${sessionSeed}`,
      );
      if (!res.ok) throw new Error("Falha na API");
      const data = await res.json();
      if (reset && data.total)
        document.getElementById("heroCount").textContent = data.total;
      if (data.itens && data.itens.length > 0) {
        allToys = [...allToys, ...data.itens];
        cursor = data.cursor;
        hasMais = data.temMais;
        render(data.itens, !reset);
      } else {
        hasMais = false;
      }
    }
  } catch (error) {
    console.error("Erro na carga:", error);
  } finally {
    isLoading = false;
    verificarSentinela();
  }
}

/* 3.3.2. Verifica momento exato de disparar mais chamadas */
function verificarSentinela() {
  if (hasMais && document.getElementById("toyGrid").children.length > 0) {
    setTimeout(() => {
      const rect = sentinel.getBoundingClientRect();
      if (rect.top > 0 && rect.top < window.innerHeight + 600)
        fetchBrinquedos();
    }, 150);
  }
}

/* 3.3.3. Monta o vigia de scroll dinâmico */
function setupObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !isLoading && hasMais) fetchBrinquedos();
    },
    { rootMargin: "800px" },
  );
  document.querySelector("main").appendChild(sentinel);
  observer.observe(sentinel);
}

/* 3.4. RENDERIZAÇÃO DO DOM (Componentes Visuais) */

let currentCols = 0;
let columnElements = [];
let nextColIndex = 0;

/* 3.4.1. Define colunas do grid pelo tamanho da tela */
function getColumnCount() {
  const width = window.innerWidth;
  if (width >= 1536) return 6;
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 640) return 3;
  return 2;
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

/* 3.4.3. Monta e insere os cards 3D no HTML */
function render(items, append = false) {
  const grid = document.getElementById("toyGrid");
  const targetCols = getColumnCount();

  if (!append || currentCols !== targetCols) {
    grid.innerHTML = "";
    columnElements = [];
    currentCols = targetCols;
    nextColIndex = 0;
    for (let i = 0; i < currentCols; i++) {
      const colDiv = document.createElement("div");
      colDiv.className = "masonry-column";
      grid.appendChild(colDiv);
      columnElements.push(colDiv);
    }
  }

  items.forEach((toy) => {
    const idNormalizado = String(toy.id).padStart(4, "0");
    const ledHTML = buildLedDisplay(toy.raridade);
    const isLiked = curtidasDoUsuario.has(idNormalizado);
    const isTive = tiveDoUsuario.has(idNormalizado);
    const isQueria = queriaDoUsuario.has(idNormalizado);
    const trunfoCode = toy.codigo_trunfo || "A1";

    const cardHTML = `
    <div class="masonry-item card-enter" id="card-${idNormalizado}">
      <div class="card-inner" onclick="handleFlip('${idNormalizado}')">
        <div class="card-front">
          <img src="${toy.url_frente}" alt="${toy.nome}" class="w-full h-auto block" loading="lazy">
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
              <img src="${toy.url_verso}" alt="${toy.nome} verso" class="trunfo-photo" loading="lazy">
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
          
          <div class="px-2 py-2 bg-[#050505] border-t border-white/5 flex flex-nowrap gap-2 items-center" onclick="event.stopPropagation()">
              <span class="text-[#39ff14] font-orbitron text-[0.55rem] shrink-0">></span>
              <input type="text" id="comentario-input-${idNormalizado}" class="flex-1 bg-transparent border-b border-[#39ff14]/20 text-white text-[0.6rem] px-1 py-1 outline-none font-mono placeholder-slate-700 focus:border-[#39ff14] transition-colors w-0" placeholder="Mensagem..." onkeypress="handleComentarioEnter(event, '${idNormalizado}', '${toy.nome}')" onclick="event.stopPropagation()" ${!isLiked && !isTive && !isQueria ? 'disabled placeholder="Interaja..."' : ""}>
              <button onclick="enviarComentario('${idNormalizado}', '${toy.nome}'); event.stopPropagation();" class="text-cyan-400 hover:text-pink-500 font-orbitron text-[0.55rem] tracking-tighter uppercase font-bold shrink-0 whitespace-nowrap">SEND</button>
          </div>

          <div class="trunfo-footer">
            <span class="trunfo-footer-logo">RETROBRINQUEDOS</span>
            <div class="like-container">
              <button id="heart-btn-${idNormalizado}" class="heart-btn ${isLiked ? "liked" : ""}" onclick="toggleCurtida(event, '${idNormalizado}')" aria-label="Curtir">
                <svg class="heart-svg" viewBox="0 0 14 15" xmlns="http://www.w3.org/2000/svg"><path d="M4 5V3H6V5H8V3H10V5H12V9H10V11H8V13H6V11H4V9H2V5Z" /></svg>
                <div class="heart-tooltip">Faça login para curtir</div>
              </button>
              <span class="like-count" id="count-${idNormalizado}">${toy.curtidas_count || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    columnElements[nextColIndex].insertAdjacentHTML("beforeend", cardHTML);
    nextColIndex = (nextColIndex + 1) % currentCols;
  });
}

/* 3.5. MECÂNICA DE INTERAÇÃO (Flip e Desfocar) */

/* 3.5.1. Vira o card com cálculo de scroll */
function handleFlip(id) {
  const grid = document.getElementById("toyGrid");
  const card = document.getElementById(`card-${id}`);
  const isFlipped = card.classList.contains("is-flipped");

  document
    .querySelectorAll(".masonry-item")
    .forEach((c) => c.classList.remove("is-flipped"));

  if (!isFlipped) {
    card.classList.add("is-flipped");
    grid.classList.add("grid-focused");
    const yOffset = -80;
    const y = card.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: "smooth" });
  } else {
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

/* 3.6. BUSCA INTELIGENTE (Debounce e Trigger) */
let buscaAtiva = "";
let debounceTimer = null;

document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    buscaAtiva = term;
    cursor = 0;
    allToys = [];
    hasMais = true;
    document.getElementById("toyGrid").innerHTML = "";
    fetchBrinquedos(true);
  }, 300);
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
  document.getElementById("userArea").innerHTML = `
    <div class="flex items-center gap-3 md:gap-4">
      <div class="flex flex-col items-end">
        <span class="text-[10px] md:text-xs text-cyan-400 font-orbitron uppercase tracking-widest">Player 1</span>
        <span class="text-sm md:text-base font-bold text-white uppercase tracking-tighter">${name}</span>
      </div>
      <div class="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-cyan-400 overflow-hidden bg-slate-900 shadow-[0_0_10px_rgba(34,211,238,0.4)]">
        <img src="${avatarPath}" class="w-full h-full object-contain">
      </div>
      <button onclick="logOut()" class="bg-pink-600 text-white px-6 py-2 rounded-full text-xs font-bold hover:bg-cyan-400 hover:text-slate-900 transition transform hover:scale-105 uppercase tracking-wider shadow-lg shadow-pink-900/50 ml-2">Sair</button>
    </div>`;
}

async function logOut() {
  await supabaseClient.auth.signOut();
  localStorage.removeItem("retro_avatar");
  window.location.href = window.location.origin;
}

/* 3.8. GESTÃO DE DADOS (CURTIDAS E COLEÇÃO DO USUÁRIO) */

/* 3.8.1. Puxa perfil e preenche as Memórias Visuais (Sets) */
async function carregarInteracoesDoBanco(userId) {
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
  } catch (e) {
    console.error("Erro no banco:", e);
  }
}

/* 3.8.2. Commits Otimistas (Altera local e envia pro banco) */
async function toggleCurtida(event, brinquedoId) {
  event.stopPropagation();
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) return;

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
  if (!session) return;

  const userId = session.user.id;
  const idParaBanco = String(brinquedoId).padStart(4, "0");
  let memorySet, tableName, activeClass;

  if (tipo === "tive") {
    memorySet = tiveDoUsuario;
    tableName = "interacoes_tive";
    activeClass = "active-tive";
  } else {
    memorySet = queriaDoUsuario;
    tableName = "interacoes_queria";
    activeClass = "active-queria";
  }

  const isAtivo = memorySet.has(idParaBanco);
  const btn = document.getElementById(`btn-${tipo}-${idParaBanco}`);
  const countSpan = document.getElementById(`count-${tipo}-${idParaBanco}`);
  let count = parseInt(countSpan ? countSpan.innerText : "0") || 0;

  if (isAtivo) {
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

/* 3.9. REALTIME CHAT (SUPABASE WEBSOCKETS) */

let chatNotificacoesNaoLidas = 0;

/* 3.9.1. Controle do Drawer e Visibilidade */
function toggleChatPanel() {
  const panel = document.getElementById("chatPanel");
  const badge = document.getElementById("chatBadge");
  const btn = document.getElementById("chatToggleBtn");

  panel.classList.toggle("is-closed");

  if (!panel.classList.contains("is-closed")) {
    chatNotificacoesNaoLidas = 0;
    if (badge) {
      badge.classList.add("hidden");
      badge.innerText = "0";
    }
    if (btn)
      btn.classList.remove(
        "border-pink-500",
        "shadow-[0_0_15px_rgba(255,0,255,0.4)]",
      );
  }
}

/* 3.9.2. Inscrição para receber atualizações do banco */
const feedChannel = supabaseClient.channel("museu-feed");
feedChannel
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "feed_live" },
    (payload) => {
      renderNovaMensagem(payload.new, true);
    },
  )
  .subscribe();

/* 3.9.3. Desenha os balões de texto e alerta a UI (Glow) */
function renderNovaMensagem(msg, isNova = true) {
  const feed = document.getElementById("chatFeed");
  if (!feed) return;
  if (feed.innerText.includes("Aguardando transmissões")) feed.innerHTML = "";

  const dataHora = new Date(msg.created_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const msgHTML = `
    <div class="border-l-2 border-[#39ff14]/30 pl-2 py-1 mb-1 animate-[cardFadeIn_0.3s_ease-out]">
      <div class="text-[0.45rem] md:text-[0.5rem] text-[#39ff14]/60 mb-0.5 font-orbitron">[${dataHora}] DATA.LINK</div>
      <div class="text-[#39ff14] leading-tight">
        <span class="font-bold text-white">${msg.usuario_nome}</span> ${msg.acao} <span class="text-cyan-400 font-bold">${msg.brinquedo_nome}</span>
        ${msg.detalhe ? `<br><span class="text-pink-400 block mt-1">"${msg.detalhe}"</span>` : ""}
      </div>
    </div>`;

  feed.insertAdjacentHTML("beforeend", msgHTML);
  feed.scrollTop = feed.scrollHeight;

  const panel = document.getElementById("chatPanel");
  if (isNova && panel && panel.classList.contains("is-closed")) {
    chatNotificacoesNaoLidas++;
    const badge = document.getElementById("chatBadge");
    const btn = document.getElementById("chatToggleBtn");
    if (badge) {
      badge.innerText =
        chatNotificacoesNaoLidas > 99 ? "99+" : chatNotificacoesNaoLidas;
      badge.classList.remove("hidden");
    }
    if (btn)
      btn.classList.add(
        "border-pink-500",
        "shadow-[0_0_15px_rgba(255,0,255,0.4)]",
        "text-white",
      );
  }
}

/* 3.9.4. Resgata e desenha mensagens antigas */
async function carregarHistoricoFeed() {
  const { data, error } = await supabaseClient
    .from("feed_live")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(15);
  if (!error && data)
    data.reverse().forEach((msg) => renderNovaMensagem(msg, false));
}
carregarHistoricoFeed();

/* 3.9.5. Rotinas de Envio de Novas Mensagens do front pro backend */
async function enviarComentario(idNormalizado, nomeBrinquedo) {
  if (!isUserLogged) {
    login();
    return;
  }
  const input = document.getElementById(`comentario-input-${idNormalizado}`);
  const texto = input ? input.value.trim() : "";
  if (!texto) return;

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) return;

  const userName = session.user.user_metadata.full_name || "Player 1";
  input.value = ""; // Otimista

  const { error } = await supabaseClient
    .from("feed_live")
    .insert([
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
  }
}

function handleComentarioEnter(event, idNormalizado, nomeBrinquedo) {
  if (event.key === "Enter") {
    event.preventDefault();
    enviarComentario(idNormalizado, nomeBrinquedo);
  }
}

/* 3.10. INICIALIZAÇÃO DA APLICAÇÃO (BOOT) */

/* 3.10.1. Adapta o layout para mudanças de tela limpas */
let resizeTimer;
window.addEventListener("resize", () => {
  resetarEstadoDosCards();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (allToys && allToys.length > 0) render(allToys, false);
  }, 250);
});

/* 3.10.2. Chama Auth, recupera tokens e desenha primeira página */
async function init() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (session) {
    isUserLogged = true;
    document.body.classList.remove("app-unlogged");
    const userName = session.user.user_metadata.full_name || "Player 1";

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

  setupObserver();
  await fetchBrinquedos(true);
}

init();
