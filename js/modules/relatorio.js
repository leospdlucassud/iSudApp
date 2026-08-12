/**
 * Relatório de Progresso — só o LMA.
 *
 * Reproduz a planilha "Relatório de Progresso" com três correções de regra:
 *
 *  1. Frequência sacramental é da ALA. Na planilha ela era digitada quatro
 *     vezes, idêntica, uma por área — e nunca entrava na soma. Aqui é lançada
 *     uma vez por domingo.
 *  2. Progredindo, Batismos e Confirmações deixam de ser digitados: saem das
 *     listas nominais, que é onde a informação acionável já existe.
 *  3. Entra o sexto indicador-chave do PMG 2023 — membros novos na sacramental
 *     — que faltava na planilha. Virá do módulo Caminho do Convênio.
 *
 * O consolidado da ala continua sendo a soma das áreas ativas, como era.
 */

import {
  ALA, AREAS_PADRAO, FAIXAS, FUNIL, INDICADORES, INDICADORES_CHAVE,
  FREQUENCIA, MESES, ORGANIZACOES, SUBCAMPOS, corDaArea, faixaEtaria,
} from '../config.js';
import {
  cartaoIndicador, colunasEmpilhadas, funil, linhas, mapaCalor,
  moldura, n, tabelaSimples,
} from '../charts.js';
import {
  comparaNome, dataCurta, deISO, domingoDaSemana, domingosDoAno, domingosDoMes,
  hoje, num, soma, variacao,
} from '../util.js';
import { novosNaSacramental } from '../regras.js';
import { confirmar, el, modal, toast, vazio } from '../ui.js';

const COL_SEM  = 'relatorio_semanal';
const COL_FREQ = 'frequencia_ala';
const COL_BAT  = 'batismos';
const COL_PROG = 'progredindo';
const COL_CAM_PESSOAS = 'caminho_pessoas';
const COL_CAM_FREQ    = 'caminho_frequencia';

/** Indicadores que o LMA digita. O resto é derivado. */
const MANUAIS = INDICADORES.filter(i => !i.derivado);

let ctx, raiz;
let aba = 'lancamento';
let ano = new Date().getFullYear();
let mes = new Date().getMonth();
let areaSel = null;
let indicadorGrafico = 'novas_pessoas';

let areas = [], semanais = [], frequencias = [], batismos = [], progredindo = [];
let caminhoPessoas = [], caminhoFrequencia = [];

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;
  await recarregar();
  areaSel ??= areas[0]?.id;
  pintar();
}

async function recarregar() {
  const [as, sm, fq, bt, pr, cp, cf] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar(COL_SEM),
    ctx.db.listar(COL_FREQ),
    ctx.db.listar(COL_BAT),
    ctx.db.listar(COL_PROG),
    ctx.db.listar(COL_CAM_PESSOAS),
    ctx.db.listar(COL_CAM_FREQ),
  ]);
  areas = (as.length ? as : AREAS_PADRAO).filter(a => a.ativa !== false);
  semanais = sm;
  frequencias = fq;
  batismos = bt;
  progredindo = pr;
  caminhoPessoas = cp;
  caminhoFrequencia = cf;
}

/* ---------------------------------------------------------------------------
   Leitura e agregação
--------------------------------------------------------------------------- */

const chaveCampo = (ind, sub) => (ind.split ? `${ind.key}_${sub}` : ind.key);

const linhaDe = (data, areaId) => semanais.find(r => r.data === data && r.area_id === areaId);

/** Valor de um indicador numa área e semana. Derivados saem das listas nominais. */
function valor(data, areaId, indKey, sub = 'total') {
  if (indKey === 'progredindo') {
    return progredindo.filter(p => p.data === data && p.area_id === areaId).length;
  }
  if (indKey === 'batismos' || indKey === 'confirmacoes') {
    const campo = indKey === 'batismos' ? 'data_batismo' : 'data_confirmacao';
    const alcanca = batismos.filter(b =>
      b.area_id === areaId && b[campo] && domingoDaSemana(b[campo]) === data);
    if (sub === 'total')   return alcanca.length;
    // "Homens" na planilha é homem ADULTO, não sexo masculino: um menino de 8
    // anos é masculino e conta zero nessa coluna.
    if (sub === 'homens')  return alcanca.filter(b => faixaEtaria(b.idade, b.sexo) === 'homens').length;
    if (sub === 'casados') return alcanca.filter(b => b.familia_completa).length;
  }
  if (indKey === 'novos_sacramental') {
    return novosNaSacramental(data, areaId, caminhoPessoas, caminhoFrequencia);
  }

  const r = linhaDe(data, areaId);
  const ind = INDICADORES.find(i => i.key === indKey);
  return num(r?.[chaveCampo(ind, sub)]);
}

/** Consolidado da ala: soma das áreas ativas. Frequência jamais entra aqui. */
function valorAla(data, indKey, sub = 'total') {
  return soma(areas, a => valor(data, a.id, indKey, sub));
}

const frequenciaDe = (data) => {
  const f = frequencias.find(x => x.data === data);
  return f ? num(f.valor) : null;
};

/** Total de um indicador num conjunto de domingos, na ala inteira. */
const totalNoPeriodo = (domingos, indKey) =>
  soma(domingos, d => valorAla(d, indKey) ?? 0);

/** A semana tem algum lançamento em qualquer área? */
const semanaTemDados = (d) =>
  semanais.some(r => r.data === d) ||
  frequencias.some(f => f.data === d) ||
  progredindo.some(p => p.data === d) ||
  caminhoFrequencia.some(f => f.domingo === d) ||
  batismos.some(b => [b.data_batismo, b.data_confirmacao].some(x => x && domingoDaSemana(x) === d));

/**
 * Domingos do ano até o último com lançamento.
 *
 * Sem isso o gráfico de um ano encerrado arrasta meses vazios até dezembro e
 * achata a parte que tem dado.
 */
function domingosLancados(anoRef) {
  const todos = domingosDoAno(anoRef).filter(d => d <= hoje());
  let ultimo = -1;
  todos.forEach((d, i) => { if (semanaTemDados(d)) ultimo = i; });
  return ultimo < 0 ? [] : todos.slice(0, ultimo + 1);
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

const ABAS = [
  { id: 'lancamento',  rotulo: '✍️ Lançamento' },
  { id: 'consolidado', rotulo: '📋 Consolidado' },
  { id: 'graficos',    rotulo: '📈 Gráficos' },
  { id: 'batismos',    rotulo: '💧 Batismos' },
  { id: 'progredindo', rotulo: '🌱 Progredindo' },
];

function pintar() {
  const paineis = {
    lancamento:  painelLancamento,
    consolidado: painelConsolidado,
    graficos:    painelGraficos,
    batismos:    painelBatismos,
    progredindo: painelProgredindo,
  };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '📊 Relatório de Progresso'),
      el('p', {}, 'Indicadores semanais por área e o consolidado da ala.'),
    ),
    el('div', { class: 'chips', style: 'margin-bottom:1rem' },
      ...ABAS.map(a => el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(aba === a.id),
        onclick: () => { aba = a.id; pintar(); },
      }, a.rotulo)),
    ),
    paineis[aba](),
  );
}

/** Seletor de mês, usado por vários painéis. */
function barraDeMes(extra) {
  return el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Mês anterior',
      onclick: () => { const d = new Date(ano, mes - 1, 1); ano = d.getFullYear(); mes = d.getMonth(); pintar(); } }, '‹'),
    el('strong', { style: 'min-width:9rem;text-align:center' }, `${MESES[mes]} ${ano}`),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Próximo mês',
      onclick: () => { const d = new Date(ano, mes + 1, 1); ano = d.getFullYear(); mes = d.getMonth(); pintar(); } }, '›'),
    extra,
  );
}

/* ---------------------------------------------------------------------------
   Lançamento
--------------------------------------------------------------------------- */

function painelLancamento() {
  const domingos = domingosDoMes(ano, mes);
  const area = areas.find(a => a.id === areaSel) ?? areas[0];
  if (!area) return vazio('Nenhuma área ativa', 'Cadastre as áreas em Configurações.', '🗺️');

  const seletorArea = el('select', { class: 'select', style: 'max-width:14rem',
    onchange: (e) => { areaSel = e.target.value; pintar(); } },
    ...areas.map(a => el('option', { value: a.id, selected: a.id === area.id }, a.nome)));

  // Cabeçalho de duas faixas: indicador em cima, C/H/T embaixo.
  const topo = el('tr', {}, el('th', { rowspan: 2 }, 'Domingo'));
  const base = el('tr', {});
  for (const ind of MANUAIS) {
    if (ind.split) {
      topo.append(el('th', { colspan: 3, class: 'center' }, ind.abbr));
      for (const sc of SUBCAMPOS) base.append(el('th', { class: 'center', title: sc.label }, sc.abbr));
    } else {
      topo.append(el('th', { rowspan: 2, class: 'center', title: ind.label }, ind.abbr));
    }
  }
  topo.append(el('th', { rowspan: 2, class: 'center', title: FREQUENCIA.label }, 'Freq. ala'));

  const corpo = el('tbody', {}, ...domingos.map(d => linhaLancamento(d, area)));

  return el('div', {},
    barraDeMes(el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Área:'), seletorArea)),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' },
          el('span', { class: 'dot', style: `background:${corDaArea(area.cor ?? 0)};margin-right:.5rem` }),
          area.nome),
        el('span', { class: 'small muted' }, 'salva ao sair do campo'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' }, el('thead', {}, topo, base), corpo)),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Derivados — não se digita aqui')),
      el('div', { class: 'card__body' },
        el('div', { class: 'table-wrap' },
          el('table', { class: 'table' },
            el('thead', {}, el('tr', {},
              el('th', {}, 'Domingo'), el('th', { class: 'center' }, 'Progredindo'),
              el('th', { class: 'center' }, 'Batismos'), el('th', { class: 'center' }, 'Confirmações'),
              el('th', { class: 'center' }, 'Membros novos na sacramental'))),
            el('tbody', {}, ...domingos.map(d => el('tr', {},
              el('td', {}, dataCurta(d)),
              el('td', { class: 'num' }, n(valor(d, area.id, 'progredindo'))),
              el('td', { class: 'num' }, n(valor(d, area.id, 'batismos'))),
              el('td', { class: 'num' }, n(valor(d, area.id, 'confirmacoes'))),
              el('td', { class: 'num' }, n(valor(d, area.id, 'novos_sacramental'))),
            ))),
          )),
        el('p', { class: 'small muted', style: 'margin-top:.75rem' },
          'Progredindo vem da aba Progredindo; batismos e confirmações, da aba Batismos; ' +
          'membros novos na sacramental vem do Caminho do Convênio, contando quem foi ' +
          'batizado nos 12 meses anteriores àquele domingo e teve presença marcada.'),
      )),
  );
}

function linhaLancamento(data, area) {
  const tr = el('tr', {}, el('td', { class: 'nowrap' }, dataCurta(data)));

  for (const ind of MANUAIS) {
    const subs = ind.split ? SUBCAMPOS.map(s => s.key) : [null];
    for (const sub of subs) {
      tr.append(el('td', {}, campoNumero({
        valor: valor(data, area.id, ind.key, sub ?? 'total'),
        rotulo: `${ind.label}${sub ? ` — ${sub}` : ''} em ${dataCurta(data)}`,
        aoSalvar: (v) => salvarSemanal(data, area.id, chaveCampo(ind, sub), v),
      })));
    }
  }

  tr.append(el('td', {}, campoNumero({
    valor: frequenciaDe(data),
    rotulo: `Frequência da ala em ${dataCurta(data)}`,
    aoSalvar: (v) => salvarFrequencia(data, v),
  })));
  return tr;
}

function campoNumero({ valor: v, rotulo, aoSalvar }) {
  const inp = el('input', {
    class: 'input input--num', type: 'number', min: '0', inputmode: 'numeric',
    style: 'width:4rem;padding:.3125rem',
    'aria-label': rotulo,
    value: v == null || v === 0 ? '' : String(v),
  });
  inp.addEventListener('change', async () => {
    try {
      await aoSalvar(inp.value === '' ? 0 : Math.max(0, Number(inp.value)));
      inp.classList.remove('input--erro');
    } catch (err) {
      inp.classList.add('input--erro');
      toast(err.message || 'Não foi possível salvar.', 'err');
    }
  });
  return inp;
}

// Gravam pela chave única numa operação só. Decidir entre inserir e atualizar
// no cliente abria uma janela: dois campos preenchidos em sequência rápida
// numa semana ainda inexistente disparavam dois INSERT, e o segundo perdia o
// valor digitado com erro de unicidade.
async function salvarSemanal(data, areaId, campo, v) {
  await ctx.db.gravarNaChave(COL_SEM, { data, area_id: areaId, [campo]: v });
  await recarregar();
}

async function salvarFrequencia(data, v) {
  await ctx.db.gravarNaChave(COL_FREQ, { data, valor: v });
  await recarregar();
}

/* ---------------------------------------------------------------------------
   Consolidado
--------------------------------------------------------------------------- */

function painelConsolidado() {
  const domingos = domingosDoMes(ano, mes);

  const topo = el('tr', {}, el('th', { rowspan: 2 }, 'Domingo'));
  const base = el('tr', {});
  for (const ind of INDICADORES) {
    if (ind.split) {
      topo.append(el('th', { colspan: 3, class: 'center' }, ind.abbr));
      for (const sc of SUBCAMPOS) base.append(el('th', { class: 'center' }, sc.abbr));
    } else {
      topo.append(el('th', { rowspan: 2, class: 'center', title: ind.label }, ind.abbr));
    }
  }
  topo.append(el('th', { rowspan: 2, class: 'center' }, 'Freq. ala'));

  const celulas = (d) => {
    const tds = [];
    for (const ind of INDICADORES) {
      for (const sub of (ind.split ? SUBCAMPOS.map(s => s.key) : ['total'])) {
        const v = valorAla(d, ind.key, sub);
        tds.push(el('td', { class: v == null ? 'num muted' : 'num' }, v == null ? '—' : n(v)));
      }
    }
    const f = frequenciaDe(d);
    tds.push(el('td', { class: f == null ? 'num muted' : 'num' }, f == null ? '—' : n(f)));
    return tds;
  };

  const rodape = el('tr', {}, el('td', {}, 'Total do mês'));
  for (const ind of INDICADORES) {
    for (const sub of (ind.split ? SUBCAMPOS.map(s => s.key) : ['total'])) {
      rodape.append(el('td', { class: 'num' }, n(soma(domingos, d => valorAla(d, ind.key, sub)))));
    }
  }
  // Frequência não soma: a média do mês é a leitura que faz sentido.
  const freqs = domingos.map(frequenciaDe).filter(v => v != null);
  rodape.append(el('td', { class: 'num', title: 'média dos domingos com lançamento' },
    freqs.length ? `${n(soma(freqs) / freqs.length)} méd.` : '—'));

  return el('div', {},
    barraDeMes(),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' },
          `${ALA.nome} — soma de ${areas.length} área${areas.length === 1 ? '' : 's'}`),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportarCSV }, '⬇ CSV'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, topo, base),
          el('tbody', {}, ...domingos.map(d => el('tr', {}, el('td', { class: 'nowrap' }, dataCurta(d)), ...celulas(d)))),
          el('tfoot', {}, rodape),
        )),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Por área no mês')),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Área'),
            ...INDICADORES.map(i => el('th', { class: 'center', title: i.label }, i.abbr)))),
          el('tbody', {}, ...areas.map(a => el('tr', {},
            el('td', {}, el('span', { class: 'dot', style: `background:${corDaArea(a.cor ?? 0)};margin-right:.5rem` }), a.nome),
            ...INDICADORES.map(i =>
              el('td', { class: 'num' }, n(soma(domingos, d => valor(d, a.id, i.key))))),
          ))),
        )),
    ),
  );
}

function exportarCSV() {
  const domingos = domingosDoMes(ano, mes);
  const cab = ['Domingo', 'Área'];
  for (const ind of INDICADORES) {
    if (ind.split) for (const sc of SUBCAMPOS) cab.push(`${ind.label} - ${sc.label}`);
    else cab.push(ind.label);
  }
  cab.push(FREQUENCIA.label);

  const linhasCSV = [];
  for (const d of domingos) {
    for (const a of [...areas, { id: null, nome: 'ALA QUEIMADOS' }]) {
      const ler = (k, s) => (a.id ? valor(d, a.id, k, s) : valorAla(d, k, s));
      const linha = [dataCurta(d), a.nome];
      for (const ind of INDICADORES) {
        for (const sub of (ind.split ? SUBCAMPOS.map(s => s.key) : ['total'])) {
          const v = ler(ind.key, sub);
          linha.push(v == null ? '' : v);
        }
      }
      linha.push(a.id ? '' : (frequenciaDe(d) ?? ''));
      linhasCSV.push(linha);
    }
  }

  const csv = [cab, ...linhasCSV]
    .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `relatorio-${ano}-${String(mes + 1).padStart(2, '0')}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV gerado.', 'ok');
}

/* ---------------------------------------------------------------------------
   Gráficos
--------------------------------------------------------------------------- */

function painelGraficos() {
  const domingosAno = domingosLancados(ano);
  const doMes = domingosDoMes(ano, mes);
  const mesAnterior = new Date(ano, mes - 1, 1);
  const doMesAnterior = domingosDoMes(mesAnterior.getFullYear(), mesAnterior.getMonth());

  const ind = INDICADORES.find(i => i.key === indicadorGrafico) ?? INDICADORES[0];

  // Uma só faixa de filtros acima de tudo que ela controla.
  const filtros = el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano--; pintar(); } }, '‹'),
    el('strong', { style: 'min-width:4rem;text-align:center' }, String(ano)),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano++; pintar(); } }, '›'),
    el('span', { class: 'small muted', style: 'margin-left:.75rem' }, 'Mês:'),
    el('select', { class: 'select', style: 'max-width:9rem', onchange: (e) => { mes = Number(e.target.value); pintar(); } },
      ...MESES.map((m, i) => el('option', { value: i, selected: i === mes }, m))),
    el('span', { class: 'small muted', style: 'margin-left:.75rem' }, 'Indicador:'),
    el('select', { class: 'select', style: 'max-width:16rem', onchange: (e) => { indicadorGrafico = e.target.value; pintar(); } },
      ...INDICADORES.map(i => el('option', { value: i.key, selected: i.key === indicadorGrafico }, i.label))),
  );

  return el('div', {},
    filtros,
    cartoesChave(doMes, doMesAnterior, domingosAno),
    graficoPorArea(ind, domingosAno),
    graficoFunil(doMes),
    graficoBatismos(),
    graficoCalor(ind),
  );
}

function cartoesChave(doMes, doMesAnterior, domingosAno) {
  const ultimos12 = domingosAno.slice(-12);

  return el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
    ...INDICADORES_CHAVE.map((ind, i) => {
      const atual = totalNoPeriodo(doMes, ind.key);
      const antes = totalNoPeriodo(doMesAnterior, ind.key);
      return cartaoIndicador({
        rotulo: `${ind.pmg}. ${ind.label}`,
        valor: atual,
        variacao: variacao(antes, atual),
        serie: ultimos12.map(d => valorAla(d, ind.key)),
        cor: corDaArea(i),
      });
    }),
  );
}

function graficoPorArea(ind, domingosAno) {
  const ateHoje = domingosAno;
  const rotulos = ateHoje.map(dataCurta);
  const series = areas.map(a => ({
    nome: a.nome,
    cor: corDaArea(a.cor ?? 0),
    valores: ateHoje.map(d => valor(d, a.id, ind.key) ?? 0),
  }));

  if (!ateHoje.length) {
    return moldura({ titulo: ind.label, figura: vazio('Sem domingos', `Nada lançado em ${ano}.`, '📈') });
  }

  return moldura({
    titulo: `${ind.label} por área`,
    descricao: `Domingos de ${ano} até hoje. Cada área mantém sua cor em todos os gráficos.`,
    figura: linhas({ categorias: rotulos, series }),
    series,
    tabela: () => tabelaSimples(
      ['Domingo', ...areas.map(a => a.nome), 'Ala'],
      ateHoje.map(d => [dataCurta(d), ...areas.map(a => n(valor(d, a.id, ind.key))), n(valorAla(d, ind.key))]),
    ),
  });
}

function graficoFunil(doMes) {
  const etapas = FUNIL.map(f => ({
    rotulo: f.label,
    valor: f.key === 'batizados'
      ? totalNoPeriodo(doMes, 'batismos')
      : totalNoPeriodo(doMes, f.key),
  }));

  return moldura({
    titulo: 'Funil de conversão',
    descricao: `${MESES[mes]} de ${ano}, ala inteira. A porcentagem compara com a etapa anterior.`,
    figura: funil(etapas),
    tabela: () => tabelaSimples(['Etapa', 'Pessoas'], etapas.map(e => [e.rotulo, n(e.valor)])),
  });
}

function graficoBatismos() {
  const doAno = batismos.filter(b => b.data_batismo && deISO(b.data_batismo).getFullYear() === ano);
  const series = FAIXAS.map(f => ({
    nome: f.label,
    cor: corDaArea(f.cor),
    valores: MESES.map((_, m) =>
      doAno.filter(b => deISO(b.data_batismo).getMonth() === m && faixaEtaria(b.idade, b.sexo) === f.key).length),
  }));

  const temAlgo = series.some(s => s.valores.some(v => v > 0));

  return moldura({
    titulo: 'Batismos por mês',
    descricao: 'Faixa derivada de idade e sexo: Primária abaixo de 12, Rapazes e Moças de 12 a 17, Homens e Mulheres a partir de 18.',
    figura: temAlgo
      ? colunasEmpilhadas({ categorias: MESES.map(m => m.slice(0, 3)), series })
      : vazio('Nenhum batismo registrado', `Cadastre na aba Batismos para ver o gráfico de ${ano}.`, '💧'),
    series: temAlgo ? series : [],
    tabela: temAlgo ? () => tabelaSimples(
      ['Mês', ...FAIXAS.map(f => f.label), 'Total'],
      MESES.map((m, i) => [m, ...series.map(s => n(s.valores[i])), n(soma(series, s => s.valores[i]))]),
    ) : null,
  });
}

function graficoCalor(ind) {
  const recentes = domingosLancados(ano).slice(-16);
  if (!recentes.length || !areas.length) return el('span');

  const valores = areas.map(a => recentes.map(d => valor(d, a.id, ind.key) ?? 0));

  return moldura({
    titulo: `${ind.label} — semana × área`,
    descricao: 'Últimos 16 domingos lançados. Mais escuro é mais alto.',
    figura: mapaCalor({
      colunas: recentes.map(dataCurta),
      linhas: areas.map(a => a.nome),
      valores,
      rotuloValor: ind.label,
    }),
    tabela: () => tabelaSimples(
      ['Área', ...recentes.map(dataCurta)],
      areas.map((a, i) => [a.nome, ...valores[i].map(n)]),
    ),
  });
}

/* ---------------------------------------------------------------------------
   Registro de batismos
--------------------------------------------------------------------------- */

function painelBatismos() {
  const doAno = batismos
    .filter(b => b.data_batismo && deISO(b.data_batismo).getFullYear() === ano)
    .sort((a, b) => a.data_batismo.localeCompare(b.data_batismo));

  const porFaixa = FAIXAS.map(f => ({
    ...f, qtd: doAno.filter(b => faixaEtaria(b.idade, b.sexo) === f.key).length,
  }));

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano--; pintar(); } }, '‹'),
      el('strong', { style: 'min-width:4rem;text-align:center' }, String(ano)),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano++; pintar(); } }, '›'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formBatismo(null) }, '+ Batismo'),
    ),

    el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
      cartaoIndicador({ rotulo: `Total em ${ano}`, valor: doAno.length, cor: corDaArea(0), nota: 'batismos registrados' }),
      ...porFaixa.map(f => cartaoIndicador({ rotulo: f.label, valor: f.qtd, cor: corDaArea(f.cor), nota: '' })),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Registro')),
      doAno.length
        ? el('div', { class: 'table-wrap' },
            el('table', { class: 'table' },
              el('thead', {}, el('tr', {},
                el('th', {}, '#'), el('th', {}, 'Nome'), el('th', {}, 'Batismo'), el('th', {}, 'Confirmação'),
                el('th', {}, 'Sexo'), el('th', { class: 'center' }, 'Idade'), el('th', {}, 'Faixa'),
                el('th', {}, 'Área'), el('th', {}, 'Fam. completa'), el('th', {}, ''))),
              el('tbody', {}, ...doAno.map((b, i) => {
                const f = FAIXAS.find(x => x.key === faixaEtaria(b.idade, b.sexo));
                const area = areas.find(a => a.id === b.area_id);
                return el('tr', {},
                  el('td', { class: 'num muted' }, i + 1),
                  el('td', {}, el('strong', {}, b.nome)),
                  el('td', { class: 'nowrap' }, dataCurta(b.data_batismo)),
                  el('td', { class: 'nowrap' }, b.data_confirmacao ? dataCurta(b.data_confirmacao) : '—'),
                  el('td', {}, String(b.sexo).toLowerCase().startsWith('f') ? 'F' : 'M'),
                  el('td', { class: 'num' }, b.idade ?? '—'),
                  el('td', {}, el('span', { class: 'badge badge--mute' },
                    el('span', { class: 'dot', style: `background:${corDaArea(f.cor)}` }), f.label)),
                  el('td', {}, area?.nome ?? '—'),
                  el('td', {}, b.familia_completa ? 'Sim' : '—'),
                  el('td', {}, el('div', { class: 'row' },
                    el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Editar ${b.nome}`, onclick: () => formBatismo(b) }, '✏️'),
                    el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Excluir ${b.nome}`, onclick: () => excluir(COL_BAT, b, b.nome) }, '🗑️'),
                  )),
                );
              })),
            ))
        : vazio('Nenhum batismo em ' + ano, 'Os números de Batismos e Confirmações do relatório saem daqui.', '💧'),
    ),
  );
}

function formBatismo(b) {
  const nome = el('input', { class: 'input', value: b?.nome ?? '' });
  const dataBat = el('input', { class: 'input', type: 'date', value: b?.data_batismo ?? '' });
  const dataConf = el('input', { class: 'input', type: 'date', value: b?.data_confirmacao ?? '' });
  const sexo = el('select', { class: 'select' },
    el('option', { value: 'm', selected: !String(b?.sexo).toLowerCase().startsWith('f') }, 'Masculino'),
    el('option', { value: 'f', selected: String(b?.sexo).toLowerCase().startsWith('f') }, 'Feminino'));
  const idade = el('input', { class: 'input', type: 'number', min: '0', max: '120', value: b?.idade ?? '' });
  const area = el('select', { class: 'select' },
    ...areas.map(a => el('option', { value: a.id, selected: b?.area_id === a.id }, a.nome)));
  const familia = el('input', { type: 'checkbox', checked: !!b?.familia_completa });

  const previa = el('p', { class: 'field__hint' });
  const atualizarPrevia = () => {
    const f = FAIXAS.find(x => x.key === faixaEtaria(idade.value, sexo.value));
    previa.textContent = `Faixa: ${f.label}`;
  };
  idade.addEventListener('input', atualizarPrevia);
  sexo.addEventListener('change', atualizarPrevia);
  atualizarPrevia();

  const corpo = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nome'), nome),
    el('div', { class: 'field' }, el('label', {}, 'Data do batismo'), dataBat),
    el('div', { class: 'field' }, el('label', {}, 'Data da confirmação'), dataConf,
      el('p', { class: 'field__hint' }, 'Costuma ser o domingo seguinte — é o que separa as colunas Batismos e Confirmações.')),
    el('div', { class: 'field' }, el('label', {}, 'Sexo'), sexo),
    el('div', { class: 'field' }, el('label', {}, 'Idade'), idade, previa),
    el('div', { class: 'field' }, el('label', {}, 'Área'), area),
    el('div', { class: 'field' }, el('label', { class: 'row' }, familia, 'Família completa')),
  );

  return modal({
    titulo: b ? 'Editar batismo' : 'Novo batismo',
    corpo,
    aoConfirmar: async () => {
      const dados = {
        nome: nome.value.trim(),
        data_batismo: dataBat.value || null,
        data_confirmacao: dataConf.value || null,
        sexo: sexo.value,
        idade: idade.value === '' ? null : Number(idade.value),
        area_id: area.value,
        familia_completa: familia.checked,
      };
      if (dados.nome.length < 2) throw new Error('Informe o nome.');
      if (!dados.data_batismo) throw new Error('Informe a data do batismo.');

      if (b) await ctx.db.atualizar(COL_BAT, b.id, dados);
      else   await ctx.db.inserir(COL_BAT, dados);
      await recarregar();
      pintar();
      toast(b ? 'Batismo atualizado.' : 'Batismo registrado.', 'ok');
    },
  });
}

/* ---------------------------------------------------------------------------
   Progredindo
--------------------------------------------------------------------------- */

function painelProgredindo() {
  const domingos = domingosDoMes(ano, mes);
  const doMes = progredindo
    .filter(p => domingos.includes(p.data))
    .sort((a, b) => a.data.localeCompare(b.data) || comparaNome(a.nome, b.nome));

  return el('div', {},
    barraDeMes(el('div', { class: 'row' },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formProgredindo(null) }, '+ Pessoa'),
    )),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, `${doMes.length} pessoa${doMes.length === 1 ? '' : 's'} progredindo`),
        el('span', { class: 'small muted' }, 'alimenta a coluna Progredindo do relatório'),
      ),
      doMes.length
        ? el('div', { class: 'table-wrap' },
            el('table', { class: 'table' },
              el('thead', {}, el('tr', {},
                el('th', {}, 'Semana'), el('th', {}, 'Nome'), el('th', {}, 'Área'),
                el('th', { class: 'center' }, 'Sacramentais'), el('th', {}, 'Data de batismo'),
                el('th', {}, 'Organização'), el('th', {}, ''))),
              el('tbody', {}, ...doMes.map(p => {
                const area = areas.find(a => a.id === p.area_id);
                return el('tr', {},
                  el('td', { class: 'nowrap' }, dataCurta(p.data)),
                  el('td', {}, el('strong', {}, p.nome)),
                  el('td', {}, el('span', { class: 'dot', style: `background:${corDaArea(area?.cor ?? 0)};margin-right:.375rem` }), area?.nome ?? '—'),
                  el('td', { class: 'num' }, p.sacramentais ?? 0),
                  el('td', { class: 'nowrap' }, p.data_batismo ? dataCurta(p.data_batismo) : '—'),
                  el('td', {}, p.organizacao ?? '—'),
                  el('td', {}, el('div', { class: 'row' },
                    el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Editar ${p.nome}`, onclick: () => formProgredindo(p) }, '✏️'),
                    el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Excluir ${p.nome}`, onclick: () => excluir(COL_PROG, p, p.nome) }, '🗑️'),
                  )),
                );
              })),
            ))
        : vazio('Ninguém lançado neste mês',
                'Registre quem está progredindo: quantas sacramentais assistiu, a data marcada e a organização que vai recebê-la.', '🌱'),
    ),
  );
}

function formProgredindo(p) {
  const domingos = domingosDoMes(ano, mes);
  const semana = el('select', { class: 'select' },
    ...domingos.map(d => el('option', { value: d, selected: p?.data === d }, dataCurta(d))));
  const nome = el('input', { class: 'input', value: p?.nome ?? '' });
  const area = el('select', { class: 'select' },
    ...areas.map(a => el('option', { value: a.id, selected: p?.area_id === a.id }, a.nome)));
  const sacr = el('input', { class: 'input', type: 'number', min: '0', value: p?.sacramentais ?? 0 });
  const dataBat = el('input', { class: 'input', type: 'date', value: p?.data_batismo ?? '' });
  const org = el('select', { class: 'select' },
    el('option', { value: '' }, '—'),
    ...ORGANIZACOES.map(o => el('option', { value: o, selected: p?.organizacao === o }, o)));

  const corpo = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Semana'), semana),
    el('div', { class: 'field' }, el('label', {}, 'Nome'), nome),
    el('div', { class: 'field' }, el('label', {}, 'Área'), area),
    el('div', { class: 'field' }, el('label', {}, 'Reuniões sacramentais assistidas'), sacr),
    el('div', { class: 'field' }, el('label', {}, 'Data de batismo marcada'), dataBat),
    el('div', { class: 'field' }, el('label', {}, 'Organização que vai receber'), org,
      el('p', { class: 'field__hint' }, 'É o que o conselho da ala precisa para designar quem acolhe.')),
  );

  return modal({
    titulo: p ? 'Editar pessoa' : 'Nova pessoa progredindo',
    corpo,
    aoConfirmar: async () => {
      const dados = {
        data: semana.value,
        nome: nome.value.trim(),
        area_id: area.value,
        sacramentais: Number(sacr.value) || 0,
        data_batismo: dataBat.value || null,
        organizacao: org.value || null,
      };
      if (dados.nome.length < 2) throw new Error('Informe o nome.');

      if (p) await ctx.db.atualizar(COL_PROG, p.id, dados);
      else   await ctx.db.inserir(COL_PROG, dados);
      await recarregar();
      pintar();
      toast(p ? 'Atualizado.' : 'Pessoa registrada.', 'ok');
    },
  });
}

/* ---------------------------------------------------------------------------
   Comum
--------------------------------------------------------------------------- */

async function excluir(colecao, registro, nome) {
  if (!await confirmar('Excluir registro', `Remover ${nome}?`, { confirmar: 'Excluir' })) return;
  await ctx.db.remover(colecao, registro.id);
  await recarregar();
  pintar();
  toast('Registro removido.');
}
