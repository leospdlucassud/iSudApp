/**
 * Imprimir e salvar em PDF.
 *
 * Usa a impressão do próprio navegador, e o PDF sai dali: todo navegador atual
 * oferece "Salvar como PDF" como destino — Chrome, Edge, Brave e Firefox no
 * computador; "Salvar como PDF" na tela de impressão do Android; Compartilhar
 * → Imprimir no iPhone. Gerar o PDF em JavaScript exigiria uma biblioteca de
 * centenas de KB e desenharia a tela como imagem; pela impressão do navegador
 * o texto sai selecionável e os gráficos saem em vetor.
 *
 * O que vai para o papel é a própria tela, limpa pelo @media print do
 * app.css: sem botões nem barras de navegação, e sempre nas cores claras.
 * Cada módulo que vale imprimir exporta impressao(), dizendo o que está na
 * tela agora (aba, mês, área); o app.js registra aqui a da tela aberta e põe
 * o botão.
 */

import { ALA } from './config.js';
import { emDemonstracao } from './db.js';
import { el } from './ui.js';

/** @type {null | (() => {titulo: string, detalhe?: string, paisagem?: boolean})} */
let descrever = null;
let desfazerAoTerminar = null;

/** Registra (ou limpa, com null) a descrição da tela aberta. */
export function definirImpressao(fn) {
  descrever = fn;
  atualizarTopo();
}

export function botaoImprimir() {
  return el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    title: 'Abre a impressão do navegador. Para PDF, escolha "Salvar como PDF" como destino.',
    onclick: () => window.print(),
  }, '🖨 Imprimir / PDF');
}

const FMT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Faixa que só existe no papel: o que é, de quando, e quando foi impresso.
 *
 * Fica no documento o tempo todo (escondida na tela pelo CSS) em vez de nascer
 * no `beforeprint`: há caminhos de impressão que não disparam o evento, e o
 * papel sairia sem dizer o que é.
 */
function topo() {
  let t = document.getElementById('impressao-topo');
  if (!t) {
    t = el('div', { id: 'impressao-topo', class: 'impressao-topo', 'aria-hidden': 'true' });
    document.querySelector('main')?.before(t);
  }
  return t;
}

function atualizarTopo() {
  const d = descrever?.() ?? null;
  topo().replaceChildren(
    // Papel não tem faixa dourada nem botão de sair: sem este aviso, uma folha
    // da demonstração podia circular como se fossem os números da ala.
    emDemonstracao() && el('p', { class: 'impressao-topo__demo' },
      'DEMONSTRAÇÃO — dados fictícios, não pertencem à ala'),
    el('p', { class: 'impressao-topo__titulo' }, d?.titulo ?? ALA.titulo),
    d?.detalhe && el('p', { class: 'impressao-topo__detalhe' }, d.detalhe),
    el('p', { class: 'impressao-topo__rodape' }, `${ALA.titulo} · impresso em ${FMT.format(new Date())}`),
  );
  return d;
}

/**
 * Logo antes de imprimir. A descrição é lida AGORA, não quando a tela abriu:
 * entre uma coisa e outra a pessoa trocou de aba, de mês, de área.
 */
function preparar() {
  const d = atualizarTopo();
  const tituloAntes = document.title;
  const copias = [];

  // O título da página vira o nome sugerido do arquivo ao salvar em PDF.
  if (d?.titulo) document.title = `${d.titulo} — ${ALA.nome}`;

  // Tabela larga (consolidado, grade de marcos) cabe melhor deitada. `@page`
  // não aceita seletor, então a orientação entra como estilo só durante a
  // impressão.
  const pagina = d?.paisagem
    ? document.head.appendChild(el('style', { id: 'impressao-pagina' }, '@page { size: A4 landscape; }'))
    : null;

  // Campo de texto imprime com a altura da tela: corta o texto longo e sobra
  // branco no curto, e o plano da ala tem parágrafos inteiros dentro deles.
  // Medir e fixar a altura não resolve — o papel usa fonte menor que a tela, e
  // o .textarea tem altura mínima. Então cada campo ganha, só durante a
  // impressão, uma cópia em texto corrido, e o CSS de impressão mostra a
  // cópia no lugar do campo.
  for (const t of document.querySelectorAll('#conteudo textarea')) {
    const copia = el('div', { class: 'texto-impresso' }, t.value);
    t.after(copia);
    copias.push(copia);
  }

  desfazerAoTerminar = () => {
    document.title = tituloAntes;
    pagina?.remove();
    for (const c of copias) c.remove();
  };
}

function desfazer() {
  desfazerAoTerminar?.();
  desfazerAoTerminar = null;
}

addEventListener('beforeprint', preparar);
addEventListener('afterprint', desfazer);
