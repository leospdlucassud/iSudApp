/** Utilitários de data, número e texto. Sem dependência de DOM. */

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID()
                    : Date.now().toString(36) + Math.random().toString(36).slice(2);

/* ---------------------------------------------------------------------------
   Datas

   Tudo circula como 'YYYY-MM-DD' em horário local. Nada de `new Date(iso)`
   sem hora: isso interpreta a string como UTC e no Brasil volta um dia.
--------------------------------------------------------------------------- */

/** @param {Date} d @returns {string} 'YYYY-MM-DD' */
export function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** @param {string} s 'YYYY-MM-DD' @returns {Date} meia-noite local */
export function deISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const hoje = () => iso(new Date());

/** Todos os domingos do ano, em ordem. Base do histórico anual. */
export function domingosDoAno(ano) {
  const out = [];
  const d = new Date(ano, 0, 1);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // primeiro domingo
  while (d.getFullYear() === ano) {
    out.push(iso(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

/** Domingos de um mês — as linhas do lançamento semanal. */
export function domingosDoMes(ano, mes) {
  const out = [];
  const d = new Date(ano, mes, 1);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  while (d.getMonth() === mes) {
    out.push(iso(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

/** Todos os dias de um mês, com dia da semana. */
export function diasDoMes(ano, mes) {
  const total = new Date(ano, mes + 1, 0).getDate();
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(ano, mes, i + 1);
    return { data: iso(d), dia: i + 1, dow: d.getDay() };
  });
}

/**
 * Domingo que FECHA a semana de uma data.
 *
 * A semana do relatório termina no domingo em que ele é preenchido, então a
 * data cai no domingo seguinte (ou nela mesma, se já for domingo).
 *
 * Conferido contra a planilha de março/2025: batismo no sábado 01/03 e
 * confirmação no domingo 02/03 aparecem os dois na linha de 02/03. Fechar a
 * semana no domingo anterior jogaria o batismo para a semana errada.
 */
export function domingoDaSemana(dataISO) {
  const d = deISO(dataISO);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return iso(d);
}

/** Índice do domingo dentro do ano (1-based), ou 0 se a data não for domingo. */
export function semanaDoAno(dataISO) {
  const lista = domingosDoAno(deISO(dataISO).getFullYear());
  return lista.indexOf(dataISO) + 1;
}

/** Quantos dias separam duas datas ISO (b - a). */
export function diasEntre(a, b) {
  return Math.round((deISO(b) - deISO(a)) / 86400000);
}

export function somaDias(dataISO, n) {
  const d = deISO(dataISO);
  d.setDate(d.getDate() + n);
  return iso(d);
}

const FMT_CURTO = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const FMT_LONGO = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const FMT_DIA   = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

export const dataCurta = (s) => (s ? FMT_CURTO.format(deISO(s)) : '—');
export const dataLonga = (s) => (s ? FMT_LONGO.format(deISO(s)) : '—');
export const nomeDoDia = (s) => (s ? FMT_DIA.format(deISO(s)) : '');

/* ---------------------------------------------------------------------------
   Números
--------------------------------------------------------------------------- */

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const soma = (arr, fn = (x) => x) => arr.reduce((t, x) => t + num(fn(x)), 0);

/** Variação percentual de `de` para `para`. `null` quando não há base. */
export function variacao(de, para) {
  const a = num(de), b = num(para);
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / a) * 100;
}

export const pct = (parte, total) => (num(total) === 0 ? 0 : (num(parte) / num(total)) * 100);

export const arred = (n, casas = 0) => {
  const f = 10 ** casas;
  return Math.round(num(n) * f) / f;
};

/* ---------------------------------------------------------------------------
   Texto
--------------------------------------------------------------------------- */

/** Normaliza para busca: minúsculo, sem acento. */
export const chave = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export const comparaNome = (a, b) => chave(a).localeCompare(chave(b), 'pt-BR');

/** Agrupa por chave. @returns {Record<string, T[]>} */
export function agrupar(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ??= []).push(x);
  return out;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
