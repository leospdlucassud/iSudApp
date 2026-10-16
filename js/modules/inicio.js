/**
 * Tela inicial — lançador.
 *
 * Membro vê os dois calendários. O LMA vê todas as funções. Quem não entrou
 * nem chega aqui: a casca mostra a tela de entrada no lugar.
 */

import { MODULOS } from '../config.js';
import { anexar, el } from '../ui.js';

export async function montar(alvo, ctx) {
  const admin = ctx.db.ehAdmin();
  const disponiveis = admin ? MODULOS : MODULOS.filter(m => !m.admin);

  anexar(alvo,
    el('div', { class: 'hero' },
      el('h2', {}, admin ? 'Todas as ferramentas' : `Olá, ${ctx.db.nomeNaSessao()}!`),
      el('p', {}, admin
        ? 'Você está como líder de missão da ala. Os módulos restritos estão liberados.'
        : 'O que você precisa fazer?'),
    ),

    el('div', { class: 'tiles' }, ...disponiveis.map(m => azulejo(m, ctx))),
  );
}

function azulejo(m, ctx) {
  return el('button', {
    class: `tile${m.admin ? ' tile--adm' : ''}`,
    type: 'button',
    onclick: () => ctx.irPara(m.id),
  },
    el('span', { class: 'tile__icon', 'aria-hidden': 'true' }, m.icone),
    el('span', { class: 'tile__body' },
      el('span', { class: 'tile__title' },
        m.titulo,
        m.admin && el('span', { class: 'tile__selo' }, 'LMA'),
      ),
      el('span', { class: 'tile__desc' }, m.descricao),
    ),
    el('span', { class: 'tile__go', 'aria-hidden': 'true' }, '›'),
  );
}
