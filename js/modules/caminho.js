/**
 * Caminho do Convênio — só o LMA.
 *
 * Substitui a ficha "Plano de Retenção" com três mudanças:
 *
 *  1. A janela vai a DOIS anos, não um. É o prazo do "Relatório de Progresso:
 *     No Caminho do Convênio", recurso atual da Igreja.
 *  2. Seis marcos oficiais entram além dos 14 da ficha: ministradores
 *     designados, recomendação para ordenanças vicárias, bênção patriarcal,
 *     instituto e preparação missionária.
 *  3. Membro que retorna à atividade precisa de consentimento registrado
 *     antes de entrar no acompanhamento, como pede o Manual Geral.
 *
 * A frequência aos domingos daqui alimenta o 6º indicador-chave do relatório.
 */

import {
  AREAS_PADRAO, MARCOS, MARCOS_ITENS, MESES, TIPOS_ACOMPANHADO, corDaArea,
} from '../config.js';
import { cartaoIndicador } from '../charts.js';
import {
  DIAS_JANELA, alertasDoCaminho, marcoFeito as buscarMarco, marcosDe,
  mesesNoCaminho, precisaDeAtencao, presencaEm as buscarPresenca, progresso as calcProgresso,
} from '../regras.js';
import { comparaNome, dataCurta, dataLonga, domingosDoMes, hoje } from '../util.js';
import { confirmar, el, modal, toast, vazio } from '../ui.js';

const COL_PESSOAS = 'caminho_pessoas';
const COL_MARCOS  = 'caminho_marcos';
const COL_FREQ    = 'caminho_frequencia';

let ctx, raiz;
let aba = 'acompanhamento';
let filtroTipo = 'todos';
let ano, mes;
let areas = [], pessoas = [], marcos = [], frequencias = [];

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;
  const agora = new Date();
  ano ??= agora.getFullYear();
  mes ??= agora.getMonth();

  if (!ctx.db.ehAdmin()) {
    alvo.append(vazio('Acesso restrito',
      'O acompanhamento de recém-conversos é do líder de missão da ala.', '🔒'));
    return;
  }

  await recarregar();
  pintar();
}

async function recarregar() {
  const [as, ps, ms, fs] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar(COL_PESSOAS),
    ctx.db.listar(COL_MARCOS),
    ctx.db.listar(COL_FREQ),
  ]);
  areas = (as.length ? as : AREAS_PADRAO).filter(a => a.ativa !== false);
  pessoas = ps.sort((a, b) => comparaNome(a.nome, b.nome));
  marcos = ms;
  frequencias = fs;
}

/* ---------------------------------------------------------------------------
   Regras
--------------------------------------------------------------------------- */

const visiveis = () => pessoas.filter(p =>
  p.ativo !== false && (filtroTipo === 'todos' || p.tipo === filtroTipo));

// Aplicam as regras compartilhadas ao estado carregado neste módulo.
const marcoFeito = (pessoaId, key) => buscarMarco(marcos, pessoaId, key);
const progresso  = (p) => calcProgresso(p, marcos);
const alertas    = (p) => alertasDoCaminho(p, marcos, frequencias);
const presencaEm = (pessoaId, domingo) => buscarPresenca(frequencias, pessoaId, domingo);

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

const ABAS = [
  { id: 'acompanhamento', rotulo: '👥 Acompanhamento' },
  { id: 'marcos',         rotulo: '✅ Marcos' },
  { id: 'domingos',       rotulo: '⛪ Domingos na igreja' },
];

function pintar() {
  const paineis = {
    acompanhamento: painelAcompanhamento,
    marcos: painelMarcos,
    domingos: painelDomingos,
  };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '✨ Caminho do Convênio'),
      el('p', {}, 'Recém-conversos e membros retornando à atividade, nos primeiros dois anos.'),
    ),
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('div', { class: 'chips' },
        ...ABAS.map(a => el('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(aba === a.id),
          onclick: () => { aba = a.id; pintar(); },
        }, a.rotulo)),
      ),
      el('span', { class: 'spacer' }),
      el('div', { class: 'chips' },
        ...[{ key: 'todos', label: 'Todos' }, ...TIPOS_ACOMPANHADO.map(t => ({ key: t.key, label: `${t.icone} ${t.label}` }))]
          .map(t => el('button', {
            class: 'chip', type: 'button', 'aria-pressed': String(filtroTipo === t.key),
            onclick: () => { filtroTipo = t.key; pintar(); },
          }, t.label)),
      ),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formPessoa(null) }, '+ Pessoa'),
    ),
    paineis[aba](),
  );
}

/* ---------------------------------------------------------------------------
   Acompanhamento
--------------------------------------------------------------------------- */

function painelAcompanhamento() {
  const lista = visiveis();
  if (!lista.length) {
    return vazio('Ninguém em acompanhamento',
      'Cadastre os recém-conversos e quem está voltando à atividade.', '✨');
  }

  const comAlerta = lista.filter(p => precisaDeAtencao(p, marcos, frequencias));
  const mediaProgresso = lista.length
    ? lista.reduce((t, p) => t + progresso(p).pct, 0) / lista.length : 0;

  return el('div', {},
    el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
      cartaoIndicador({ rotulo: 'Em acompanhamento', valor: lista.length, cor: corDaArea(0), nota: 'nos últimos dois anos' }),
      cartaoIndicador({ rotulo: 'Recém-conversos', valor: lista.filter(p => p.tipo === 'recemConverso').length, cor: corDaArea(2), nota: '' }),
      cartaoIndicador({ rotulo: 'Retornando à atividade', valor: lista.filter(p => p.tipo === 'retornando').length, cor: corDaArea(1), nota: '' }),
      cartaoIndicador({ rotulo: 'Precisam de atenção', valor: comAlerta.length, cor: corDaArea(7), nota: comAlerta.length ? 'veja os avisos abaixo' : 'nenhuma pendência' }),
      cartaoIndicador({ rotulo: 'Progresso médio', valor: Math.round(mediaProgresso), cor: corDaArea(5), nota: '% dos marcos aplicáveis' }),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, `${lista.length} pessoa(s)`),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportarCSV }, '⬇ CSV'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Nome'), el('th', {}, 'Tipo'), el('th', {}, 'Área'),
            el('th', {}, 'Desde'), el('th', { class: 'center' }, 'Tempo'),
            el('th', { style: 'min-width:9rem' }, 'Progresso'),
            el('th', { style: 'min-width:14rem' }, 'Pendências'), el('th', {}, ''),
          )),
          el('tbody', {}, ...lista.map(linhaPessoa)),
        )),
    ),
  );
}

function linhaPessoa(p) {
  const tipo = TIPOS_ACOMPANHADO.find(t => t.key === p.tipo);
  const area = areas.find(a => a.id === p.area_id);
  const prog = progresso(p);
  const avisos = alertas(p);
  const meses = mesesNoCaminho(p);

  return el('tr', {},
    el('td', {}, el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', style: 'font-weight:600',
      onclick: () => fichaPessoa(p),
    }, p.nome)),
    el('td', {}, el('span', { class: 'badge badge--mute nowrap' }, `${tipo?.icone ?? ''} ${tipo?.label ?? p.tipo}`)),
    el('td', { class: 'small' },
      el('span', { class: 'dot', style: `background:${corDaArea(area?.cor ?? 0)};margin-right:.375rem` }),
      area?.nome ?? '—'),
    el('td', { class: 'small nowrap' }, dataCurta(p.data_inicio)),
    el('td', { class: 'num nowrap' }, meses < 1 ? '< 1 mês' : `${meses} m`),
    el('td', {}, barraProgresso(prog)),
    el('td', {}, avisos.length
      ? el('div', { class: 'stack', style: 'gap:.25rem' },
          ...avisos.map(a => el('span', { class: `badge badge--${a.tom}` }, a.texto)))
      : el('span', { class: 'badge badge--ok' }, 'em dia')),
    el('td', {}, el('div', { class: 'row' },
      el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Editar ${p.nome}`, onclick: () => formPessoa(p) }, '✏️'),
      el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Arquivar ${p.nome}`, onclick: () => arquivar(p) }, '📦'),
    )),
  );
}

function barraProgresso({ feitos, total, pct: p }) {
  return el('div', {},
    el('div', { class: 'barra' },
      el('div', { class: 'barra__preenchida', style: `width:${p}%` })),
    el('span', { class: 'small muted tnum' }, `${feitos}/${total} · ${Math.round(p)}%`),
  );
}

/* ---------------------------------------------------------------------------
   Ficha individual
--------------------------------------------------------------------------- */

function fichaPessoa(p) {
  const tipo = TIPOS_ACOMPANHADO.find(t => t.key === p.tipo);
  const aplicaveis = marcosDe(p);
  const corpo = el('div');

  const desenhar = () => {
    const prog = progresso(p);
    corpo.replaceChildren(
      el('div', { class: 'card', style: 'background:var(--surface-2);margin-bottom:1rem' },
        el('div', { class: 'card__body', style: 'padding:.75rem' },
          el('div', { class: 'row row--wrap' },
            el('span', { class: 'badge badge--mute' }, `${tipo?.icone ?? ''} ${tipo?.label}`),
            el('span', { class: 'small muted' },
              `${p.tipo === 'recemConverso' ? 'Batismo' : 'Voltou'} em ${dataLonga(p.data_inicio)}`),
          ),
          el('div', { style: 'margin-top:.5rem' }, barraProgresso(prog)),
        )),

      ...MARCOS.map(grupo => {
        const itens = grupo.itens.filter(i => aplicaveis.some(a => a.key === i.key));
        if (!itens.length) return null;
        return el('div', { style: 'margin-bottom:1rem' },
          el('div', { style: 'font-weight:600;font-size:.8125rem;margin-bottom:.375rem' }, grupo.grupo),
          el('div', { class: 'stack', style: 'gap:.25rem' }, ...itens.map(i => itemMarco(p, i, desenhar))),
        );
      }).filter(Boolean),
    );
  };
  desenhar();

  return modal({
    titulo: p.nome,
    corpo,
    confirmar: null,
    cancelar: 'Fechar',
  });
}

function itemMarco(p, item, redesenhar) {
  const feito = marcoFeito(p.id, item.key);

  const alternar = async () => {
    try {
      if (feito) await ctx.db.remover(COL_MARCOS, feito.id);
      else await ctx.db.inserir(COL_MARCOS, { pessoa_id: p.id, marco: item.key, data: hoje() });
      await recarregar();
      redesenhar();
      pintar();
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.', 'err');
    }
  };

  return el('label', { class: `marco${feito ? ' marco--feito' : ''}` },
    el('input', { type: 'checkbox', checked: !!feito, onchange: alternar }),
    el('span', { class: 'marco__nome' },
      item.label,
      item.novo && el('span', { class: 'tile__selo' }, 'novo'),
    ),
    feito?.data && el('span', { class: 'small muted nowrap' }, dataCurta(feito.data)),
  );
}

/* ---------------------------------------------------------------------------
   Grade de marcos — o formato da ficha antiga
--------------------------------------------------------------------------- */

function painelMarcos() {
  const lista = visiveis();
  if (!lista.length) return vazio('Ninguém em acompanhamento', 'Cadastre alguém para ver a grade.', '✅');

  const topo = el('tr', {}, el('th', { rowspan: 2, style: 'min-width:11rem' }, 'Nome'));
  const base = el('tr', {});
  for (const grupo of MARCOS) {
    topo.append(el('th', { colspan: grupo.itens.length, class: 'center' }, grupo.grupo));
    for (const i of grupo.itens) base.append(el('th', { class: 'center', title: i.label }, i.abbr));
  }

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('span', { class: 'card__title' }, 'Marcos por pessoa'),
      el('span', { class: 'small muted' }, 'toque para marcar'),
    ),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table table--grade' },
        el('thead', {}, topo, base),
        el('tbody', {}, ...lista.map(p => {
          const aplicaveis = marcosDe(p);
          return el('tr', {},
            el('td', { class: 'nowrap', style: 'font-weight:600' }, p.nome),
            ...MARCOS_ITENS.map(item => {
              const cabe = aplicaveis.some(a => a.key === item.key);
              if (!cabe) return el('td', {}, el('span', { class: 'small muted' }, '·'));
              const feito = marcoFeito(p.id, item.key);
              return el('td', {}, el('button', {
                class: 'slot', type: 'button', 'aria-pressed': String(!!feito),
                'aria-label': `${p.nome}: ${item.label}`,
                title: feito?.data ? `${item.label} — ${dataCurta(feito.data)}` : item.label,
                onclick: async () => {
                  try {
                    if (feito) await ctx.db.remover(COL_MARCOS, feito.id);
                    else await ctx.db.inserir(COL_MARCOS, { pessoa_id: p.id, marco: item.key, data: hoje() });
                    await recarregar();
                    pintar();
                  } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
                },
              }, '✓'));
            }),
          );
        })),
      )),
  );
}

/* ---------------------------------------------------------------------------
   Domingos na igreja
--------------------------------------------------------------------------- */

function painelDomingos() {
  const lista = visiveis();
  if (!lista.length) return vazio('Ninguém em acompanhamento', 'Cadastre alguém para marcar presença.', '⛪');

  const domingos = domingosDoMes(ano, mes);
  const mudarMes = (passo) => {
    const d = new Date(ano, mes + passo, 1);
    ano = d.getFullYear(); mes = d.getMonth();
    pintar();
  };

  const alternar = async (p, domingo, atual) => {
    // Três estados em ciclo: sem registro → presente → ausente → sem registro.
    try {
      if (!atual) await ctx.db.inserir(COL_FREQ, { pessoa_id: p.id, domingo, presente: true });
      else if (atual.presente) await ctx.db.atualizar(COL_FREQ, atual.id, { presente: false });
      else await ctx.db.remover(COL_FREQ, atual.id);
      await recarregar();
      pintar();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  };

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      el('strong', { style: 'min-width:9rem;text-align:center' }, `${MESES[mes]} ${ano}`),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Próximo mês', onclick: () => mudarMes(+1) }, '›'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'small muted' }, 'toque: presente → faltou → sem registro'),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table table--grade' },
          el('thead', {}, el('tr', {},
            el('th', { style: 'min-width:11rem' }, 'Nome'),
            ...domingos.map(d => el('th', { class: 'center nowrap' }, dataCurta(d))),
            el('th', { class: 'center' }, 'Mês'),
          )),
          el('tbody', {}, ...lista.map(p => {
            const presentes = domingos.filter(d => presencaEm(p.id, d)?.presente).length;
            return el('tr', {},
              el('td', { class: 'nowrap', style: 'font-weight:600' }, p.nome),
              ...domingos.map(d => {
                const reg = presencaEm(p.id, d);
                const estado = !reg ? '' : reg.presente ? 'sim' : 'nao';
                return el('td', {}, el('button', {
                  class: `presenca presenca--${estado || 'vazio'}`, type: 'button',
                  'aria-label': `${p.nome}, ${dataCurta(d)}: ${estado === 'sim' ? 'presente' : estado === 'nao' ? 'faltou' : 'sem registro'}`,
                  onclick: () => alternar(p, d, reg),
                }, estado === 'sim' ? '✓' : estado === 'nao' ? '✕' : ''));
              }),
              el('td', { class: 'num' }, `${presentes}/${domingos.length}`),
            );
          })),
        )),
    ),
  );
}

/* ---------------------------------------------------------------------------
   Cadastro
--------------------------------------------------------------------------- */

function formPessoa(p) {
  const nome = el('input', { class: 'input', value: p?.nome ?? '' });
  const tipo = el('select', { class: 'select' },
    ...TIPOS_ACOMPANHADO.map(t => el('option', { value: t.key, selected: p?.tipo === t.key }, `${t.icone} ${t.label}`)));
  const sexo = el('select', { class: 'select' },
    el('option', { value: 'm', selected: p?.sexo !== 'f' }, 'Masculino'),
    el('option', { value: 'f', selected: p?.sexo === 'f' }, 'Feminino'));
  const area = el('select', { class: 'select' },
    ...areas.map(a => el('option', { value: a.id, selected: p?.area_id === a.id }, a.nome)));
  const dataInicio = el('input', { class: 'input', type: 'date', value: p?.data_inicio ?? hoje() });
  const telefone = el('input', { class: 'input', type: 'tel', value: p?.telefone ?? '' });
  const obs = el('textarea', { class: 'textarea', rows: 2 }, p?.observacoes ?? '');
  const consentimento = el('input', { type: 'checkbox', checked: !!p?.consentimento });

  const rotuloData = el('label', {});
  const blocoConsentimento = el('div', { class: 'field' },
    el('label', { class: 'row' }, consentimento, 'Consentimento registrado'),
    el('p', { class: 'field__hint' },
      'O Manual Geral pede o consentimento do membro que está voltando antes de incluí-lo no acompanhamento.'));

  const ajustar = () => {
    const ehRetorno = tipo.value === 'retornando';
    rotuloData.textContent = ehRetorno ? 'Data em que voltou à atividade' : 'Data do batismo';
    blocoConsentimento.style.display = ehRetorno ? '' : 'none';
  };
  tipo.addEventListener('change', ajustar);
  ajustar();

  const corpo = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nome'), nome),
    el('div', { class: 'field' }, el('label', {}, 'Tipo'), tipo),
    el('div', { class: 'field' }, rotuloData, dataInicio),
    el('div', { class: 'field' }, el('label', {}, 'Sexo'), sexo,
      el('p', { class: 'field__hint' }, 'Define se os marcos do sacerdócio entram na conta do progresso.')),
    el('div', { class: 'field' }, el('label', {}, 'Área'), area),
    el('div', { class: 'field' }, el('label', {}, 'Telefone'), telefone),
    blocoConsentimento,
    el('div', { class: 'field' }, el('label', {}, 'Observações'), obs),
  );

  return modal({
    titulo: p ? 'Editar pessoa' : 'Nova pessoa em acompanhamento',
    corpo,
    aoConfirmar: async () => {
      const dados = {
        nome: nome.value.trim(),
        tipo: tipo.value,
        sexo: sexo.value,
        area_id: area.value,
        data_inicio: dataInicio.value,
        telefone: telefone.value.trim() || null,
        consentimento: tipo.value === 'retornando' ? consentimento.checked : true,
        observacoes: obs.value.trim() || null,
      };
      if (dados.nome.length < 2) throw new Error('Informe o nome.');
      if (!dados.data_inicio) throw new Error('Informe a data.');

      if (p) await ctx.db.atualizar(COL_PESSOAS, p.id, dados);
      else await ctx.db.inserir(COL_PESSOAS, dados);
      await recarregar();
      pintar();
      toast(p ? 'Atualizado.' : 'Pessoa cadastrada.', 'ok');
    },
  });
}

async function arquivar(p) {
  const ok = await confirmar('Arquivar acompanhamento',
    `Tirar ${p.nome} da lista ativa? O histórico de marcos e domingos fica guardado.`,
    { confirmar: 'Arquivar', tom: 'primary' });
  if (!ok) return;
  await ctx.db.atualizar(COL_PESSOAS, p.id, { ativo: false });
  await recarregar();
  pintar();
  toast('Arquivado.');
}

function exportarCSV() {
  const cab = ['Nome', 'Tipo', 'Área', 'Desde', 'Meses', 'Progresso %',
    ...MARCOS_ITENS.map(m => m.label)];

  const linhas = visiveis().map(p => {
    const area = areas.find(a => a.id === p.area_id);
    const aplicaveis = marcosDe(p);
    return [
      p.nome,
      TIPOS_ACOMPANHADO.find(t => t.key === p.tipo)?.label ?? p.tipo,
      area?.nome ?? '',
      dataCurta(p.data_inicio),
      mesesNoCaminho(p),
      Math.round(progresso(p).pct),
      ...MARCOS_ITENS.map(m => {
        if (!aplicaveis.some(a => a.key === m.key)) return 'n/a';
        const feito = marcoFeito(p.id, m.key);
        return feito ? (feito.data ? dataCurta(feito.data) : 'sim') : '';
      }),
    ];
  });

  const csv = [cab, ...linhas]
    .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: 'caminho-do-convenio.csv' });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV gerado.', 'ok');
}
