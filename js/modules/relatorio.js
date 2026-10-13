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
  FREQUENCIA, MESES, ORGANIZACOES, corDaArea, faixaEtaria,
} from '../config.js';
import {
  cartaoIndicador, funil, linhas, moldura, n, tabelaSimples,
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

/**
 * Cor e traço de cada indicador quando ele vira linha ou cartão.
 *
 * Onze indicadores num gráfico só não cabem na cor: o validador da skill
 * dataviz, rodado com todos os pares (num gráfico de linhas qualquer par pode
 * se encostar), aprova no máximo QUATRO das oito cores da paleta nos dois
 * temas ao mesmo tempo. Não existe atribuição que torne onze linhas legíveis
 * só pela cor.
 *
 * Então a cor marca a FAMÍLIA e o traço marca o membro: seis famílias, linha
 * cheia para o principal e tracejada para o parente. São seis cores em vez de
 * oito, sem o laranja — laranja × vermelho ficava a ΔE 7 até para quem
 * enxerga todas as cores, e laranja × verde a 3 sob protanopia.
 *
 * Das seis, o par que ainda colapsa para daltônicos no tema escuro é azul ×
 * violeta (ΔE 1,9). Ele fica com Batismos (rente ao zero) e Lições (a linha
 * mais alta), as famílias mais distantes em valor — essas linhas não se
 * encostam. O resto da leitura é o destaque pela legenda, a dica e a tabela.
 *
 * Os cartões do topo usam a mesma cor e o mesmo traço do indicador.
 */
const ESTILO_INDICADOR = {
  novas_pessoas:     { slot: 5 },                    // verde
  progredindo:       { slot: 5, tracejado: true },
  licoes_membro:     { slot: 6 },                    // violeta
  outras_licoes:     { slot: 6, tracejado: true },
  sacramental:       { slot: 2 },                    // água
  novos_sacramental: { slot: 2, tracejado: true },
  total_com_data:    { slot: 3 },                    // amarelo
  novos_com_data:    { slot: 3, tracejado: true },
  batismos:          { slot: 0 },                    // azul
  confirmacoes:      { slot: 0, tracejado: true },
  referencias:       { slot: 7 },                    // vermelho
};

const estiloDo = (key) => {
  const e = ESTILO_INDICADOR[key] ?? { slot: 0 };
  return { cor: corDaArea(e.slot), tracejado: !!e.tracejado };
};

let ctx, raiz;
let aba = 'lancamento';
let ano = new Date().getFullYear();
let mes = new Date().getMonth();
let areaSel = null;
/**
 * Indicadores marcados no gráfico de linhas. Um só: ele vem separado por área,
 * como sempre foi. Dois ou mais: uma linha por indicador, somada na ala.
 */
let indicadoresGrafico = new Set(['novas_pessoas']);
/** O gráfico de linhas estava em "Ver tabela"? Sobrevive a marcar e desmarcar caixas. */
let tabelaLinhasAberta = false;
/** Conta as pinturas da tela; quem grava compara para saber se a tela mudou no meio. */
let geracao = 0;

let areas = [], semanais = [], frequencias = [], batismos = [], progredindo = [];
let caminhoPessoas = [], caminhoFrequencia = [];

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;
  await recarregar();
  areaSel ??= areas[0]?.id;
  pintar();
}

/**
 * O que esta tela está mostrando, para o cabeçalho do papel e o nome do PDF.
 * Lido na hora de imprimir — ver js/impressao.js.
 */
export function impressao() {
  const periodo = `${MESES[mes]} de ${ano}`;
  const area = areas.find(a => a.id === areaSel) ?? areas[0];
  const marcados = INDICADORES.filter(i => indicadoresGrafico.has(i.key));
  const porAba = {
    lancamento:  { nome: 'Lançamento', detalhe: area ? `${area.nome} · ${periodo}` : periodo },
    consolidado: { nome: 'Consolidado', detalhe: `${periodo} · soma das áreas` },
    graficos:    {
      nome: 'Gráficos',
      detalhe: `Cartões e funil: ${periodo} · linhas: domingos de ${ano}`
        + (marcados.length ? ` · ${marcados.map(i => i.label).join(', ')}` : ''),
    },
    batismos:    { nome: 'Batismos', detalhe: `Ano de ${ano}` },
    progredindo: { nome: 'Progredindo', detalhe: periodo },
  };
  const a = porAba[aba] ?? porAba.lancamento;
  return {
    titulo: `Relatório de Progresso — ${a.nome}`,
    detalhe: a.detalhe,
    // As duas tabelas largas: uma coluna por indicador.
    paisagem: aba === 'lancamento' || aba === 'consolidado',
  };
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

/** Coluna do Postgres de um indicador digitado. Ver `coluna` em INDICADORES. */
const chaveCampo = (ind) => ind.coluna ?? ind.key;

const linhaDe = (data, areaId) => semanais.find(r => r.data === data && r.area_id === areaId);

/** Valor de um indicador numa área e semana. Derivados saem das listas nominais. */
function valor(data, areaId, indKey) {
  if (indKey === 'progredindo') {
    return progredindo.filter(p => p.data === data && p.area_id === areaId).length;
  }
  if (indKey === 'batismos' || indKey === 'confirmacoes') {
    const campo = indKey === 'batismos' ? 'data_batismo' : 'data_confirmacao';
    return batismos.filter(b =>
      b.area_id === areaId && b[campo] && domingoDaSemana(b[campo]) === data).length;
  }
  if (indKey === 'novos_sacramental') {
    return novosNaSacramental(data, areaId, caminhoPessoas, caminhoFrequencia);
  }

  const r = linhaDe(data, areaId);
  const ind = INDICADORES.find(i => i.key === indKey);
  return num(r?.[chaveCampo(ind)]);
}

/** Consolidado da ala: soma das áreas ativas. Frequência jamais entra aqui. */
function valorAla(data, indKey) {
  return soma(areas, a => valor(data, a.id, indKey));
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
  geracao++;
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
  return el('div', { class: 'row row--wrap nao-imprimir', style: 'margin-bottom:1rem' },
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

  // Uma coluna por indicador, com o nome inteiro — nunca abreviação. "Liç.M"
  // e "N.Data" só faziam sentido para quem já conhecia a planilha antiga, e o
  // `title` que os explicava não existe em celular. A classe .table--rotulos
  // deixa o cabeçalho quebrar linha para o nome caber.
  //
  // Já foram duas faixas, com Casados / Homens adultos / Total embaixo das
  // contagens de pessoas. Desde outubro de 2026 só o total é lançado.
  const topo = el('tr', {},
    el('th', {}, 'Domingo'),
    ...MANUAIS.map(ind => el('th', { class: 'center' }, ind.label)),
    el('th', { class: 'center' }, FREQUENCIA.label),
  );

  const corpo = el('tbody', {}, ...domingos.map(d => linhaLancamento(d, area)));

  return el('div', {},
    barraDeMes(el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Área:'), seletorArea)),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' },
          el('span', { class: 'dot', style: `background:${corDaArea(area.cor ?? 0)};margin-right:.5rem` }),
          area.nome),
        el('span', { class: 'small muted nao-imprimir' }, 'salva ao sair do campo'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table table--rotulos' }, el('thead', {}, topo), corpo)),
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
    tr.append(el('td', {}, campoNumero({
      valor: valor(data, area.id, ind.key),
      rotulo: `${ind.label} em ${dataCurta(data)}`,
      aoSalvar: (v) => salvarSemanal(data, area.id, chaveCampo(ind), v),
    })));
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
  const g = geracao;
  await ctx.db.gravarNaChave(COL_SEM, { data, area_id: areaId, [campo]: v });
  await recarregar();
  repintarSeMudou(g);
}

/**
 * Repinta depois de uma gravação se a tela foi pintada de novo NO MEIO dela.
 *
 * O change do campo dispara no blur — às vezes no mesmo clique que troca de
 * aba ou de mês —, e a tela nova nasce com os dados de antes da gravação
 * chegar. Antes a regra era "repinta se saiu do Lançamento", mas o próprio
 * Lançamento repintado no meio (ir ao próximo mês e voltar) ficava com o
 * valor antigo. Comparar as pinturas cobre os dois casos e não repinta quando
 * a pessoa só passou de um campo ao outro, que não pinta nada.
 *
 * E não repinta por cima de quem já está digitando em outro campo: perder o
 * que se digita é pior que ver um número velho, que já está gravado.
 */
function repintarSeMudou(g) {
  if (geracao === g) return;
  const foco = document.activeElement;
  if (foco && raiz.contains(foco) && foco.matches('input, textarea, select')) return;
  pintar();
}

async function salvarFrequencia(data, v) {
  const g = geracao;
  await ctx.db.gravarNaChave(COL_FREQ, { data, valor: v });
  await recarregar();
  repintarSeMudou(g);
}

/* ---------------------------------------------------------------------------
   Consolidado
--------------------------------------------------------------------------- */

function painelConsolidado() {
  const domingos = domingosDoMes(ano, mes);

  const topo = el('tr', {},
    el('th', {}, 'Domingo'),
    ...INDICADORES.map(ind => el('th', { class: 'center' }, ind.label)),
    el('th', { class: 'center' }, FREQUENCIA.label),
  );

  const celulas = (d) => {
    const tds = INDICADORES.map(ind => el('td', { class: 'num' }, n(valorAla(d, ind.key))));
    const f = frequenciaDe(d);
    tds.push(el('td', { class: f == null ? 'num muted' : 'num' }, f == null ? '—' : n(f)));
    return tds;
  };

  const rodape = el('tr', {}, el('td', {}, 'Total do mês'),
    ...INDICADORES.map(ind => el('td', { class: 'num' }, n(soma(domingos, d => valorAla(d, ind.key))))));
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
        el('table', { class: 'table table--rotulos' },
          el('thead', {}, topo),
          el('tbody', {}, ...domingos.map(d => el('tr', {}, el('td', { class: 'nowrap' }, dataCurta(d)), ...celulas(d)))),
          el('tfoot', {}, rodape),
        )),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Por área no mês')),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table table--rotulos' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Área'),
            ...INDICADORES.map(i => el('th', { class: 'center' }, i.label)))),
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
  const cab = ['Domingo', 'Área', ...INDICADORES.map(ind => ind.label), FREQUENCIA.label];

  const linhasCSV = [];
  for (const d of domingos) {
    // Linha do consolidado. O nome vem de ALA — ficou para trás na troca de
    // identidade porque só aparece no CSV, nunca na tela.
    for (const a of [...areas, { id: null, nome: ALA.nome.toUpperCase() }]) {
      const ler = (k) => (a.id ? valor(d, a.id, k) : valorAla(d, k));
      const linha = [dataCurta(d), a.nome, ...INDICADORES.map(ind => ler(ind.key) ?? '')];
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

  // Uma só faixa de filtros acima de tudo que ela controla.
  const filtros = el('div', { class: 'row row--wrap nao-imprimir', style: 'margin-bottom:1rem' },
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano--; pintar(); } }, '‹'),
    el('strong', { style: 'min-width:4rem;text-align:center' }, String(ano)),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { ano++; pintar(); } }, '›'),
    el('span', { class: 'small muted', style: 'margin-left:.75rem' }, 'Mês:'),
    el('select', { class: 'select', style: 'max-width:9rem', onchange: (e) => { mes = Number(e.target.value); pintar(); } },
      ...MESES.map((m, i) => el('option', { value: i, selected: i === mes }, m))),
  );

  // Marcar ou desmarcar um indicador repinta só o gráfico de linhas. Repintar
  // o painel inteiro rolaria a página de volta ao topo a cada clique. Os
  // domingos são recalculados a cada vez: um recarregar() que termine depois
  // de o painel abrir não pode deixar este gráfico com dado velho.
  // A classe devolve o espaço que o `.card + .card` dava entre este cartão e
  // o do funil — com o contêiner no meio, eles deixaram de ser irmãos.
  const alvoLinhas = el('div', { class: 'grafico-linhas' });
  const pintarLinhas = () => alvoLinhas.replaceChildren(graficoIndicadores(domingosLancados(ano)));
  pintarLinhas();

  return el('div', {},
    filtros,
    cartoesChave(doMes, doMesAnterior, domingosAno),
    seletorIndicadores(pintarLinhas),
    alvoLinhas,
    graficoFunil(doMes),
    graficoBatismos(),
  );
}

/**
 * Caixas de marcar, uma por indicador, que decidem o que o gráfico de linhas
 * mostra. Fica logo acima do gráfico que ela controla, e só dele — os
 * cartões, o funil e os batismos não dependem desta escolha.
 */
function seletorIndicadores(aoMudar) {
  const chave = new Set(INDICADORES_CHAVE.map(i => i.key));

  const caixas = INDICADORES.map(ind => {
    const caixa = el('input', {
      type: 'checkbox', checked: indicadoresGrafico.has(ind.key),
      onchange: (e) => {
        if (e.target.checked) indicadoresGrafico.add(ind.key);
        else indicadoresGrafico.delete(ind.key);
        aoMudar();
      },
    });
    return { ind, caixa };
  });

  const marcar = (keys) => {
    indicadoresGrafico = new Set(keys);
    for (const c of caixas) c.caixa.checked = indicadoresGrafico.has(c.ind.key);
    aoMudar();
  };
  const atalho = (rotulo, keys) =>
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => marcar(keys) }, rotulo);

  return el('fieldset', { class: 'card seletor-indicadores nao-imprimir' },
    el('legend', { class: 'seletor-indicadores__titulo' }, 'Indicadores no gráfico de linhas'),
    el('div', { class: 'seletor-indicadores__atalhos' },
      atalho('Indicadores-chave', INDICADORES_CHAVE.map(i => i.key)),
      atalho('Todos', INDICADORES.map(i => i.key)),
      atalho('Limpar', []),
    ),
    el('div', { class: 'seletor-indicadores__lista' },
      ...caixas.map(({ ind, caixa }) => el('label', { class: 'seletor-indicadores__item' },
        caixa,
        el('span', {}, ind.label),
        chave.has(ind.key) && el('span', { class: 'tile__selo', title: `Indicador-chave ${ind.pmg} do Pregar Meu Evangelho` }, 'chave'),
      )),
    ),
    el('p', { class: 'field__hint' },
      'Um indicador só aparece separado por área. Dois ou mais aparecem somados na ala, uma linha por indicador.'),
  );
}

/** O gráfico de linhas conforme as caixas marcadas. */
function graficoIndicadores(domingosAno) {
  const marcados = INDICADORES.filter(i => indicadoresGrafico.has(i.key));
  if (!marcados.length) {
    return moldura({
      titulo: 'Indicadores',
      figura: vazio('Nenhum indicador marcado', 'Marque um ou mais indicadores acima para ver o gráfico.', '📈'),
    });
  }
  if (marcados.length === 1) return graficoPorArea(marcados[0], domingosAno);
  return graficoVarios(marcados, domingosAno);
}

/**
 * Os seis indicadores-chave do mês, comparados com o mês anterior.
 *
 * A comparação é pela MÉDIA POR DOMINGO, e só com domingos que já passaram.
 * Antes somava o mês inteiro — os domingos ainda por vir entravam valendo
 * zero — e comparava com o mês anterior completo. No dia 11, com dois
 * domingos de quatro lançados, todo indicador aparecia caindo pela metade, em
 * vermelho, todo mês. A média também iguala mês de cinco domingos com mês de
 * quatro, que a soma pura favorecia.
 *
 * O número grande continua sendo o total do mês até aqui.
 */
function cartoesChave(doMes, doMesAnterior, domingosAno) {
  const ultimos12 = domingosAno.slice(-12);
  const hj = hoje();
  const passados = doMes.filter(d => d <= hj);
  const anteriores = doMesAnterior.filter(d => d <= hj);
  const media = (domingos, key) => totalNoPeriodo(domingos, key) / domingos.length;

  return el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
    ...INDICADORES_CHAVE.map((ind) => cartaoIndicador({
      rotulo: `${ind.pmg}. ${ind.label}`,
      valor: totalNoPeriodo(passados, ind.key),
      variacao: passados.length && anteriores.length
        ? variacao(media(anteriores, ind.key), media(passados, ind.key))
        : null,
      nota: passados.length ? 'sem base anterior' : 'nenhum domingo ainda',
      serie: ultimos12.map(d => valorAla(d, ind.key)),
      ...estiloDo(ind.key),
    })),
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
    tabelaAberta: tabelaLinhasAberta,
    aoAlternar: (aberta) => { tabelaLinhasAberta = aberta; },
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

/**
 * Vários indicadores num gráfico só, somados na ala — até os onze.
 *
 * Foi pedido assim, sabendo do custo: as escalas são diferentes — Outras
 * Lições anda na casa das dezenas, Batismos entre zero e dois —, então as
 * linhas pequenas ficam rente ao chão. O que segura a leitura:
 *
 *  - as caixas acima do gráfico tiram o que não interessa no momento;
 *  - o mouse sobre a legenda destaca uma linha e recua as outras;
 *  - a dica no fio vertical lista os onze valores daquele domingo;
 *  - a tabela traz tudo em número;
 *  - a cor marca a família e o tracejado o parente (ver ESTILO_INDICADOR).
 *
 * Sem rótulo no fim das linhas: onze nomes empilhados na borda direita viram
 * ruído. A legenda faz esse papel.
 */
function graficoVarios(marcados, domingosAno) {
  const titulo = marcados.length === INDICADORES.length
    ? 'Todos os indicadores — total da ala'
    : `${marcados.length} indicadores — total da ala`;

  if (!domingosAno.length) {
    return moldura({ titulo, figura: vazio('Sem domingos', `Nada lançado em ${ano}.`, '📈') });
  }

  const series = marcados.map(ind => ({
    nome: ind.label,
    ...estiloDo(ind.key),
    valores: domingosAno.map(d => valorAla(d, ind.key)),
  }));

  return moldura({
    tabelaAberta: tabelaLinhasAberta,
    aoAlternar: (aberta) => { tabelaLinhasAberta = aberta; },
    titulo,
    descricao: `Domingos de ${ano} até hoje. Passe o mouse sobre um indicador da legenda para destacar a linha dele.`,
    figura: linhas({ categorias: domingosAno.map(dataCurta), series, altura: 340 }),
    series,
    tabela: () => tabelaSimples(
      ['Domingo', ...marcados.map(i => i.label)],
      domingosAno.map(d => [dataCurta(d), ...marcados.map(i => n(valorAla(d, i.key)))]),
      { rotulosLongos: true },
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

/**
 * Batismos por mês, uma linha por área.
 *
 * Era coluna empilhada por faixa etária. Com contagens de zero a dois por mês,
 * as pilhas viravam blocos soltos difíceis de comparar, e a cor da faixa
 * competia com a cor da área usada em todo o resto do relatório. A faixa
 * continua na aba Batismos e na tabela deste gráfico.
 *
 * Mês ainda não começado não entra: plotado como zero, ele diria que não
 * houve batismo num mês que nem aconteceu. A exceção é batismo já cadastrado
 * com data futura — o eixo vai até o mês dele. Cortar ali fazia o gráfico
 * mostrar linhas zeradas (ou "nenhum batismo") enquanto a aba Batismos, que
 * conta o registro inteiro, mostrava o batismo.
 *
 * O mês é o do relatório, não o do calendário: o batismo conta no mês do
 * domingo que fecha a semana, como em valor() — e portanto no funil, no
 * cartão 5 e no consolidado. Pelo calendário, o batismo de sábado 31/10 caía
 * em outubro aqui e em novembro no funil logo acima, no mesmo painel. A única
 * divergência que sobra é com a aba Batismos, que é um registro e separa o
 * ano pela data do batismo: um sábado de fim de dezembro cuja semana fecha em
 * janeiro conta lá num ano e aqui no seguinte.
 */
function graficoBatismos() {
  const mesDoRelatorio = (b) => deISO(domingoDaSemana(b.data_batismo));
  const doAno = batismos.filter(b => b.data_batismo && mesDoRelatorio(b).getFullYear() === ano);

  const agora = deISO(hoje());
  const mesCorrente = ano < agora.getFullYear() ? 11 : ano > agora.getFullYear() ? -1 : agora.getMonth();
  const ultimoCadastrado = Math.max(-1, ...doAno.map(b => mesDoRelatorio(b).getMonth()));
  const meses = MESES.slice(0, Math.max(mesCorrente, ultimoCadastrado) + 1);
  const noMes = (lista, m) => lista.filter(b => mesDoRelatorio(b).getMonth() === m);

  const series = areas.map(a => ({
    nome: a.nome,
    cor: corDaArea(a.cor ?? 0),
    valores: meses.map((_, m) => noMes(doAno.filter(b => b.area_id === a.id), m).length),
  }));

  // Batismo sem área (área apagada, ou desativada em Configurações) não tem
  // linha e fica de fora do funil e do consolidado, que somam só as áreas
  // ativas. Aqui ele conta no Total, como na aba Batismos, e a diferença
  // aparece numa coluna própria — antes ela ficava muda, e o Total desta
  // tabela discordava do funil sem dizer por quê.
  const ativas = new Set(areas.map(a => a.id));
  const semArea = doAno.filter(b => !ativas.has(b.area_id));
  const temAlgo = doAno.length > 0 && meses.length > 0;

  return moldura({
    titulo: 'Batismos por mês',
    descricao: 'Uma linha por área, pelo mês do relatório (o do domingo que fecha a semana). A faixa etária está na tabela.',
    figura: temAlgo
      ? linhas({ categorias: meses.map(m => m.slice(0, 3)), series, marcadores: true })
      : vazio('Nenhum batismo registrado', `Cadastre na aba Batismos para ver o gráfico de ${ano}.`, '💧'),
    series: temAlgo ? series : [],
    tabela: temAlgo ? () => tabelaSimples(
      ['Mês', ...areas.map(a => a.nome), ...(semArea.length ? ['Sem área ativa'] : []),
        ...FAIXAS.map(f => f.label), 'Total'],
      meses.map((nome, m) => {
        const doMes = noMes(doAno, m);
        return [
          nome,
          ...series.map(z => n(z.valores[m])),
          ...(semArea.length ? [n(noMes(semArea, m).length)] : []),
          ...FAIXAS.map(f => n(doMes.filter(b => faixaEtaria(b.idade, b.sexo) === f.key).length)),
          n(doMes.length),
        ];
      }),
    ) : null,
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
