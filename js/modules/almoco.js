/**
 * Calendário de almoço dos missionários.
 *
 * Uma vaga por dupla em cada dia — a mesma grade da planilha, onde cada dia
 * tinha quatro linhas. Segunda é P-Day e fica bloqueada; terça mostra a
 * etiqueta da mesada mas aceita agendamento.
 *
 * Depois de gravado, o membro não altera a própria escolha: só o LMA.
 */

import { AREAS_PADRAO, MARCAS_SEMANA, MESES, MODALIDADES_ALMOCO, PERIODICIDADES, corDaArea } from '../config.js';
import { ConflitoError } from '../db.js';
import { chave, comparaNome, dataCurta, diasDoMes, hoje } from '../util.js';
import { $, confirmar, el, modal, toast, vazio, conexao } from '../ui.js';

const COL_AGENDA = 'almoco_agenda';
const COL_VOL    = 'voluntarios_almoco';

let ctx, raiz;
let aba = 'calendario';
let ano, mes;
let areas = [], agenda = [], voluntarios = [];
let desligarRealtime = null;

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;

  const agora = new Date();
  ano ??= agora.getFullYear();
  mes ??= agora.getMonth();

  await recarregar();

  desligarRealtime?.();
  const parar = [
    ctx.db.observar(COL_AGENDA, aoMudarRemoto),
    ctx.db.observar(COL_VOL, aoMudarRemoto),
  ];
  desligarRealtime = () => parar.forEach(f => f?.());

  // O módulo é descartado quando a rota muda; solta as inscrições junto.
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
  const [as, ag, vs] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar(COL_AGENDA),
    ctx.db.listar(COL_VOL),
  ]);
  areas = (as.length ? as : AREAS_PADRAO).filter(a => a.ativa !== false);
  agenda = ag;
  voluntarios = vs.sort((a, b) => comparaNome(a.nome, b.nome));
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

function pintar() {
  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '🍽️ Almoço dos missionários'),
      el('p', {}, 'Escolha um dia livre e coloque seu nome. Depois de gravado, só o LMA altera.'),
    ),
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('div', { class: 'chips' },
        botaoAba('calendario', '📅 Calendário'),
        ctx.db.ehAdmin() && botaoAba('voluntarios', `👥 Voluntários (${voluntarios.length})`),
      ),
      el('span', { class: 'spacer' }),
      conexao(ctx.db.temBackend() ? 'live' : 'off'),
    ),
    aba === 'voluntarios' ? painelVoluntarios() : painelCalendario(),
  );
}

const botaoAba = (id, rotulo) =>
  el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(aba === id),
    onclick: () => { aba = id; pintar(); },
  }, rotulo);

/* ---------------------------------------------------------------------------
   Calendário
--------------------------------------------------------------------------- */

function painelCalendario() {
  const dias = diasDoMes(ano, mes);
  const marcados = agenda.filter(a => a.data.startsWith(`${ano}-${String(mes + 1).padStart(2, '0')}`));
  const vagasTotais = dias.filter(d => !MARCAS_SEMANA[d.dow]?.bloqueia).length * areas.length;

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
        el('strong', { style: 'min-width:9rem;text-align:center' }, `${MESES[mes]} ${ano}`),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Próximo mês', onclick: () => mudarMes(+1) }, '›'),
      ),
      el('span', { class: 'small muted tnum' }, `${marcados.length} de ${vagasTotais} vagas preenchidas`),
    ),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {},
          el('tr', {},
            el('th', { style: 'min-width:7rem' }, 'Dia'),
            ...areas.map(a => el('th', {},
              el('span', { class: 'dot', style: `background:${corDaArea(a.cor ?? 0)};margin-right:.375rem` }),
              a.nome)),
          )),
        el('tbody', {}, ...dias.map(linhaDoDia)),
      )),
  );
}

function linhaDoDia(d) {
  const marca = MARCAS_SEMANA[d.dow];
  const passado = d.data < hoje();
  const fds = d.dow === 0 || d.dow === 6;

  const rotulo = el('td', { style: fds ? 'font-weight:600' : '' },
    el('div', {}, `${String(d.dia).padStart(2, '0')} · ${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.dow]}`),
    marca && el('span', { class: `badge badge--${marca.bloqueia ? 'mute' : 'warn'}`, style: 'margin-top:.25rem' }, marca.rotulo),
  );
  if (passado) rotulo.style.opacity = '.5';

  return el('tr', {}, rotulo, ...areas.map(a => celula(d, a, marca, passado)));
}

function celula(d, area, marca, passado) {
  const td = el('td');

  if (marca?.bloqueia) {
    td.append(el('span', { class: 'small muted' }, '—'));
    return td;
  }

  const reserva = agenda.find(x => x.data === d.data && x.area_id === area.id);

  if (reserva) {
    const modalidade = MODALIDADES_ALMOCO.find(m => m.key === reserva.modalidade);
    td.append(el('div', { class: 'row' },
      el('span', {}, `${modalidade?.icone ?? '🍽️'} ${reserva.nome}`),
      ctx.db.ehAdmin() && el('button', {
        class: 'btn btn--icon btn--ghost', type: 'button',
        'aria-label': `Liberar ${dataCurta(d.data)} — ${area.nome}`,
        onclick: () => liberar(reserva, d, area),
      }, '✕'),
    ));
    if (passado) td.style.opacity = '.55';
    return td;
  }

  if (passado) {
    td.append(el('span', { class: 'small muted' }, 'vago'));
    return td;
  }

  td.append(el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', style: 'width:100%;color:var(--text-3)',
    onclick: () => abrirReserva(d, area),
  }, '+ livre'));
  return td;
}

function mudarMes(passo) {
  const d = new Date(ano, mes + passo, 1);
  ano = d.getFullYear();
  mes = d.getMonth();
  pintar();
}

/* ---------------------------------------------------------------------------
   Reservar
--------------------------------------------------------------------------- */

async function abrirReserva(d, area) {
  const nome = el('input', {
    class: 'input', list: 'lista-vol', autocomplete: 'off',
    placeholder: 'Seu nome ou o do casal',
  });
  const datalist = el('datalist', { id: 'lista-vol' },
    ...voluntarios.map(v => el('option', { value: v.nome })));

  const modalidade = el('select', { class: 'select' },
    ...MODALIDADES_ALMOCO.map(m => el('option', { value: m.key }, `${m.icone} ${m.label}`)));

  const obs = el('input', { class: 'input', placeholder: 'opcional — combinar horário, ponto de entrega…' });

  const corpo = el('div', {},
    el('div', { class: 'card', style: 'margin-bottom:1rem;background:var(--surface-2)' },
      el('div', { class: 'card__body', style: 'padding:.75rem' },
        el('div', {}, el('strong', {}, dataCurta(d.data)), ' · ', area.nome),
        el('div', { class: 'small muted' }, ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][d.dow]),
      )),
    el('div', { class: 'field' }, el('label', {}, 'Nome'), nome, datalist,
      el('p', { class: 'field__hint' }, 'Se você já está na lista, o nome aparece ao digitar.')),
    el('div', { class: 'field' }, el('label', {}, 'Como vai fornecer'), modalidade),
    el('div', { class: 'field' }, el('label', {}, 'Observação'), obs),
    el('p', { class: 'small muted' }, 'Depois de gravar, procure o LMA se precisar mudar.'),
  );

  await modal({
    titulo: 'Reservar este dia',
    corpo,
    confirmar: 'Reservar',
    aoConfirmar: async () => {
      const v = nome.value.trim();
      if (v.length < 2) throw new Error('Digite seu nome.');

      try {
        await ctx.db.reservar(COL_AGENDA, {
          data: d.data,
          area_id: area.id,
          nome: v,
          modalidade: modalidade.value,
          observacao: obs.value.trim() || null,
        });
      } catch (err) {
        if (err instanceof ConflitoError) {
          await recarregar();
          pintar();
          throw new Error('Alguém acabou de reservar esse dia. A grade foi atualizada.');
        }
        throw err;
      }

      await recarregar();
      pintar();
      toast(`${dataCurta(d.data)} reservado. Obrigado!`, 'ok');
    },
  });
}

async function liberar(reserva, d, area) {
  const ok = await confirmar(
    'Liberar a vaga',
    `Remover ${reserva.nome} de ${dataCurta(d.data)} — ${area.nome}?`,
    { confirmar: 'Liberar' },
  );
  if (!ok) return;
  await ctx.db.remover(COL_AGENDA, reserva.id);
  await recarregar();
  pintar();
  toast('Vaga liberada.');
}

/* ---------------------------------------------------------------------------
   Voluntários — somente LMA, porque a lista traz telefone e endereço
--------------------------------------------------------------------------- */

function painelVoluntarios() {
  if (!ctx.db.ehAdmin()) return vazio('Acesso restrito', 'Esta lista é do LMA.', '🔒');

  const busca = el('input', { class: 'input', type: 'search', placeholder: 'Buscar por nome…', style: 'max-width:16rem' });
  const corpo = el('tbody');

  const desenhar = () => {
    const q = chave(busca.value);
    const lista = voluntarios.filter(v => !q || chave(v.nome).includes(q));

    corpo.replaceChildren(...(lista.length ? lista.map(v => {
      const m = MODALIDADES_ALMOCO.find(x => x.key === v.modalidade);
      const p = PERIODICIDADES.find(x => x.key === v.periodicidade);
      return el('tr', {},
        el('td', {}, el('strong', {}, v.nome)),
        el('td', { class: 'small' }, v.telefone || '—'),
        el('td', { class: 'small', style: 'white-space:normal;max-width:20rem' }, v.endereco || '—'),
        el('td', { class: 'num' }, v.duplas ?? 1),
        el('td', { class: 'small' }, m ? `${m.icone} ${m.label}` : '—'),
        el('td', { class: 'small' }, p?.label ?? '—'),
        el('td', {}, el('div', { class: 'row' },
          el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Editar ${v.nome}`, onclick: () => formVoluntario(v) }, '✏️'),
          el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Excluir ${v.nome}`, onclick: () => excluirVoluntario(v) }, '🗑️'),
        )),
      );
    }) : [el('tr', {}, el('td', { colspan: 7 },
      vazio(q ? 'Nenhum voluntário encontrado' : 'Lista vazia',
            q ? 'Tente outro nome.' : 'Cadastre quem se dispôs a fornecer almoço.', '👥')))]));
  };

  busca.addEventListener('input', desenhar);
  desenhar();

  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      busca,
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formVoluntario(null) }, '+ Voluntário'),
    ),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Nome'), el('th', {}, 'Telefone'), el('th', {}, 'Endereço'),
          el('th', {}, 'Duplas'), el('th', {}, 'Modalidade'), el('th', {}, 'Periodicidade'), el('th', {}, ''),
        )),
        corpo,
      )),
  );
}

function formVoluntario(v) {
  const nome     = el('input', { class: 'input', value: v?.nome ?? '' });
  const telefone = el('input', { class: 'input', type: 'tel', value: v?.telefone ?? '', placeholder: '21 90000-0000' });
  const endereco = el('textarea', { class: 'textarea', rows: 2 }, v?.endereco ?? '');
  const duplas   = el('select', { class: 'select' },
    ...[1, 2, 3, 4].map(n => el('option', { value: n, selected: (v?.duplas ?? 1) === n }, `${n} dupla${n > 1 ? 's' : ''}`)));
  const modalidade = el('select', { class: 'select' },
    ...MODALIDADES_ALMOCO.map(m => el('option', { value: m.key, selected: v?.modalidade === m.key }, `${m.icone} ${m.label}`)));
  const periodicidade = el('select', { class: 'select' },
    ...PERIODICIDADES.map(p => el('option', { value: p.key, selected: (v?.periodicidade ?? 'livre') === p.key }, p.label)));
  const obs = el('textarea', { class: 'textarea', rows: 2 }, v?.observacoes ?? '');

  const corpo = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nome'), nome),
    el('div', { class: 'field' }, el('label', {}, 'Telefone'), telefone),
    el('div', { class: 'field' }, el('label', {}, 'Endereço'), endereco),
    el('div', { class: 'field' }, el('label', {}, 'Quantas duplas consegue atender'), duplas,
      el('p', { class: 'field__hint' }, 'Era a coluna "Duplas" da planilha — quantas duplas, não quantas porções.')),
    el('div', { class: 'field' }, el('label', {}, 'Como fornece'), modalidade),
    el('div', { class: 'field' }, el('label', {}, 'Periodicidade preferida'), periodicidade),
    el('div', { class: 'field' }, el('label', {}, 'Observações'), obs),
  );

  return modal({
    titulo: v ? 'Editar voluntário' : 'Novo voluntário',
    corpo,
    aoConfirmar: async () => {
      const dados = {
        nome: nome.value.trim(),
        telefone: telefone.value.trim() || null,
        endereco: endereco.value.trim() || null,
        duplas: Number(duplas.value),
        modalidade: modalidade.value,
        periodicidade: periodicidade.value,
        observacoes: obs.value.trim() || null,
      };
      if (dados.nome.length < 2) throw new Error('Informe o nome.');

      if (v) await ctx.db.atualizar(COL_VOL, v.id, dados);
      else   await ctx.db.inserir(COL_VOL, dados);

      await recarregar();
      pintar();
      toast(v ? 'Voluntário atualizado.' : 'Voluntário cadastrado.', 'ok');
    },
  });
}

async function excluirVoluntario(v) {
  const ok = await confirmar('Excluir voluntário', `Remover ${v.nome} da lista? As reservas já feitas continuam.`, { confirmar: 'Excluir' });
  if (!ok) return;
  await ctx.db.remover(COL_VOL, v.id);
  await recarregar();
  pintar();
  toast('Voluntário removido.');
}
