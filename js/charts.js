/**
 * Gráficos em SVG puro — sem biblioteca externa, funciona offline e segue o tema.
 *
 * Regras que valem para todo gráfico daqui:
 *  - traço fino: linha 2px, coluna no máximo 24px, ponta arredondada em 4px;
 *  - 2px de respiro na cor da superfície separando marcas que se tocam;
 *  - grade e eixos em fio de 1px sólido, recessivos;
 *  - texto sempre em tinta, nunca na cor da série — a identidade vem da marca
 *    colorida ao lado;
 *  - legenda sempre presente a partir de duas séries — e clicável: passar
 *    o dedo ou o mouse num item destaca aquela série e apaga as outras;
 *  - a paleta tem oito cores validadas e nunca se gera uma nona. Série que
 *    precisa repetir cor repete com traço tracejado, e a legenda mostra o
 *    tracejado também;
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

/**
 * Linha da dica. A chave é um traço curto, não um quadrado: o que ela
 * identifica é uma linha, e um bloco cheio pesa mais que o rótulo ao lado.
 */
const chaveDica = (serie, valor) =>
  el('span', { class: 'viz-dica__linha' },
    el('span', {
      class: `viz-dica__chave${serie.tracejado ? ' viz-dica__chave--tracejada' : ''}`,
      style: `--cor:${serie.cor}`,
    }),
    el('span', {}, serie.nome),
    el('b', {}, valor),
  );

/* ==========================================================================
   Moldura: título, legenda, gráfico e o gêmeo em tabela
   ========================================================================== */

/**
 * @param {object} o
 * @param {string} o.titulo
 * @param {string} [o.descricao]
 * @param {Node} o.figura      o SVG
 * @param {{nome:string,cor:string,tracejado?:boolean}[]} [o.series]  legenda; a partir de 2 é obrigatória
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
    series.length >= 2 && legenda(series, figura),
    el('div', { class: 'card__body' }, painel),
  );
}

/**
 * Legenda que também é controle de destaque.
 *
 * Passar o mouse (ou o foco do teclado) num item acende aquela série e apaga
 * as outras; tocar fixa o destaque, e tocar de novo solta. É a forma de ler
 * um gráfico com muitas linhas sem esconder nenhuma — nada some, o resto só
 * recua. Os valores de todas continuam na dica e na tabela.
 *
 * Só vira botão quando a figura tem marcas com `data-serie`; num gráfico sem
 * isso (ou no aviso de vazio) a legenda segue estática.
 */
function legenda(series, figura) {
  const chave = (x) => el('span', {
    class: `viz__chave${x.tracejado ? ' viz__chave--tracejada' : ''}`,
    style: `--cor:${x.cor}`,
  });

  const interativa = !!figura?.querySelector?.('[data-serie]');
  if (!interativa) {
    return el('div', { class: 'viz__legenda' },
      ...series.map(x => el('span', { class: 'viz__item' }, chave(x), x.nome)));
  }

  let fixado = null;
  const botoes = [];
  const destacar = (i) => {
    for (const m of figura.querySelectorAll('[data-serie]')) {
      m.classList.toggle('viz__serie--apagada', i != null && m.dataset.serie !== String(i));
    }
  };
  const soltarPara = () => destacar(fixado);

  series.forEach((x, i) => {
    botoes.push(el('button', {
      class: 'viz__item viz__item--botao', type: 'button', 'aria-pressed': 'false',
      title: `Destacar ${x.nome}`,
      onmouseenter: () => destacar(i),
      onmouseleave: soltarPara,
      onfocus: () => destacar(i),
      onblur: soltarPara,
      onclick: () => {
        fixado = fixado === i ? null : i;
        botoes.forEach((b, k) => b.setAttribute('aria-pressed', String(k === fixado)));
        destacar(fixado);
      },
    }, chave(x), x.nome));
  });

  return el('div', { class: 'viz__legenda', role: 'group', 'aria-label': 'Destacar série' }, ...botoes);
}

/**
 * Tabela genérica a partir de cabeçalhos e linhas.
 * @param {{rotulosLongos?: boolean}} [o] cabeçalhos que precisam quebrar linha
 */
export function tabelaSimples(cabecalhos, linhas, { rotulosLongos = false } = {}) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: rotulosLongos ? 'table table--rotulos' : 'table' },
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
 * @param {{nome:string,cor:string,valores:number[],tracejado?:boolean}[]} o.series
 * @param {number} [o.altura]
 * @param {boolean} [o.marcadores]  ponto em todo valor, não só no último.
 *   Para séries curtas e esparsas — doze meses de batismos —, em que a linha
 *   sozinha não deixa ver onde está cada mês.
 */
export function linhas({ categorias, series, altura = 260, marcadores = false }) {
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

  // Rótulos do eixo X — desbasta quando não cabe.
  //
  // A largura sai do maior rótulo, não de um valor fixo. Era 52px por rótulo,
  // medida para "dd/mm"; com meses ("Jan") a conta cortava um mês sim, outro
  // não, e o último mês do ano corrente sumia do eixo.
  const larguraRotulo = Math.max(...categorias.map(c => String(c).length)) * 6.5 + 14;
  const salto = Math.max(1, Math.ceil(categorias.length / Math.max(1, Math.floor(pw / larguraRotulo))));
  categorias.forEach((c, i) => {
    if (i % salto) return;
    svg.append(s('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'viz__tick' }, c));
  });

  // Séries. Cada marca leva `data-serie` para a legenda poder destacá-la.
  series.forEach((serie, k) => {
    const g = s('g', { class: 'viz__serie', 'data-serie': k });
    const d = serie.valores.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
    g.append(s('path', {
      d, fill: 'none', stroke: serie.cor, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': serie.tracejado ? 'butt' : 'round',
      'stroke-dasharray': serie.tracejado ? '6 4' : null,
    }));
    const pontos = marcadores ? serie.valores.map((_, i) => i) : [serie.valores.length - 1];
    for (const i of pontos) {
      if (i < 0) continue;
      g.append(s('circle', {
        cx: x(i), cy: y(serie.valores[i]), r: 4,
        fill: serie.cor, stroke: 'var(--surface)', 'stroke-width': 2,
      }));
    }
    svg.append(g);
  });

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
      mostrarDica([tituloDica(c), ...series.map(z => chaveDica(z, n(z.valores[i])))], ev);
    };
    faixa.addEventListener('mousemove', entrar);
    faixa.addEventListener('mouseleave', () => { fio.setAttribute('opacity', '0'); esconderDica(); });
    g.append(faixa);
  });
  return g;
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
   Sparkline — 12 pontos dentro de um cartão de indicador
   ========================================================================== */

/** @param {boolean} [tracejado] mesmo traço da linha do indicador no gráfico de todos */
export function sparkline(valores, cor = 'var(--area-0)', tracejado = false) {
  const W = 96, H = 26, pad = 3;
  const vs = valores.map(v => Number(v) || 0);
  const max = Math.max(1, ...vs), min = Math.min(0, ...vs);
  const x = (i) => pad + (vs.length < 2 ? 0 : (i * (W - pad * 2)) / (vs.length - 1));
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz__spark', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(s('path', {
    d: vs.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' '),
    fill: 'none', stroke: cor, 'stroke-width': 2, 'stroke-linejoin': 'round',
    'stroke-linecap': tracejado ? 'butt' : 'round', 'stroke-dasharray': tracejado ? '4 3' : null,
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
export function cartaoIndicador({ rotulo, valor, variacao = null, serie = [], cor = 'var(--area-0)', tracejado = false, nota }) {
  const seta = variacao == null ? '' : variacao > 0 ? '↑' : variacao < 0 ? '↓' : '→';
  const tom = variacao == null || variacao === 0 ? 'mute' : variacao > 0 ? 'ok' : 'err';

  return el('div', { class: 'kpi' },
    el('div', { class: 'kpi__rotulo' }, rotulo),
    el('div', { class: 'kpi__valor' }, n(valor)),
    el('div', { class: 'kpi__pe' },
      variacao == null
        // `??`, não `||`: quem passa nota '' quer o rodapé em branco (faixas de
        // batismo, Caminho, Coordenação), não um "sem base anterior" que
        // sugere uma comparação que nunca existiu.
        ? el('span', { class: 'small muted' }, nota ?? 'sem base anterior')
        : el('span', { class: `badge badge--${tom}` }, `${seta} ${n1(Math.abs(variacao))}%`),
      serie.length > 1 && sparkline(serie, cor, tracejado),
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
