// =========================================================
// ML - Data do Anúncio (content script v3)
// =========================================================

const BTN_ID   = "ml-ext-btn-data";
const POPUP_ID = "ml-ext-popup-data";

let ativo = false;
let ultimoResultado = null;
let ultimaURL = location.href;
let timerLeitura = null;
let observersAtivos = [];

// ---------------------------------------------------------
// 1. Estado salvo
// ---------------------------------------------------------
chrome.storage.local.get(["ativo"], (res) => {
  ativo = !!res.ativo;
  if (ativo) iniciar();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.acao === "setAtivo") {
    ativo = msg.ativo;
    ativo ? iniciar() : parar();
  }
  if (msg.acao === "forcarLeitura") {
    lerDataAtual().then((r) => {
      ultimoResultado = r;
      atualizarPopupSeAberto();
    });
  }
});

// ---------------------------------------------------------
// 2. Iniciar / Parar
// ---------------------------------------------------------
function iniciar() {
  injetarBotao();
  observarSPA();
  observarDOM();
  setTimeout(() => agendarLeitura("inicial", 300), 500);
}

function parar() {
  document.getElementById(BTN_ID)?.remove();
  document.getElementById(POPUP_ID)?.remove();
}

// ---------------------------------------------------------
// 3. Injetar botão ao lado do carrinho (#nav-cart)
// ---------------------------------------------------------
function injetarBotao() {
  if (document.getElementById(BTN_ID)) return;

  // Alvo: <a id="nav-cart"> dentro do wrapper do menu direito
  const alvo =
    document.querySelector("#nav-cart") ||
    document.querySelector(".nav-cart") ||
    document.querySelector('a[href*="/gz/cart"]');

  if (!alvo) {
    // SPA pode ainda não ter renderizado o header — tenta de novo
    setTimeout(injetarBotao, 800);
    return;
  }

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.title = "Ver data de criação do anúncio";
  btn.setAttribute("aria-label", "Ver data de criação do anúncio");
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V9h14v10zM5 7V5h14v2H5zm3 5h8v2H8v-2zm0 4h5v2H8v-2z"/>
    </svg>
  `;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePopup();
  });

  // Insere logo após o carrinho
  alvo.insertAdjacentElement("afterend", btn);
}

// ---------------------------------------------------------
// 4. Popup flutuante
// ---------------------------------------------------------
function togglePopup() {
  const existente = document.getElementById(POPUP_ID);
  if (existente) { existente.remove(); return; }
  abrirPopup();
}

function abrirPopup() {
  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.innerHTML = `
    <div class="ml-header">
      <div class="ml-title">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V9h14v10z"/>
        </svg>
        Data do Anúncio
      </div>
      <button class="ml-close" title="Fechar" aria-label="Fechar">✕</button>
    </div>
    <div class="ml-body">
      <div class="ml-label">Publicado em</div>
      <div class="ml-data ml-loading" id="ml-ext-data">
        <span class="ml-spinner"></span> Lendo…
      </div>
      <div class="ml-meta">
        <span>Fonte: <strong id="ml-ext-fonte">—</strong></span>
        <span id="ml-ext-hora">—</span>
      </div>
      <button class="ml-refresh" id="ml-ext-refresh">↻ Ler novamente</button>
    </div>
  `;

  document.body.appendChild(popup);

  popup.querySelector(".ml-close").addEventListener("click", () => popup.remove());
  popup.querySelector("#ml-ext-refresh").addEventListener("click", async () => {
    const data = popup.querySelector("#ml-ext-data");
    data.className = "ml-data ml-loading";
    data.innerHTML = '<span class="ml-spinner"></span> Lendo…';
    ultimoResultado = await lerDataAtual();
    renderizarNoPopup(ultimoResultado, popup);
  });

  // Renderiza último resultado ou faz nova leitura
  if (ultimoResultado) {
    renderizarNoPopup(ultimoResultado, popup);
  } else {
    lerDataAtual().then((r) => {
      ultimoResultado = r;
      renderizarNoPopup(r, popup);
    });
  }
}

function atualizarPopupSeAberto() {
  const popup = document.getElementById(POPUP_ID);
  if (popup) renderizarNoPopup(ultimoResultado, popup);
}

function renderizarNoPopup(res, popup) {
  const dataEl  = popup.querySelector("#ml-ext-data");
  const fonteEl = popup.querySelector("#ml-ext-fonte");
  const horaEl  = popup.querySelector("#ml-ext-hora");

  dataEl.className = "ml-data";

  if (!res || !res.data) {
    dataEl.classList.add("ml-erro");
    dataEl.textContent = "❌ 'start_date' não encontrada nesta página.";
    fonteEl.textContent = "—";
  } else {
    dataEl.textContent = res.data;
    fonteEl.textContent = res.fonte || "—";
  }
  horaEl.textContent = new Date().toLocaleTimeString("pt-BR");

  // Atualiza badge no botão
  const btn = document.getElementById(BTN_ID);
  if (btn) btn.classList.toggle("ml-has-data", !!(res && res.data));
}

// ---------------------------------------------------------
// 5. Leitura da data (JSON-LD → regex)
// ---------------------------------------------------------
function lerDataAtual() {
  return new Promise((resolve) => {
    // 1) JSON-LD (fonte oficial)
    const jsonLds = document.querySelectorAll('script[type="application/ld+json"]');
    for (const tag of jsonLds) {
      try {
        const dados = JSON.parse(tag.textContent);
        const lista = Array.isArray(dados) ? dados : [dados];
        for (const item of lista) {
          // Aceita tanto {start_date} quanto {datePublished}
          const bruto = item?.start_date || item?.datePublished;
          if (bruto) {
            resolve({ data: formatar(bruto), fonte: "JSON-LD" });
            return;
          }
        }
      } catch (_) { /* tenta próximo */ }
    }

    // 2) Regex no HTML
    const html = document.documentElement.innerHTML;
    const m = html.match(/start_date["'\s:]+([^"',}\s]+)/i);
    if (m) {
      resolve({ data: formatar(m[1]), fonte: "HTML" });
      return;
    }

    resolve({ data: null, fonte: null });
  });
}

function formatar(bruto) {
  const d = new Date(bruto);
  if (isNaN(d)) return bruto;
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// ---------------------------------------------------------
// 6. Releitura automática — SPA + DOM
// ---------------------------------------------------------
function observarSPA() {
  if (observarSPA._ok) return;
  observarSPA._ok = true;

  const disparar = () => {
    if (location.href !== ultimaURL) {
      ultimaURL = location.href;
      agendarLeitura("URL mudou", 700);
    }
  };

  window.addEventListener("popstate", disparar);
  window.addEventListener("hashchange", disparar);

  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function () { push.apply(this, arguments); disparar(); };
  history.replaceState = function () { replace.apply(this, arguments); disparar(); };
}

function observarDOM() {
  if (observarDOM._ok) return;
  observarDOM._ok = true;

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Detecta bloco do produto ou do JSON-LD recém-inserido
        if (
          node.matches?.('script[type="application/ld+json"]') ||
          node.querySelector?.('script[type="application/ld+json"]') ||
          node.matches?.(".ui-pdp-container, .ui-pdp-main") ||
          node.querySelector?.(".ui-pdp-container, .ui-pdp-main")
        ) {
          agendarLeitura("conteúdo do produto", 700);
          return;
        }
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
  observersAtivos.push(obs);
}

function agendarLeitura(motivo, delay = 600) {
  clearTimeout(timerLeitura);
  timerLeitura = setTimeout(async () => {
    const res = await lerDataAtual();
    ultimoResultado = res;
    atualizarPopupSeAberto();
    console.log(`[ML Ext] Releitura (${motivo}):`, res);
  }, delay);
}