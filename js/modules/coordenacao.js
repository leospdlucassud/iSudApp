/**
 * Coordenação missionária — só o LMA.
 *
 * A reunião semanal do Manual Geral 23.4. O que muda em relação a uma ata em
 * papel é que a pauta não é digitada: ela é montada a partir do resto do app —
 * quem está progredindo, quem tem data de batismo marcada, quais recém-conversos
 * estão em atraso e quais almoços da semana seguinte ainda estão sem voluntário.
 *
 * Designações em aberto atravessam as reuniões, para não morrerem na ata.
 */

import {
  AREAS_PADRAO, PARTICIPANTES_COORDENACAO, SECOES_PLANO, TIPOS_ACOMPANHADO,
  MARCAS_SEMANA, corDaArea,
} from '../config.js';
import { cartaoIndicador } from '../charts.js';
import { alertasDoCaminho, precisaDeAtencao } from '../regras.js';
import {
  comparaNome, dataCurta, dataLonga, diasEntre, diasDoMes, domingoDaSemana,
  hoje, somaDias,
} from '../util.js';
import { confirmar, el, modal, toast, vazio } from '../ui.js';

const COL_REUNIOES    = 'coordenacao_reunioes';
const COL_PRESENCAS   = 'coordenacao_presencas';
const COL_DESIGNACOES = 'coordenacao_designacoes';
const COL_PLANO       = 'plano_ala';

let ctx, raiz;
let aba = 'reuniao';
let reuniaoSel = null;

let areas = [], reunioes = [], presencas = [], designacoes = [], plano = [];
let progredindo = [], camPessoas = [], camMarcos = [], camFreq = [], almoco = [];

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;

  if (!ctx.db.ehAdmin()) {
    alvo.append(vazio('Acesso restrito',
      'A coordenação missionária é do líder de missão da ala.', '🔒'));
    return;
  }

  await recarregar();
  reuniaoSel ??= reunioes[0]?.id ?? null;
  pintar();
}

async function recarregar() {
  const [as, rs, ps, ds, pl, pr, cp, cm, cf, al] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar(COL_REUNIOES),
    ctx.db.listar(COL_PRESENCAS),
    ctx.db.listar(COL_DESIGNACOES),
    ctx.db.listar(COL_PLANO),
    ctx.db.listar('progredindo'),
    ctx.db.listar('caminho_pessoas'),
    ctx.db.listar('caminho_marcos'),
    ctx.db.listar('caminho_frequencia'),
    ctx.db.listar('almoco_agenda'),
  ]);
  areas = (as.length ? as : AREAS_PADRAO).filter(a => a.ativa !== false);
  reunioes = rs.sort((a, b) => b.data.localeCompare(a.data));
  presencas = ps;
  designacoes = ds;
  plano = pl;
  progredindo = pr;
  camPessoas = cp;
  camMarcos = cm;
  camFreq = cf;
  almoco = al;
}

/* ---------------------------------------------------------------------------
   Pauta automática
--------------------------------------------------------------------------- */

/**
 * Monta a pauta a partir do estado atual do app.
 * @param {string} dataRef domingo de referência da reunião
 */
function pauta(dataRef) {
  const semana = domingoDaSemana(dataRef);

  const emProgresso = progredindo
    .filter(p => p.data === semana)
    .sort((a, b) => comparaNome(a.nome, b.nome));

  const comData = progredindo
    .filter(p => p.data_batismo && p.data_batismo >= dataRef)
    .sort((a, b) => a.data_batismo.localeCompare(b.data_batismo));

  const emAtraso = camPessoas
    .filter(p => p.ativo !== false && precisaDeAtencao(p, camMarcos, camFreq))
    .sort((a, b) => comparaNome(a.nome, b.nome));

  // Vagas de almoço da semana seguinte que ninguém pegou.
  const vagas = [];
  for (let i = 0; i < 7; i++) {
    const dia = somaDias(dataRef, i);
    const dow = new Date(dia + 'T12:00:00').getDay();
    if (MARCAS_SEMANA[dow]?.bloqueia) continue;
    for (const a of areas) {
      if (!almoco.some(x => x.data === dia && x.area_id === a.id)) {
        vagas.push({ data: dia, area: a });
      }
    }
  }

  return { emProgresso, comData, emAtraso, vagas };
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

const ABAS = [
  { id: 'reuniao',     rotulo: '📋 Reunião' },
  { id: 'designacoes', rotulo: '📌 Designações' },
  { id: 'plano',       rotulo: '🎯 Plano da ala' },
];

function pintar() {
  const paineis = { reuniao: painelReuniao, designacoes: painelDesignacoes, plano: painelPlano };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '📋 Coordenação missionária'),
      el('p', {}, 'Reunião semanal do conselho, conforme o Manual Geral 23.4.'),
    ),
    el('div', { class: 'chips', style: 'margin-bottom:1rem' },
      ...ABAS.map(a => {
        const abertas = a.id === 'designacoes'
          ? designacoes.filter(d => !d.concluida).length : 0;
        return el('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(aba === a.id),
          onclick: () => { aba = a.id; pintar(); },
        }, abertas ? `${a.rotulo} (${abertas})` : a.rotulo);
      }),
    ),
    paineis[aba](),
  );
}

/* ---------------------------------------------------------------------------
   Reunião
--------------------------------------------------------------------------- */

function painelReuniao() {
  if (!reunioes.length) {
    return el('div', {},
      vazio('Nenhuma reunião registrada',
        'Crie a reunião da semana para o app montar a pauta sozinho.', '📋'),
      el('div', { class: 'center' },
        el('button', { class: 'btn btn--primary', type: 'button', onclick: novaReuniao }, '+ Nova reunião')),
    );
  }

  const r = reunioes.find(x => x.id === reuniaoSel) ?? reunioes[0];
  const p = pauta(r.data);

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('select', { class: 'select', style: 'max-width:16rem',
        onchange: (e) => { reuniaoSel = e.target.value; pintar(); } },
        ...reunioes.map(x => el('option', { value: x.id, selected: x.id === r.id }, dataLonga(x.data)))),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => imprimirPauta(r, p) }, '🖨 Pauta'),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: novaReuniao }, '+ Nova'),
    ),

    el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
      cartaoIndicador({ rotulo: 'Progredindo', valor: p.emProgresso.length, cor: corDaArea(0), nota: 'na semana da reunião' }),
      cartaoIndicador({ rotulo: 'Com data de batismo', valor: p.comData.length, cor: corDaArea(2), nota: 'daqui para a frente' }),
      cartaoIndicador({ rotulo: 'Precisam de atenção', valor: p.emAtraso.length, cor: corDaArea(7), nota: 'no caminho do convênio' }),
      cartaoIndicador({ rotulo: 'Almoços sem voluntário', valor: p.vagas.length, cor: corDaArea(3), nota: 'próximos 7 dias' }),
    ),

    blocoPresenca(r),
    blocoPauta(p),
    blocoDesignacoesDaReuniao(r),
    blocoObservacoes(r),
  );
}

function blocoPresenca(r) {
  const marcada = (papel) => presencas.find(x => x.reuniao_id === r.id && x.papel === papel);

  const alternar = async (papel) => {
    const atual = marcada(papel);
    try {
      if (!atual) await ctx.db.inserir(COL_PRESENCAS, { reuniao_id: r.id, papel, presente: true });
      else if (atual.presente) await ctx.db.atualizar(COL_PRESENCAS, atual.id, { presente: false });
      else await ctx.db.remover(COL_PRESENCAS, atual.id);
      await recarregar();
      pintar();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  };

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('span', { class: 'card__title' }, 'Presença'),
      el('span', { class: 'small muted' },
        `${PARTICIPANTES_COORDENACAO.filter(x => marcada(x)?.presente).length} de ${PARTICIPANTES_COORDENACAO.length}`),
    ),
    el('div', { class: 'card__body' },
      el('div', { class: 'stack', style: 'gap:.25rem' },
        ...PARTICIPANTES_COORDENACAO.map(papel => {
          const m = marcada(papel);
          const estado = !m ? '' : m.presente ? 'sim' : 'nao';
          return el('button', {
            class: `marco${estado === 'sim' ? ' marco--feito' : ''}`, type: 'button',
            style: 'text-align:left',
            onclick: () => alternar(papel),
          },
            el('span', { class: `presenca presenca--${estado || 'vazio'}`, style: 'width:1.75rem;min-width:1.75rem;height:1.75rem;pointer-events:none' },
              estado === 'sim' ? '✓' : estado === 'nao' ? '✕' : ''),
            el('span', { class: 'marco__nome' }, papel),
          );
        })),
    ),
  );
}

function blocoPauta(p) {
  const secao = (titulo, itens, render, vazioTexto) =>
    el('div', { style: 'margin-bottom:1.25rem' },
      el('div', { style: 'font-weight:600;font-size:.875rem;margin-bottom:.5rem' },
        titulo, ' ', el('span', { class: 'badge badge--mute' }, String(itens.length))),
      itens.length
        ? el('div', { class: 'stack', style: 'gap:.375rem' }, ...itens.map(render))
        : el('p', { class: 'small muted' }, vazioTexto),
    );

  const nomeArea = (id) => areas.find(a => a.id === id)?.nome ?? '—';
  const corArea = (id) => corDaArea(areas.find(a => a.id === id)?.cor ?? 0);

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('span', { class: 'card__title' }, 'Pauta'),
      el('span', { class: 'small muted' }, 'montada a partir do resto do app'),
    ),
    el('div', { class: 'card__body' },
      secao('Pessoas progredindo', p.emProgresso, (x) =>
        el('div', { class: 'row row--wrap' },
          el('span', { class: 'dot', style: `background:${corArea(x.area_id)}` }),
          el('strong', {}, x.nome),
          el('span', { class: 'small muted' }, nomeArea(x.area_id)),
          x.sacramentais > 0 && el('span', { class: 'badge badge--info' }, `${x.sacramentais} sacramentais`),
          x.organizacao && el('span', { class: 'badge badge--mute' }, x.organizacao),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button',
            onclick: () => formDesignacao(null, `Acompanhar ${x.nome}`) }, '+ designação'),
        ),
        'Ninguém lançado como progredindo nesta semana.'),

      secao('Datas de batismo marcadas', p.comData, (x) =>
        el('div', { class: 'row row--wrap' },
          el('span', { class: 'badge badge--ok nowrap' }, dataCurta(x.data_batismo)),
          el('strong', {}, x.nome),
          el('span', { class: 'small muted' }, `${nomeArea(x.area_id)} · faltam ${diasEntre(hoje(), x.data_batismo)} dias`),
        ),
        'Nenhuma data marcada daqui para a frente.'),

      secao('Membros novos precisando de atenção', p.emAtraso, (x) => {
        const tipo = TIPOS_ACOMPANHADO.find(t => t.key === x.tipo);
        return el('div', { class: 'row row--wrap' },
          el('span', {}, tipo?.icone ?? ''),
          el('strong', {}, x.nome),
          ...alertasDoCaminho(x, camMarcos, camFreq)
            .filter(a => a.tom !== 'mute')
            .map(a => el('span', { class: `badge badge--${a.tom}` }, a.texto)),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button',
            onclick: () => formDesignacao(null, `Visitar ${x.nome}`) }, '+ designação'),
        );
      }, 'Todos em dia no caminho do convênio.'),

      secao('Almoços sem voluntário nos próximos 7 dias', p.vagas, (v) =>
        el('div', { class: 'row' },
          el('span', { class: 'badge badge--warn nowrap' }, dataCurta(v.data)),
          el('span', { class: 'dot', style: `background:${corDaArea(v.area.cor ?? 0)}` }),
          el('span', {}, v.area.nome),
        ),
        'Todas as duplas têm almoço marcado.'),
    ),
  );
}

function blocoDesignacoesDaReuniao(r) {
  const abertas = designacoes.filter(d => !d.concluida)
    .sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'));

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('span', { class: 'card__title' }, 'Designações em aberto'),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button',
        onclick: () => formDesignacao(null, '', r.id) }, '+ Designação'),
    ),
    el('div', { class: 'card__body' },
      abertas.length
        ? el('div', { class: 'stack', style: 'gap:.375rem' }, ...abertas.map(linhaDesignacao))
        : el('p', { class: 'small muted' }, 'Nada pendente. As designações de reuniões anteriores aparecem aqui até serem concluídas.'),
    ),
  );
}

function blocoObservacoes(r) {
  const txt = el('textarea', { class: 'textarea', rows: 3, placeholder: 'anotações da reunião…' }, r.observacoes ?? '');
  txt.addEventListener('change', async () => {
    try {
      await ctx.db.atualizar(COL_REUNIOES, r.id, { observacoes: txt.value.trim() || null });
      await recarregar();
      toast('Anotações salvas.', 'ok');
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  });

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Observações')),
    el('div', { class: 'card__body' }, txt),
  );
}

async function novaReuniao() {
  const data = el('input', { class: 'input', type: 'date', value: hoje() });
  await modal({
    titulo: 'Nova reunião de coordenação',
    corpo: el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'Data'), data,
        el('p', { class: 'field__hint' }, 'A pauta é montada a partir da semana desta data.')),
    ),
    confirmar: 'Criar',
    aoConfirmar: async () => {
      if (!data.value) throw new Error('Informe a data.');
      if (reunioes.some(r => r.data === data.value)) throw new Error('Já existe reunião nessa data.');
      const nova = await ctx.db.inserir(COL_REUNIOES, { data: data.value });
      await recarregar();
      reuniaoSel = nova.id;
      pintar();
      toast('Reunião criada.', 'ok');
    },
  });
}

/* ---------------------------------------------------------------------------
   Designações
--------------------------------------------------------------------------- */

function painelDesignacoes() {
  const abertas = designacoes.filter(d => !d.concluida)
    .sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'));
  const feitas = designacoes.filter(d => d.concluida)
    .sort((a, b) => (b.concluida_em ?? '').localeCompare(a.concluida_em ?? ''))
    .slice(0, 20);
  const atrasadas = abertas.filter(d => d.prazo && d.prazo < hoje());

  return el('div', {},
    el('div', { class: 'grid grid--kpi', style: 'margin-bottom:1rem' },
      cartaoIndicador({ rotulo: 'Em aberto', valor: abertas.length, cor: corDaArea(0), nota: '' }),
      cartaoIndicador({ rotulo: 'Fora do prazo', valor: atrasadas.length, cor: corDaArea(7), nota: atrasadas.length ? 'retomar na reunião' : 'nenhuma' }),
      cartaoIndicador({ rotulo: 'Concluídas', valor: designacoes.filter(d => d.concluida).length, cor: corDaArea(5), nota: '' }),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'Em aberto'),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formDesignacao(null) }, '+ Designação'),
      ),
      el('div', { class: 'card__body' },
        abertas.length
          ? el('div', { class: 'stack', style: 'gap:.375rem' }, ...abertas.map(linhaDesignacao))
          : el('p', { class: 'small muted' }, 'Nada pendente.'),
      ),
    ),

    feitas.length && el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Concluídas recentemente')),
      el('div', { class: 'card__body' },
        el('div', { class: 'stack', style: 'gap:.375rem' }, ...feitas.map(linhaDesignacao))),
    ),
  );
}

function linhaDesignacao(d) {
  const atrasada = !d.concluida && d.prazo && d.prazo < hoje();

  const alternar = async () => {
    try {
      await ctx.db.atualizar(COL_DESIGNACOES, d.id, {
        concluida: !d.concluida,
        concluida_em: d.concluida ? null : hoje(),
      });
      await recarregar();
      pintar();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  };

  return el('div', { class: `marco${d.concluida ? ' marco--feito' : ''}` },
    el('input', { type: 'checkbox', checked: !!d.concluida, onchange: alternar }),
    el('span', { class: 'marco__nome' },
      el('span', { style: d.concluida ? 'text-decoration:line-through;opacity:.7' : '' }, d.descricao),
      d.responsavel && el('span', { class: 'small muted' }, ` · ${d.responsavel}`),
    ),
    d.prazo && el('span', { class: `badge badge--${atrasada ? 'err' : 'mute'} nowrap` }, dataCurta(d.prazo)),
    el('button', { class: 'btn btn--icon btn--ghost', type: 'button',
      'aria-label': `Editar designação`, onclick: () => formDesignacao(d) }, '✏️'),
    el('button', { class: 'btn btn--icon btn--ghost', type: 'button',
      'aria-label': `Excluir designação`, onclick: () => excluirDesignacao(d) }, '🗑️'),
  );
}

function formDesignacao(d, descricaoInicial = '', reuniaoId = null) {
  const descricao = el('input', { class: 'input', value: d?.descricao ?? descricaoInicial });
  const responsavel = el('input', { class: 'input', value: d?.responsavel ?? '', placeholder: 'quem ficou responsável' });
  const prazo = el('input', { class: 'input', type: 'date', value: d?.prazo ?? somaDias(hoje(), 7) });

  return modal({
    titulo: d ? 'Editar designação' : 'Nova designação',
    corpo: el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'O que precisa ser feito'), descricao),
      el('div', { class: 'field' }, el('label', {}, 'Responsável'), responsavel),
      el('div', { class: 'field' }, el('label', {}, 'Prazo'), prazo,
        el('p', { class: 'field__hint' }, 'Fora do prazo, ela aparece destacada na próxima reunião.')),
    ),
    aoConfirmar: async () => {
      const dados = {
        descricao: descricao.value.trim(),
        responsavel: responsavel.value.trim() || null,
        prazo: prazo.value || null,
      };
      if (dados.descricao.length < 3) throw new Error('Descreva a designação.');

      if (d) await ctx.db.atualizar(COL_DESIGNACOES, d.id, dados);
      else await ctx.db.inserir(COL_DESIGNACOES, { ...dados, reuniao_id: reuniaoId ?? reuniaoSel, concluida: false });
      await recarregar();
      pintar();
      toast(d ? 'Atualizada.' : 'Designação criada.', 'ok');
    },
  });
}

async function excluirDesignacao(d) {
  if (!await confirmar('Excluir designação', d.descricao, { confirmar: 'Excluir' })) return;
  await ctx.db.remover(COL_DESIGNACOES, d.id);
  await recarregar();
  pintar();
  toast('Excluída.');
}

/* ---------------------------------------------------------------------------
   Plano da ala
--------------------------------------------------------------------------- */

function painelPlano() {
  const textoDe = (secao) => plano.find(p => p.secao === secao)?.texto ?? '';

  const salvar = async (secao, texto) => {
    const existente = plano.find(p => p.secao === secao);
    try {
      if (existente) await ctx.db.atualizar(COL_PLANO, existente.id, { texto, atualizado_em: new Date().toISOString() });
      else await ctx.db.inserir(COL_PLANO, { secao, texto });
      await recarregar();
      toast('Plano salvo.', 'ok');
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  };

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__body' },
        el('p', { class: 'small muted' },
          'O plano da ala para compartilhar o evangelho é feito pelo presidente do quórum de ' +
          'élderes, pela presidente da Sociedade de Socorro e pelo líder de missão, com aprovação ' +
          'do bispo. Salva ao sair do campo.'),
      )),
    ...SECOES_PLANO.map(s => {
      const txt = el('textarea', { class: 'textarea', rows: 4, placeholder: s.dica }, textoDe(s.key));
      txt.addEventListener('change', () => salvar(s.key, txt.value.trim()));
      return el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('span', { class: 'card__title' }, s.titulo),
          el('span', { class: 'small muted' }, s.dica),
        ),
        el('div', { class: 'card__body' }, txt),
      );
    }),
  );
}

/* ---------------------------------------------------------------------------
   Pauta para imprimir
--------------------------------------------------------------------------- */

function imprimirPauta(r, p) {
  const nomeArea = (id) => areas.find(a => a.id === id)?.nome ?? '';
  const linhas = [];

  linhas.push(`REUNIÃO DE COORDENAÇÃO MISSIONÁRIA`);
  linhas.push(`Ala Queimados — ${dataLonga(r.data)}`);
  linhas.push('');

  linhas.push(`PESSOAS PROGREDINDO (${p.emProgresso.length})`);
  p.emProgresso.forEach(x => linhas.push(
    `  · ${x.nome} — ${nomeArea(x.area_id)}${x.organizacao ? `, ${x.organizacao}` : ''}` +
    `${x.sacramentais ? `, ${x.sacramentais} sacramentais` : ''}`));
  if (!p.emProgresso.length) linhas.push('  (ninguém lançado nesta semana)');
  linhas.push('');

  linhas.push(`DATAS DE BATISMO MARCADAS (${p.comData.length})`);
  p.comData.forEach(x => linhas.push(`  · ${dataCurta(x.data_batismo)} — ${x.nome} (${nomeArea(x.area_id)})`));
  if (!p.comData.length) linhas.push('  (nenhuma)');
  linhas.push('');

  linhas.push(`MEMBROS NOVOS PRECISANDO DE ATENÇÃO (${p.emAtraso.length})`);
  p.emAtraso.forEach(x => {
    const avisos = alertasDoCaminho(x, camMarcos, camFreq).filter(a => a.tom !== 'mute').map(a => a.texto);
    linhas.push(`  · ${x.nome} — ${avisos.join('; ')}`);
  });
  if (!p.emAtraso.length) linhas.push('  (todos em dia)');
  linhas.push('');

  linhas.push(`ALMOÇOS SEM VOLUNTÁRIO — PRÓXIMOS 7 DIAS (${p.vagas.length})`);
  p.vagas.forEach(v => linhas.push(`  · ${dataCurta(v.data)} — ${v.area.nome}`));
  if (!p.vagas.length) linhas.push('  (todas as duplas atendidas)');
  linhas.push('');

  const abertas = designacoes.filter(d => !d.concluida);
  linhas.push(`DESIGNAÇÕES EM ABERTO (${abertas.length})`);
  abertas.forEach(d => linhas.push(
    `  [ ] ${d.descricao}${d.responsavel ? ` — ${d.responsavel}` : ''}${d.prazo ? ` (até ${dataCurta(d.prazo)})` : ''}`));
  if (!abertas.length) linhas.push('  (nenhuma)');

  const texto = linhas.join('\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const a = el('a', { href: url, download: `coordenacao-${r.data}.txt` });
  a.click();
  URL.revokeObjectURL(url);
  toast('Pauta gerada.', 'ok');
}
