/** Tela provisória dos módulos ainda não construídos. */

import { el } from '../ui.js';

/**
 * @param {object} o
 * @param {string} o.icone
 * @param {string} o.titulo
 * @param {string} o.resumo
 * @param {string[]} o.itens  o que este módulo vai conter
 * @param {string} o.fase
 */
export function emConstrucao({ icone, titulo, resumo, itens, fase }) {
  return el('div', {},
    el('div', { class: 'page-head' },
      el('h2', {}, `${icone} ${titulo}`),
      el('p', {}, resumo),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'O que entra aqui'),
        el('span', { class: 'badge badge--info' }, fase),
      ),
      el('div', { class: 'card__body' },
        el('ul', { style: 'padding-left:1.125rem;display:grid;gap:.5rem' },
          ...itens.map(t => el('li', { class: 'small' }, t)),
        ),
      ),
    ),
  );
}
