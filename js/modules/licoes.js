/**
 * Lições com os missionários.
 *
 * Duas coisas diferentes moram aqui, e a planilha só tinha a primeira:
 *
 *  1. Disponibilidade recorrente — a matriz da planilha: membro × modalidade
 *     × dia da semana × faixa de horário. Não tem data; vale toda semana.
 *
 *  2. Agenda datada — a lição de verdade, marcada num dia e horário, com a
 *     mesma trava do almoço para duas pessoas não pegarem o mesmo espaço.
 *
 * A disponibilidade guarda telefone, então o RLS deixa o membro GRAVAR mas
 * não LER. O formulário é de mão única de propósito: preencheu, some. Quem
 * enxerga a matriz completa é o LMA.
 */

import {
  AREAS_PADRAO, DIAS, HORARIOS, MESES, MODALIDADES_LICAO, corDaArea,
} from '../config.js';
import { ConflitoError } from '../db.js';
import { chave, comparaNome, dataCurta, diasDoMes, hoje } from '../util.js';
import { confirmar, el, modal, toast, vazio, conexao } from '../ui.js';

const COL_DISP   = 'disponibilidade_licoes';
const COL_AGENDA = 'licoes_agenda';

let ctx, raiz;
let aba = null;
let modalidadeVista = 'presencial';
let ano, mes;
let areas = [], disponibilidade = [], agenda = [];
let desligarRealtime = null;

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;

  const agora = new Date();
  ano ??= agora.getFullYear();
  mes ??= agora.getMonth();
  aba ??= ctx.db.ehAdmin() ? 'semana' : 'minha';

  await recarregar();

  desligarRealtime?.();
  const parar = [
    ctx.db.observar(COL_AGENDA, aoMudarRemoto),
    ctx.db.observar(COL_DISP, aoMudarRemoto),
  ];
  desligarRealtime = () => parar.forEach(f => f?.());
  new MutationObserver((_m, obs) => {
    if (!raiz.isConnected) { desligarRealtime?.(); obs.disconnect(); }
  }).observe(document.body, { childList: true, subtree: true });

  pintar();
}

async function aoMudarRemoto() {
  await recarregar();
  if (raiz.isConnected) pintar();
}

async function recarregar() {
  const [as, ds, ag] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar(COL_DISP),
    ctx.db.listar(COL_AGENDA),
  ]);
  areas = (as.length ? as : AREAS_PADRAO).filter(a => a.ativa !== false);
  // A tabela não tem unicidade (ver supabase/schema.sql), então quem reenviou
  // o formulário aparece repetido. Fica com a linha mais recente de cada
  // combinação, que é a que traz o telefone atualizado.
  disponibilidade = [...new Map(
    [...ds]
      .sort((a, b) => String(a.criado_em ?? '').localeCompare(String(b.criado_em ?? '')))
      .map(d => [`${chave(d.nome)}|${d.modalidade}|${d.dia}|${d.horario}`, d]),
  ).values()];
  agenda = ag;
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

function pintar() {
  const admin = ctx.db.ehAdmin();
  const abas = [
    { id: 'minha',  rotulo: '✍️ Minha disponibilidade' },
    admin && { id: 'semana', rotulo: '🗓️ Disponibilidade da ala' },
    { id: 'agenda', rotulo: '📌 Lições marcadas' },
  ].filter(Boolean);

  if (!abas.some(a => a.id === aba)) aba = abas[0].id;

  const paineis = { minha: painelMinha, semana: painelSemana, agenda: painelAgenda };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '📖 Lições com os missionários'),
      el('p', {}, 'Diga quando você pode acompanhar uma lição, e veja as que já estão marcadas.'),
    ),
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('div', { class: 'chips' },
        ...abas.map(a => el('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(aba === a.id),
          onclick: () => { aba = a.id; pintar(); },
        }, a.rotulo)),
      ),
      el('span', { class: 'spacer' }),
      conexao(ctx.db.temBackend() ? 'live' : 'off'),
    ),
    paineis[aba](),
  );
}

/** Alternador de modalidade, compartilhado por dois painéis. */
function seletorModalidade() {
  return el('div', { class: 'chips' },
    ...MODALIDADES_LICAO.map(m => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(modalidadeVista === m.key),
      onclick: () => { modalidadeVista = m.key; pintar(); },
    }, `${m.icone} ${m.label}`)),
  );
}

/* ---------------------------------------------------------------------------
   Minha disponibilidade — formulário de mão única
--------------------------------------------------------------------------- */

function painelMinha() {
  const nome = el('input', { class: 'input', autocomplete: 'name', placeholder: 'como a ala te conhece' });
  const telefone = el('input', { class: 'input', type: 'tel', autocomplete: 'tel', placeholder: '21 90000-0000' });

  // Estado local da grade: Set de "modalidade|dia|horario".
  const marcados = new Set();
  const contador = el('span', { class: 'small muted' }, 'nenhum horário marcado');

  const atualizarContador = () => {
    const n = marcados.size;
    contador.textContent = n === 0 ? 'nenhum horário marcado'
      : `${n} horário${n > 1 ? 's' : ''} marcado${n > 1 ? 's' : ''}`;
  };

  const grade = (modalidade) => {
    const corpo = el('tbody');
    for (const dia of DIAS) {
      const tr = el('tr', {}, el('td', { class: 'nowrap', style: 'font-weight:600' }, dia.label));
      for (const h of HORARIOS) {
        const id = `${modalidade}|${dia.key}|${h}`;
        const cel = el('button', {
          class: 'slot', type: 'button', 'aria-pressed': 'false',
          'aria-label': `${dia.label}, ${h}`,
          onclick: () => {
            const ligado = marcados.has(id);
            if (ligado) marcados.delete(id); else marcados.add(id);
            cel.setAttribute('aria-pressed', String(!ligado));
            atualizarContador();
          },
        }, '✓');
        tr.append(el('td', {}, cel));
      }
      corpo.append(tr);
    }
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'table table--grade' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Dia'),
          ...HORARIOS.map(h => el('th', { class: 'center nowrap' }, h.replace(' - ', '–'))),
        )),
        corpo,
      ));
  };

  const abasModalidade = el('div', { class: 'chips', style: 'margin-bottom:.75rem' });
  const areaGrade = el('div');
  let modalidadeForm = 'presencial';

  const desenharGrade = () => {
    abasModalidade.replaceChildren(
      ...MODALIDADES_LICAO.map(m => el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(modalidadeForm === m.key),
        onclick: () => { modalidadeForm = m.key; desenharGrade(); },
      }, `${m.icone} ${m.label}`)),
    );
    // Redesenha a grade, reaplicando o que já estava marcado nesta modalidade.
    const g = grade(modalidadeForm);
    areaGrade.replaceChildren(g);
    for (const cel of g.querySelectorAll('.slot')) {
      const [dia, h] = cel.getAttribute('aria-label').split(', ');
      const diaKey = DIAS.find(d => d.label === dia).key;
      const horario = HORARIOS.find(x => x.replace(' - ', '–') === h) ?? h;
      if (marcados.has(`${modalidadeForm}|${diaKey}|${horario}`)) cel.setAttribute('aria-pressed', 'true');
    }
  };
  desenharGrade();

  const enviar = el('button', { class: 'btn btn--primary', type: 'button' }, 'Enviar disponibilidade');
  enviar.addEventListener('click', async () => {
    const n = nome.value.trim();
    if (n.length < 2) return toast('Digite seu nome.', 'err');
    if (!marcados.size) return toast('Marque ao menos um horário.', 'err');

    const registros = [...marcados].map(id => {
      const [modalidade, dia, horario] = id.split('|');
      return { nome: n, telefone: telefone.value.trim() || null, modalidade, dia, horario };
    });

    enviar.disabled = true;
    try {
      await ctx.db.inserirVarios(COL_DISP, registros);
      raiz.replaceChildren(recibo(n, registros));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      enviar.disabled = false;
      toast(err.message || 'Não foi possível enviar.', 'err');
    }
  });

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'Quando você pode acompanhar uma lição?'),
        contador,
      ),
      el('div', { class: 'card__body' },
        el('div', { class: 'grid grid--2', style: 'margin-bottom:1rem' },
          el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Seu nome'), nome),
          el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Telefone'), telefone,
            el('p', { class: 'field__hint' }, 'Só o líder de missão vê este número.')),
        ),
        abasModalidade,
        areaGrade,
        el('p', { class: 'small muted', style: 'margin-top:.75rem' },
          'Marque os horários em que você costuma estar livre — vale para toda semana, ' +
          'não é uma data específica. Enviar de novo acrescenta horários; para tirar ' +
          'algum, fale com o líder de missão.'),
        el('div', { style: 'margin-top:1rem' }, enviar),
      ),
    ),
  );
}

/** Confirmação após o envio. O membro não consegue reler o que gravou. */
function recibo(nome, registros) {
  const porModalidade = MODALIDADES_LICAO.map(m => ({
    ...m,
    itens: registros.filter(r => r.modalidade === m.key),
  })).filter(x => x.itens.length);

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, '✅ Disponibilidade registrada'),
      ),
      el('div', { class: 'card__body' },
        el('p', { style: 'margin-bottom:.75rem' }, `Obrigado, ${nome}. Ficou assim:`),
        ...porModalidade.map(m => el('div', { style: 'margin-bottom:.75rem' },
          el('div', { style: 'font-weight:600;margin-bottom:.25rem' }, `${m.icone} ${m.label}`),
          el('ul', { class: 'small muted', style: 'padding-left:1.125rem' },
            ...DIAS.map(d => {
              const hs = m.itens.filter(i => i.dia === d.key).map(i => i.horario);
              return hs.length ? el('li', {}, `${d.label}: ${hs.join(', ')}`) : null;
            }).filter(Boolean),
          ),
        )),
        el('p', { class: 'small muted' },
          'Guarde este resumo se quiser. Por privacidade, esta lista só fica visível para o líder de missão.'),
        el('div', { class: 'row', style: 'margin-top:1rem' },
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => pintar() },
            'Enviar outra disponibilidade'),
        ),
      ),
    ),
  );
}

/* ---------------------------------------------------------------------------
   Disponibilidade da ala — só o LMA
--------------------------------------------------------------------------- */

function painelSemana() {
  if (!ctx.db.ehAdmin()) return vazio('Acesso restrito', 'Esta grade é do LMA.', '🔒');

  const daModalidade = disponibilidade.filter(d => d.modalidade === modalidadeVista);
  if (!disponibilidade.length) {
    return el('div', {},
      seletorModalidade(),
      el('div', { class: 'card', style: 'margin-top:1rem' },
        vazio('Ninguém cadastrou ainda',
              'Compartilhe o link da aba "Minha disponibilidade" com a ala.', '🗓️')),
    );
  }

  const gente = (dia, horario) =>
    daModalidade.filter(d => d.dia === dia && d.horario === horario);

  const maximo = Math.max(1, ...DIAS.flatMap(d => HORARIOS.map(h => gente(d.key, h).length)));

  const corpo = el('tbody', {}, ...DIAS.map(dia =>
    el('tr', {},
      el('td', { class: 'nowrap', style: 'font-weight:600' }, dia.label),
      ...HORARIOS.map(h => {
        const pessoas = gente(dia.key, h);
        const nivel = pessoas.length === 0 ? 0
          : Math.min(6, 1 + Math.floor((pessoas.length / maximo) * 5.999));
        const cel = el('button', {
          class: 'densidade', type: 'button',
          style: `background:var(--seq-${nivel});color:${nivel >= 4 ? '#fff' : 'var(--text)'}`,
          'aria-label': `${dia.label}, ${h}: ${pessoas.length} disponível(is)`,
          disabled: !pessoas.length,
          onclick: () => listarPessoas(dia, h, pessoas),
        }, pessoas.length || '');
        return el('td', {}, cel);
      }),
    )));

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      seletorModalidade(),
      el('span', { class: 'spacer' }),
      el('span', { class: 'small muted' },
        `${new Set(daModalidade.map(d => chave(d.nome))).size} pessoa(s) nesta modalidade`),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'Quantos podem acompanhar, por dia e horário'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportarCSV }, '⬇ CSV'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table table--grade' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Dia'),
            ...HORARIOS.map(h => el('th', { class: 'center nowrap' }, h.replace(' - ', '–'))),
          )),
          corpo,
        )),
      el('div', { class: 'card__body', style: 'padding-top:.75rem' },
        el('div', { class: 'viz__escala' },
          el('span', { class: 'small muted' }, '0'),
          ...Array.from({ length: 7 }, (_, i) =>
            el('span', { class: 'viz__degrau', style: `background:var(--seq-${i})` })),
          el('span', { class: 'small muted' }, String(maximo)),
        ),
        el('p', { class: 'small muted', style: 'margin-top:.5rem' },
          'Toque numa célula para ver os nomes e telefones.'),
      ),
    ),
  );
}

function listarPessoas(dia, horario, pessoas) {
  const porNome = [...new Map(pessoas.map(p => [chave(p.nome), p])).values()]
    .sort((a, b) => comparaNome(a.nome, b.nome));

  return modal({
    titulo: `${dia.label}, ${horario}`,
    corpo: el('div', {},
      el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
        `${porNome.length} pessoa(s) disponível(is)`),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Nome'), el('th', {}, 'Telefone'), el('th', {}, ''))),
          el('tbody', {}, ...porNome.map(p => el('tr', {},
            el('td', {}, el('strong', {}, p.nome)),
            el('td', { class: 'small' }, p.telefone || '—'),
            el('td', {}, el('button', {
              class: 'btn btn--icon btn--ghost', type: 'button',
              'aria-label': `Remover ${p.nome} deste horário`,
              onclick: async () => {
                if (!await confirmar('Remover disponibilidade',
                  `Tirar ${p.nome} de ${dia.label}, ${horario}?`, { confirmar: 'Remover' })) return;
                await ctx.db.remover(COL_DISP, p.id);
                await recarregar();
                pintar();
                toast('Removido.');
              },
            }, '🗑️')),
          ))),
        )),
    ),
    confirmar: null,
    cancelar: 'Fechar',
  });
}

function exportarCSV() {
  const cab = ['Nome', 'Telefone', 'Modalidade', 'Dia', 'Horário'];
  const linhas = [...disponibilidade]
    .sort((a, b) => comparaNome(a.nome, b.nome))
    .map(d => [
      d.nome, d.telefone ?? '',
      MODALIDADES_LICAO.find(m => m.key === d.modalidade)?.label ?? d.modalidade,
      DIAS.find(x => x.key === d.dia)?.label ?? d.dia,
      d.horario,
    ]);

  const csv = [cab, ...linhas]
    .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: 'disponibilidade-licoes.csv' });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV gerado.', 'ok');
}

/* ---------------------------------------------------------------------------
   Lições marcadas — agenda datada
--------------------------------------------------------------------------- */

function painelAgenda() {
  const dias = diasDoMes(ano, mes).filter(d => d.data >= hoje().slice(0, 8) + '01');
  const doMes = agenda.filter(a => a.data.startsWith(`${ano}-${String(mes + 1).padStart(2, '0')}`));

  const mudarMes = (passo) => {
    const d = new Date(ano, mes + passo, 1);
    ano = d.getFullYear(); mes = d.getMonth();
    pintar();
  };

  const corpo = el('tbody', {}, ...dias.map(d => {
    const doDia = doMes.filter(a => a.data === d.data)
      .sort((a, b) => a.horario.localeCompare(b.horario));
    const passado = d.data < hoje();

    return el('tr', { style: passado ? 'opacity:.55' : '' },
      el('td', { class: 'nowrap', style: d.dow === 0 ? 'font-weight:600' : '' },
        `${String(d.dia).padStart(2, '0')} · ${DIAS.find(x => x.dow === d.dow).abbr}`),
      el('td', {},
        doDia.length
          ? el('div', { class: 'stack', style: 'gap:.375rem' }, ...doDia.map(a => marcada(a)))
          : el('span', { class: 'small muted' }, '—'),
      ),
      el('td', {},
        passado ? null : el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: () => abrirAgendamento(d),
        }, '+ marcar'),
      ),
    );
  }));

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      el('strong', { style: 'min-width:9rem;text-align:center' }, `${MESES[mes]} ${ano}`),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Próximo mês', onclick: () => mudarMes(+1) }, '›'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'small muted' }, `${doMes.length} lição(ões) no mês`),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', { style: 'min-width:6rem' }, 'Dia'),
            el('th', {}, 'Lições'),
            el('th', {}, ''),
          )),
          corpo,
        )),
    ),
  );
}

function marcada(a) {
  const area = areas.find(x => x.id === a.area_id);
  const m = MODALIDADES_LICAO.find(x => x.key === a.modalidade);
  return el('div', { class: 'row' },
    el('span', { class: 'badge badge--mute nowrap' }, a.horario),
    el('span', { class: 'dot', style: `background:${corDaArea(area?.cor ?? 0)}` }),
    el('span', {}, `${m?.icone ?? ''} ${a.nome}`),
    a.observacao && el('span', { class: 'small muted' }, `· ${a.observacao}`),
    ctx.db.ehAdmin() && el('button', {
      class: 'btn btn--icon btn--ghost', type: 'button',
      'aria-label': `Desmarcar ${a.nome} em ${dataCurta(a.data)}`,
      onclick: async () => {
        if (!await confirmar('Desmarcar lição',
          `Remover ${a.nome} de ${dataCurta(a.data)}, ${a.horario}?`, { confirmar: 'Desmarcar' })) return;
        await ctx.db.remover(COL_AGENDA, a.id);
        await recarregar();
        pintar();
        toast('Lição desmarcada.');
      },
    }, '✕'),
  );
}

async function abrirAgendamento(d) {
  const diaKey = DIAS.find(x => x.dow === d.dow).key;

  const horario = el('select', { class: 'select' },
    ...HORARIOS.map(h => el('option', { value: h }, h)));
  const area = el('select', { class: 'select' },
    ...areas.map(a => el('option', { value: a.id }, a.nome)));
  const modalidade = el('select', { class: 'select' },
    ...MODALIDADES_LICAO.map(m => el('option', { value: m.key }, `${m.icone} ${m.label}`)));
  const nome = el('input', { class: 'input', placeholder: 'quem vai acompanhar' });
  const obs = el('input', { class: 'input', placeholder: 'opcional — quem será ensinado, endereço…' });

  // Só o LMA enxerga a disponibilidade, então só para ele dá para sugerir nomes.
  const sugestao = el('p', { class: 'field__hint' });
  const atualizarSugestao = () => {
    if (!ctx.db.ehAdmin()) return;
    const livres = disponibilidade.filter(x =>
      x.dia === diaKey && x.horario === horario.value && x.modalidade === modalidade.value);
    const nomes = [...new Set(livres.map(x => x.nome))].sort(comparaNome);
    sugestao.textContent = nomes.length
      ? `Disponíveis neste horário: ${nomes.join(', ')}`
      : 'Ninguém marcou disponibilidade neste horário.';
  };
  horario.addEventListener('change', atualizarSugestao);
  modalidade.addEventListener('change', atualizarSugestao);
  atualizarSugestao();

  const corpo = el('div', {},
    el('div', { class: 'card', style: 'margin-bottom:1rem;background:var(--surface-2)' },
      el('div', { class: 'card__body', style: 'padding:.75rem' },
        el('strong', {}, dataCurta(d.data)), ' · ',
        DIAS.find(x => x.dow === d.dow).label)),
    el('div', { class: 'field' }, el('label', {}, 'Horário'), horario),
    el('div', { class: 'field' }, el('label', {}, 'Modalidade'), modalidade),
    el('div', { class: 'field' }, el('label', {}, 'Dupla / área'), area),
    el('div', { class: 'field' }, el('label', {}, 'Membro que acompanha'), nome, sugestao),
    el('div', { class: 'field' }, el('label', {}, 'Observação'), obs),
  );

  await modal({
    titulo: 'Marcar lição',
    corpo,
    confirmar: 'Marcar',
    aoConfirmar: async () => {
      const v = nome.value.trim();
      if (v.length < 2) throw new Error('Informe quem vai acompanhar.');

      try {
        await ctx.db.reservar(COL_AGENDA, {
          data: d.data,
          horario: horario.value,
          area_id: area.value,
          nome: v,
          modalidade: modalidade.value,
          observacao: obs.value.trim() || null,
        });
      } catch (err) {
        if (err instanceof ConflitoError) {
          await recarregar();
          pintar();
          throw new Error('Essa dupla já tem lição nesse horário. A agenda foi atualizada.');
        }
        throw err;
      }

      await recarregar();
      pintar();
      toast(`Lição marcada para ${dataCurta(d.data)}, ${horario.value}.`, 'ok');
    },
  });
}
