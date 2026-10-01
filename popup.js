const toggle       = document.getElementById("toggleExtensao");
const statusText   = document.getElementById("statusText");
const btnVerificar = document.getElementById("btnVerificar");
const resultado    = document.getElementById("resultado");
const dataEl       = document.getElementById("dataEncontrada");
const fonteEl      = document.getElementById("fonte");

// Restaura estado
chrome.storage.local.get(["ativo"], (res) => {
  const ativo = !!res.ativo;
  toggle.checked = ativo;
  atualizarUI(ativo);
});

// Alterna ativação
toggle.addEventListener("change", async () => {
  const ativo = toggle.checked;
  await chrome.storage.local.set({ ativo });
  atualizarUI(ativo);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { acao: "setAtivo", ativo }).catch(() => {});
  }
});

function atualizarUI(ativo) {
  statusText.textContent = ativo ? "Ativada" : "Desativada";
  statusText.style.color = ativo ? "#00A650" : "#888";
  btnVerificar.disabled = !ativo;
  if (!ativo) resultado.classList.add("hidden");
}

// Verificar agora
btnVerificar.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes("mercadolivre.com.br")) {
    resultado.classList.remove("hidden");
    dataEl.textContent = "⚠️ Abra uma página do Mercado Livre.";
    dataEl.style.color = "#b00020";
    fonteEl.textContent = "—";
    return;
  }

  dataEl.textContent = "Lendo…";
  dataEl.style.color = "#666";
  resultado.classList.remove("hidden");

  try {
    // Pede ao content script para reler
    await chrome.tabs.sendMessage(tab.id, { acao: "forcarLeitura" }).catch(() => {});

    // Fallback: executa direto na aba
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: buscarStartDate
    });

    if (result && result.data) {
      dataEl.textContent = result.data;
      dataEl.style.color = "#2D3277";
      fonteEl.textContent = "Fonte: " + (result.fonte || "—");
    } else {
      dataEl.textContent = "❌ Nenhuma 'start_date' encontrada.";
      dataEl.style.color = "#b00020";
      fonteEl.textContent = "—";
    }
  } catch (err) {
    dataEl.textContent = "Erro: " + err.message;
    dataEl.style.color = "#b00020";
  }
});

// ---------- Função injetada na página ----------
function buscarStartDate() {
  // JSON-LD
  const tags = document.querySelectorAll('script[type="application/ld+json"]');
  for (const tag of tags) {
    try {
      const dados = JSON.parse(tag.textContent);
      const lista = Array.isArray(dados) ? dados : [dados];
      for (const item of lista) {
        const bruto = item?.start_date || item?.datePublished;
        if (bruto) {
          const d = new Date(bruto);
          const fmt = isNaN(d)
            ? bruto
            : d.toLocaleString("pt-BR", {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit"
              });
          return { data: fmt, fonte: "JSON-LD" };
        }
      }
    } catch (_) {}
  }
  // Regex
  const m = document.documentElement.innerHTML.match(/start_date["'\s:]+([^"',}\s]+)/i);
  if (m) {
    const d = new Date(m[1]);
    const fmt = isNaN(d)
      ? m[1]
      : d.toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        });
    return { data: fmt, fonte: "HTML" };
  }
  return { data: null, fonte: null };
}