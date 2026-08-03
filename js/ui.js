/** Primitivos de interface: seleção, escape, tema, fonte, toast e modal. */

export const $  = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Escapa texto para interpolação segura em template de HTML. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cria um elemento. `attrs.class`, `attrs.dataset` e `on*` são tratados. */
export function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

/* ---------------------------------------------------------------------------
   Tema e tamanho de fonte
--------------------------------------------------------------------------- */

const CH_TEMA  = 'om_tema';
const CH_FONTE = 'om_fonte';
const FONTES = [14, 15, 16, 18, 20, 22];

export function temaAtual() {
  return localStorage.getItem(CH_TEMA)
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function aplicarTema(t = temaAtual()) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(CH_TEMA, t);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0a1422' : '#12294a';
  return t;
}

export const alternarTema = () => aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');

export function fonteAtual() {
  const n = Number(localStorage.getItem(CH_FONTE));
  return FONTES.includes(n) ? n : 16;
}

export function aplicarFonte(px = fonteAtual()) {
  document.documentElement.style.setProperty('--fs', `${px}px`);
  localStorage.setItem(CH_FONTE, String(px));
  return px;
}

/** @param {1|-1} passo @returns {{px:number, min:boolean, max:boolean}} */
export function ajustarFonte(passo) {
  const i = Math.min(FONTES.length - 1, Math.max(0, FONTES.indexOf(fonteAtual()) + passo));
  const px = aplicarFonte(FONTES[i]);
  return { px, min: i === 0, max: i === FONTES.length - 1 };
}

/* ---------------------------------------------------------------------------
   Toast
--------------------------------------------------------------------------- */

function pilhaDeToasts() {
  let p = $('.toasts');
  if (!p) document.body.append((p = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
  return p;
}

/** @param {'ok'|'err'|'warn'|''} tom */
export function toast(msg, tom = '', ms = 3200) {
  const t = el('div', { class: `toast${tom ? ` toast--${tom}` : ''}` }, msg);
  pilhaDeToasts().append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, ms);
  return t;
}

/* ---------------------------------------------------------------------------
   Modal

   Devolve uma Promise: resolve com o retorno de `aoConfirmar` (ou `true`),
   ou com `null` se o usuário cancelar. Se `aoConfirmar` lançar, o modal
   permanece aberto e o erro vira toast — o padrão que a validação de
   formulário precisa.
--------------------------------------------------------------------------- */

let modalAberto = null;

/**
 * @param {object} o
 * @param {string} o.titulo
 * @param {string|Node} o.corpo
 * @param {string} [o.confirmar] rótulo do botão; `null` esconde o botão
 * @param {string} [o.cancelar]
 * @param {'primary'|'danger'} [o.tom]
 * @param {() => any} [o.aoConfirmar]
 */
export function modal({ titulo, corpo, confirmar = 'Salvar', cancelar = 'Cancelar', tom = 'primary', aoConfirmar }) {
  fecharModal();

  return new Promise((resolve) => {
    const box = el('div', { class: 'modal__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo });

    const btnFechar = el('button', { class: 'btn btn--icon btn--ghost', 'aria-label': 'Fechar' }, '✕');
    const btnCancel = cancelar && el('button', { class: 'btn btn--ghost' }, cancelar);
    const btnOk     = confirmar && el('button', { class: `btn btn--${tom}` }, confirmar);

    box.append(
      el('div', { class: 'modal__head' }, el('h3', { class: 'modal__title' }, titulo), btnFechar),
      el('div', { class: 'modal__body' }, typeof corpo === 'string' ? el('div', { html: corpo }) : corpo),
      (btnCancel || btnOk) && el('div', { class: 'modal__foot' }, btnCancel, btnOk),
    );

    const overlay = el('div', { class: 'modal' }, box);

    const encerrar = (valor) => {
      document.removeEventListener('keydown', aoTeclar);
      overlay.remove();
      modalAberto = null;
      resolve(valor);
    };
    const aoTeclar = (e) => { if (e.key === 'Escape') encerrar(null); };

    btnFechar.addEventListener('click', () => encerrar(null));
    btnCancel?.addEventListener('click', () => encerrar(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) encerrar(null); });
    document.addEventListener('keydown', aoTeclar);

    btnOk?.addEventListener('click', async () => {
      if (!aoConfirmar) return encerrar(true);
      btnOk.disabled = true;
      try {
        encerrar((await aoConfirmar()) ?? true);
      } catch (err) {
        btnOk.disabled = false;
        toast(err?.message || 'Não foi possível salvar.', 'err');
      }
    });

    document.body.append(overlay);
    modalAberto = { overlay, encerrar };
    setTimeout(() => $('input, select, textarea, button', box)?.focus(), 60);
  });
}

export function fecharModal() {
  modalAberto?.encerrar(null);
}

/** Confirmação simples. @returns {Promise<boolean>} */
export async function confirmar(titulo, mensagem, { confirmar: rotulo = 'Confirmar', tom = 'danger' } = {}) {
  const r = await modal({
    titulo,
    corpo: el('p', { class: 'muted' }, mensagem),
    confirmar: rotulo,
    tom,
  });
  return r === true;
}

/* ---------------------------------------------------------------------------
   Blocos reaproveitados
--------------------------------------------------------------------------- */

export function vazio(titulo, mensagem, icone = '📭') {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icone),
    el('div', { class: 'empty__title' }, titulo),
    el('div', { class: 'empty__msg' }, mensagem),
  );
}

export function carregando(linhas = 3) {
  return el('div', { class: 'stack' },
    ...Array.from({ length: linhas }, () =>
      el('div', { class: 'skeleton', style: 'height:2.75rem' })),
  );
}

/** Indicador de estado da sincronização. */
export function conexao(estado = 'sync') {
  const rotulos = { live: 'Sincronizado', sync: 'Conectando…', off: 'Offline' };
  return el('span', { class: `conn conn--${estado}` },
    el('span', { class: 'conn__dot' }),
    rotulos[estado] ?? estado,
  );
}
