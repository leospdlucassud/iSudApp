/**
 * Tela inicial — lançador.
 *
 * Membro vê os dois calendários abertos e o botão de entrar como LMA.
 * Depois do login, a mesma tela passa a listar todas as funções.
 */

import { MODULOS } from '../config.js';
import { anexar, el } from '../ui.js';

export async function montar(alvo, ctx) {
  const admin = ctx.db.ehAdmin();
  const disponiveis = admin ? MODULOS : MODULOS.filter(m => !m.admin);

  // `anexar`, e não `alvo.append`: o rodapé de login é condicional, e
  // `Node.append(false)` imprimia um "false" solto abaixo dos azulejos
  // sempre que o LMA estava logado.
  anexar(alvo,
    el('div', { class: 'hero' },
      el('h2', {}, admin ? 'Todas as ferramentas' : 'O que você precisa fazer?'),
      el('p', {}, admin
        ? 'Você está como líder de missão da ala. Os módulos restritos estão liberados.'
        : 'Escolha uma das opções abaixo.'),
    ),

    el('div', { class: 'tiles' }, ...disponiveis.map(m => azulejo(m, ctx))),

    !admin && el('div', { class: 'login-cta' },
      el('p', { class: 'login-cta__msg' },
        'Relatório de progresso, caminho do convênio e coordenação são do líder de missão da ala.'),
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => ctx.entrarComoAdmin(),
      }, '🔑 Logar como ADM'),
    ),
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
