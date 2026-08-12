/**
 * Gráficos em SVG puro — sem biblioteca externa, funciona offline e segue o tema.
 *
 * Regras que valem para todo gráfico daqui:
 *  - traço fino: linha 2px, coluna no máximo 24px, ponta arredondada em 4px;
 *  - 2px de respiro na cor da superfície separando marcas que se tocam;
 *  - grade e eixos em fio de 1px sólido, recessivos;
 *  - texto sempre em tinta, nunca na cor da série — a identidade vem da marca
 *    colorida ao lado;
 *  - legenda sempre presente a partir de duas séries;
 *  - todo gráfico tem gêmeo em tabela, porque três slots da paleta ficam
 *    abaixo de 3:1 no tema claro.
 */

import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

const fmt = new Intl.NumberFormat('pt-BR');
export const n = (v) => fmt.format(Math.round(Number(v) || 0));
const n1 = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(v) || 0);

/** Cria um nó SVG. */
function s(tag, attrs = {}, ...filhos) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    node.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return node;
}

/**
 * Escala "bonita": teto arredondado e passo legível.
 *
 * O passo é sempre inteiro porque tudo que este app plota é contagem de
 * pessoas, lições ou batismos. Com passo fracionário, um máximo de 1 gerava
 * degraus de 0,25 e o eixo Y saía "0, 0, 1, 1, 1" depois do arredondamento —
 * com as linhas de grade em posições que não correspondiam aos números
 * impressos. Máximos 1 e 2 são justamente os mais comuns em Batismos e Novos
 * com Data.
 */
function escala(max, alvoLinhas = 4) {
  if (max <= 0) return { topo: 1, passo: 1 };
  const bruto = max / alvoLinhas;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const bruto2 = [1, 2, 5, 10].map(m => m * mag).find(p => p >= bruto) ?? 10 * mag;
  const passo = Math.max(1, Math.round(bruto2));
  return { topo: Math.ceil(max / passo) * passo, passo };
}

/* ==========================================================================
   Dica flutuante — compartilhada por todos os gráficos
   ========================================================================== */

let dica;

/**
 * @param {Node|Node[]} conteudo
 *
 * Monta nós em vez de string de HTML. Antes era innerHTML com os nomes de área
 * interpolados direto: nome de área é escrito pelo LMA, então bastava batizar
 * uma área com markup para ele executar ao passar o mouse. Construir o DOM
 * fecha o buraco na origem, em vez de depender de lembrar do escape.
 */
function mostrarDica(conteudo, ev) {
  dica ??= document.body.appendChild(el('div', { class: 'viz-dica', role: 'tooltip' }));
  dica.replaceChildren(...[conteudo].flat().filter(Boolean));
  dica.style.display = 'block';
  const r = dica.getBoundingClientRect();
  const x = Math.min(Math.max(8, ev.clientX + 14), innerWidth - r.width - 8);
  const y = Math.max(8, ev.clientY - r.height - 12);
  dica.style.transform = `translate(${x}px, ${y}px)`;
}
const esconderDica = () => { if (dica) dica.style.display = 'none'; };

const tituloDica = (texto) => el('b', { class: 'viz-dica__titulo' }, texto);

const chaveDica = (cor, rotulo, valor) =>
  el('span', { class: 'viz-dica__linha' },
    el('span', { class: 'viz-dica__chave', style: `background:${cor}` }),
    el('span', {}, rotulo),
    el('b', {}, valor),
  );

const totalDica = (rotulo, valor) =>
  el('span', { class: 'viz-dica__total' }, rotulo, el('b', {}, valor));

/* ==========================================================================
   Moldura: título, legenda, gráfico e o gêmeo em tabela
   ========================================================================== */

/**
 * @param {object} o
 * @param {string} o.titulo
 * @param {string} [o.descricao]
 * @param {Node} o.figura      o SVG
 * @param {{nome:string,cor:string}[]} [o.series]  legenda; a partir de 2 é obrigatória
 * @param {() => Node} [o.tabela]  gêmeo acessível, montado sob demanda
 * @param {Node} [o.acoes]
 */
export function moldura({ titulo, descricao, figura, series = [], tabela, acoes }) {
  const painel = el('div', { class: 'viz__painel' }, figura);

  let mostrandoTabela = false;
  const alternar = tabela && el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    onclick: () => {
      mostrandoTabela = !mostrandoTabela;
      painel.replaceChildren(mostrandoTabela ? tabela() : figura);
      alternar.textContent = mostrandoTabela ? 'Ver gráfico' : 'Ver tabela';
      alternar.setAttribute('aria-pressed', String(mostrandoTabela));
    },
  }, 'Ver tabela');

  return el('div', { class: 'card viz' },
    el('div', { class: 'card__head' },
      el('div', {},
        el('div', { class: 'card__title' }, titulo),
        descricao && el('div', { class: 'small muted' }, descricao),
      ),
      el('div', { class: 'row' }, acoes, alternar),
    ),
    series.length >= 2 && el('div', { class: 'viz__legenda' },
      ...series.map(x => el('span', { class: 'viz__item' },
        el('span', { class: 'viz__chave', style: `background:${x.cor}` }),
        x.nome,
      )),
    ),
    el('div', { class: 'card__body' }, painel),
  );
}

/** Tabela genérica a partir de cabeçalhos e linhas. */
export function tabelaSimples(cabecalhos, linhas) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, ...cabecalhos.map(h => el('th', {}, h)))),
      el('tbody', {}, ...linhas.map(l =>
        el('tr', {}, ...l.map((c, i) => el('td', { class: i ? 'num' : '' }, c))))),
    ));
}

/* ==========================================================================
   Linhas — tendência ao longo do tempo
   ========================================================================== */

/**
 * @param {object} o
 * @param {string[]} o.categorias  rótulos do eixo X
 * @param {{nome:string,cor:string,valores:number[]}[]} o.series
 * @param {number} [o.altura]
 */
export function linhas({ categorias, series, altura = 260 }) {
  const L = 46, R = 16, T = 12, B = 34;
  // 22px por ponto acomoda um ano inteiro (52 domingos) com rolagem curta.
  const W = Math.max(560, categorias.length * 22 + L + R);
  const H = altura;
  const pw = W - L - R, ph = H - T - B;

  const max = Math.max(1, ...series.flatMap(s => s.valores.map(v => Number(v) || 0)));
  const { topo, passo } = escala(max);

  const x = (i) => L + (categorias.length === 1 ? pw / 2 : (i * pw) / (categorias.length - 1));
  const y = (v) => T + ph - ((Number(v) || 0) / topo) * ph;

  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'viz__svg', role: 'img',
    'aria-label': `Linhas: ${series.map(z => z.nome).join(', ')}`,
  });

  // Grade e eixo Y
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grade)', 'stroke-width': 1 }),
      s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'viz__tick' }, n(v)),
    );
  }
  svg.append(s('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: 'var(--eixo)', 'stroke-width': 1 }));

  // Rótulos do eixo X — desbasta quando não cabe
  const salto = Math.ceil(categorias.length / Math.floor(pw / 52));
  categorias.forEach((c, i) => {
    if (i % salto) return;
    svg.append(s('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'viz__tick' }, c));
  });

  // Séries
  for (const serie of series) {
    const d = serie.valores.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
    svg.append(s('path', {
      d, fill: 'none', stroke: serie.cor, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    const ult = serie.valores.length - 1;
    if (ult >= 0) {
      svg.append(s('circle', {
        cx: x(ult), cy: y(serie.valores[ult]), r: 4,
        fill: serie.cor, stroke: 'var(--surface)', 'stroke-width': 2,
      }));
    }
  }

  svg.append(camadaDeFoco({ svg, L, T, pw, ph, x, categorias, series }));
  return envolver(svg, W);
}

/** Faixas invisíveis de foco + fio vertical, para a dica de linha. */
function camadaDeFoco({ L, T, pw, ph, x, categorias, series }) {
  const g = s('g');
  const fio = s('line', {
    y1: T, y2: T + ph, stroke: 'var(--eixo)', 'stroke-width': 1, opacity: 0, 'pointer-events': 'none',
  });
  g.append(fio);

  const larguraFaixa = pw / Math.max(1, categorias.length);
  categorias.forEach((c, i) => {
    const faixa = s('rect', {
      x: x(i) - larguraFaixa / 2, y: T, width: larguraFaixa, height: ph,
      fill: 'transparent', 'pointer-events': 'all',
    });
    const entrar = (ev) => {
      fio.setAttribute('x1', x(i)); fio.setAttribute('x2', x(i)); fio.setAttribute('opacity', '.6');
      mostrarDica(
        [tituloDica(c), ...series.map(z => chaveDica(z.cor, z.nome, n(z.valores[i])))],
        ev,
      );
    };
    faixa.addEventListener('mousemove', entrar);
    faixa.addEventListener('mouseleave', () => { fio.setAttribute('opacity', '0'); esconderDica(); });
    g.append(faixa);
  });
  return g;
}

/* ==========================================================================
   Colunas empilhadas — parte-todo por período
   ========================================================================== */

export function colunasEmpilhadas({ categorias, series, altura = 260, unidade = '' }) {
  // T maior que nos outros gráficos: o total fica acima da coluna mais alta
  // e precisa caber dentro do quadro.
  const L = 46, R = 16, T = 24, B = 34;
  const W = Math.max(560, categorias.length * 62 + L + R);
  const H = altura;
  const pw = W - L - R, ph = H - T - B;

  const totais = categorias.map((_, i) => series.reduce((t, z) => t + (Number(z.valores[i]) || 0), 0));
  const { topo, passo } = escala(Math.max(1, ...totais));

  const banda = pw / categorias.length;
  const largura = Math.min(24, banda * 0.55);
  const y = (v) => T + ph - (v / topo) * ph;

  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'viz__svg', role: 'img',
    'aria-label': `Colunas empilhadas: ${series.map(z => z.nome).join(', ')}`,
  });

  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grade)', 'stroke-width': 1 }),
      s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'viz__tick' }, n(v)),
    );
  }

  categorias.forEach((c, i) => {
    const cx = L + banda * i + banda / 2;
    let base = 0;

    // De baixo para cima; só o topo recebe canto arredondado.
    const segmentos = series
      .map(z => ({ cor: z.cor, nome: z.nome, valor: Number(z.valores[i]) || 0 }))
      .filter(seg => seg.valor > 0);

    segmentos.forEach((seg, k) => {
      const topoSeg = base + seg.valor;
      const yTopo = y(topoSeg);
      const alturaSeg = y(base) - yTopo;
      const ultimo = k === segmentos.length - 1;
      // 2px de respiro na cor da superfície entre segmentos que se tocam.
      const h = Math.max(1, alturaSeg - (k ? 2 : 0));

      svg.append(s('rect', {
        x: cx - largura / 2, y: yTopo, width: largura, height: h,
        rx: ultimo ? 4 : 0, fill: seg.cor,
      }));
      // Rebate o arredondamento na base do segmento do topo.
      if (ultimo && h > 6) {
        svg.append(s('rect', { x: cx - largura / 2, y: yTopo + 4, width: largura, height: h - 4, fill: seg.cor }));
      }
      base = topoSeg;
    });

    if (totais[i] > 0) {
      svg.append(s('text', { x: cx, y: y(totais[i]) - 7, 'text-anchor': 'middle', class: 'viz__valor' }, n(totais[i])));
    }
    svg.append(s('text', { x: cx, y: H - 12, 'text-anchor': 'middle', class: 'viz__tick' }, c));

    const alvo = s('rect', { x: L + banda * i, y: T, width: banda, height: ph, fill: 'transparent' });
    alvo.addEventListener('mousemove', (ev) => mostrarDica([
      tituloDica(c),
      ...series.map(z => chaveDica(z.cor, z.nome, n(z.valores[i]))),
      totalDica('Total', `${n(totais[i])}${unidade}`),
    ], ev));
    alvo.addEventListener('mouseleave', esconderDica);
    svg.append(alvo);
  });

  svg.append(s('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: 'var(--eixo)', 'stroke-width': 1 }));
  return envolver(svg, W);
}

/* ==========================================================================
   Funil — etapas ordenadas, rampa de um matiz
   ========================================================================== */

/** @param {{rotulo:string, valor:number}[]} etapas */
export function funil(etapas) {
  const larguraRotulo = 148;
  const W = 620, alturaLinha = 46;
  const H = etapas.length * alturaLinha + 12;
  const pw = W - larguraRotulo - 92;
  const max = Math.max(1, ...etapas.map(e => e.valor));

  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'viz__svg', role: 'img',
    'aria-label': 'Funil de conversão',
  });

  etapas.forEach((e, i) => {
    const cor = `var(--funil-${Math.min(i + 1, 5)})`;
    const yc = i * alturaLinha + 8;
    const largura = Math.max(2, (e.valor / max) * pw);

    svg.append(
      s('text', { x: larguraRotulo - 10, y: yc + 18, 'text-anchor': 'end', class: 'viz__rotulo' }, e.rotulo),
      s('rect', { x: larguraRotulo, y: yc + 4, width: largura, height: 20, rx: 4, fill: cor }),
      // Valor sempre visível — é o canal de alívio exigido pelo contraste.
      s('text', { x: larguraRotulo + largura + 8, y: yc + 19, class: 'viz__valor' }, n(e.valor)),
    );

    // Taxa de conversão em relação à etapa anterior.
    if (i > 0) {
      const antes = etapas[i - 1].valor;
      const taxa = antes > 0 ? (e.valor / antes) * 100 : 0;
      svg.append(s('text', {
        x: larguraRotulo, y: yc - 1, class: 'viz__tick',
      }, `↳ ${n1(taxa)}% de ${etapas[i - 1].rotulo.toLowerCase()}`));
    }
  });

  return envolver(svg, W);
}

/* ==========================================================================
   Mapa de calor — magnitude numa grade
   ========================================================================== */

export function mapaCalor({ colunas, linhas: nomesLinha, valores, rotuloValor = 'valor' }) {
  const larguraRotulo = 108, cel = 30, gap = 2;
  const W = Math.max(560, larguraRotulo + colunas.length * cel + 16);
  const H = nomesLinha.length * cel + 34;
  const max = Math.max(1, ...valores.flat().map(v => Number(v) || 0));

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz__svg', role: 'img', 'aria-label': `Mapa de calor de ${rotuloValor}` });

  const salto = Math.ceil(colunas.length / Math.floor((W - larguraRotulo) / 46));
  colunas.forEach((c, j) => {
    if (j % salto) return;
    svg.append(s('text', { x: larguraRotulo + j * cel + cel / 2, y: 14, 'text-anchor': 'middle', class: 'viz__tick' }, c));
  });

  nomesLinha.forEach((nome, i) => {
    svg.append(s('text', { x: larguraRotulo - 10, y: 24 + i * cel + cel / 2 + 4, 'text-anchor': 'end', class: 'viz__rotulo' }, nome));

    colunas.forEach((c, j) => {
      const v = Number(valores[i]?.[j]) || 0;
      const nivel = v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999));
      const rect = s('rect', {
        x: larguraRotulo + j * cel, y: 24 + i * cel,
        width: cel - gap, height: cel - gap, rx: 3,
        fill: `var(--seq-${nivel})`,
      });
      rect.addEventListener('mousemove', (ev) => mostrarDica([
        tituloDica(`${nome} · ${c}`),
        totalDica(rotuloValor, n(v)),
      ], ev));
      rect.addEventListener('mouseleave', esconderDica);
      svg.append(rect);
    });
  });

  return el('div', {},
    envolver(svg, W),
    escalaSequencial(max),
  );
}

/** Legenda de escala: cor sozinha não pode carregar uma grandeza contínua. */
function escalaSequencial(max) {
  return el('div', { class: 'viz__escala' },
    el('span', { class: 'small muted' }, '0'),
    ...Array.from({ length: 7 }, (_, i) =>
      el('span', { class: 'viz__degrau', style: `background:var(--seq-${i})` })),
    el('span', { class: 'small muted' }, n(max)),
  );
}

/* ==========================================================================
   Sparkline — 12 pontos dentro de um cartão de indicador
   ========================================================================== */

export function sparkline(valores, cor = 'var(--area-0)') {
  const W = 96, H = 26, pad = 3;
  const vs = valores.map(v => Number(v) || 0);
  const max = Math.max(1, ...vs), min = Math.min(0, ...vs);
  const x = (i) => pad + (vs.length < 2 ? 0 : (i * (W - pad * 2)) / (vs.length - 1));
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz__spark', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(s('path', {
    d: vs.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' '),
    fill: 'none', stroke: cor, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  if (vs.length) {
    svg.append(s('circle', {
      cx: x(vs.length - 1), cy: y(vs.at(-1)), r: 3,
      fill: cor, stroke: 'var(--surface)', 'stroke-width': 2,
    }));
  }
  return svg;
}

/* ==========================================================================
   Cartão de indicador
   ========================================================================== */

/**
 * @param {object} o
 * @param {string} o.rotulo
 * @param {number} o.valor
 * @param {number|null} [o.variacao]  variação percentual contra o período anterior
 * @param {number[]} [o.serie]
 * @param {string} [o.cor]
 * @param {string} [o.nota]
 */
export function cartaoIndicador({ rotulo, valor, variacao = null, serie = [], cor = 'var(--area-0)', nota }) {
  const seta = variacao == null ? '' : variacao > 0 ? '↑' : variacao < 0 ? '↓' : '→';
  const tom = variacao == null || variacao === 0 ? 'mute' : variacao > 0 ? 'ok' : 'err';

  return el('div', { class: 'kpi' },
    el('div', { class: 'kpi__rotulo' }, rotulo),
    el('div', { class: 'kpi__valor' }, n(valor)),
    el('div', { class: 'kpi__pe' },
      variacao == null
        ? el('span', { class: 'small muted' }, nota || 'sem base anterior')
        : el('span', { class: `badge badge--${tom}` }, `${seta} ${n1(Math.abs(variacao))}%`),
      serie.length > 1 && sparkline(serie, cor),
    ),
  );
}

/* ==========================================================================
   Auxiliar
   ========================================================================== */

/** Rola na horizontal em telas estreitas em vez de encolher o texto. */
function envolver(svg, larguraMinima) {
  return el('div', { class: 'viz__rolagem' },
    el('div', { style: `min-width:${larguraMinima}px` }, svg));
}
