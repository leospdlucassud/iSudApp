/**
 * Configurações — só o LMA.
 *
 * Áreas, duplas de missionários do mês, quem tem acesso de líder e os dados.
 *
 * Sobre o acesso: a tabela `lideres` é somente leitura pelo app, de propósito.
 * Dar ao app o poder de conceder acesso significaria que uma sessão de líder
 * comprometida poderia se perpetuar. Trocar de LMA acontece uma vez por ano;
 * duas linhas de SQL uma vez por ano é preço barato por essa garantia.
 */

import { AREAS_PADRAO, MESES, corDaArea } from '../config.js';
import { comparaNome, dataCurta, hoje } from '../util.js';
import { confirmar, el, modal, toast, vazio } from '../ui.js';

/** Coleções incluídas no backup, na ordem em que devem ser restauradas. */
const COLECOES = [
  'areas', 'duplas_missionarios',
  'voluntarios_almoco', 'almoco_agenda',
  'disponibilidade_licoes', 'licoes_agenda',
  'relatorio_semanal', 'frequencia_ala', 'batismos', 'progredindo',
  'caminho_pessoas', 'caminho_marcos', 'caminho_frequencia',
  'coordenacao_reunioes', 'coordenacao_presencas', 'coordenacao_designacoes',
  'plano_ala',
];

let ctx, raiz;
let aba = 'areas';
let ano = new Date().getFullYear();
let mes = new Date().getMonth();
let areas = [], duplas = [], lideres = [];

export async function montar(alvo, contexto) {
  ctx = contexto;
  raiz = alvo;

  if (!ctx.db.ehAdmin()) {
    alvo.append(vazio('Acesso restrito', 'As configurações são do líder de missão da ala.', '🔒'));
    return;
  }

  await recarregar();
  pintar();
}

async function recarregar() {
  const [as, ds, ls] = await Promise.all([
    ctx.db.listar('areas'),
    ctx.db.listar('duplas_missionarios'),
    ctx.db.listar('lideres').catch(() => []),
  ]);
  // Aqui, ao contrário dos outros módulos, mostramos o que está GRAVADO.
  // Exibir AREAS_PADRAO como se existisse faria as áreas "sumirem" no
  // instante em que a primeira área real fosse criada.
  areas = [...as].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  duplas = ds;
  lideres = ls;
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

const ABAS = [
  { id: 'areas',  rotulo: '🗺️ Áreas' },
  { id: 'duplas', rotulo: '👔 Duplas' },
  { id: 'acesso', rotulo: '🔑 Acesso' },
  { id: 'dados',  rotulo: '💾 Dados' },
];

function pintar() {
  const paineis = { areas: painelAreas, duplas: painelDuplas, acesso: painelAcesso, dados: painelDados };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '⚙️ Configurações'),
      el('p', {}, 'Áreas da ala, duplas do mês, acesso e cópia de segurança.'),
    ),
    el('div', { class: 'chips', style: 'margin-bottom:1rem' },
      ...ABAS.map(a => el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(aba === a.id),
        onclick: () => { aba = a.id; pintar(); },
      }, a.rotulo)),
    ),
    paineis[aba](),
  );
}

/* ---------------------------------------------------------------------------
   Áreas
--------------------------------------------------------------------------- */

function painelAreas() {
  if (!areas.length) {
    return el('div', {},
      vazio('Nenhuma área gravada',
        'O app está exibindo as áreas de partida, mas elas ainda não existem no banco.', '🗺️'),
      el('div', { class: 'center' },
        el('button', { class: 'btn btn--primary', type: 'button', onclick: criarAreasPadrao },
          `Criar as ${AREAS_PADRAO.length} áreas padrão`),
        el('p', { class: 'small muted', style: 'margin-top:.5rem' },
          AREAS_PADRAO.map(a => a.nome).join(' · ')),
      ),
    );
  }

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, `${areas.filter(a => a.ativa !== false).length} área(s) ativa(s)`),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => formArea(null) }, '+ Área'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Ordem'), el('th', {}, 'Nome'), el('th', {}, 'Identificador'),
            el('th', {}, 'Cor'), el('th', {}, 'Ativa'), el('th', {}, ''),
          )),
          el('tbody', {}, ...areas.map(a => el('tr', { style: a.ativa === false ? 'opacity:.5' : '' },
            el('td', { class: 'num' }, a.ordem ?? 0),
            el('td', {}, el('strong', {}, a.nome)),
            el('td', { class: 'small muted' }, el('code', {}, a.id)),
            el('td', {}, el('span', { class: 'dot', style: `background:${corDaArea(a.cor ?? 0)};width:1rem;height:1rem` })),
            el('td', {}, a.ativa === false
              ? el('span', { class: 'badge badge--mute' }, 'inativa')
              : el('span', { class: 'badge badge--ok' }, 'ativa')),
            el('td', {}, el('div', { class: 'row' },
              el('button', { class: 'btn btn--icon btn--ghost', type: 'button', 'aria-label': `Editar ${a.nome}`, onclick: () => formArea(a) }, '✏️'),
            )),
          ))),
        )),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('p', { class: 'small muted' },
        'Desativar uma área a tira do calendário, do lançamento e do consolidado, ' +
        'mas preserva o histórico já lançado. Por isso não existe excluir: apagar uma ' +
        'área levaria junto tudo o que foi registrado nela.'),
    )),
  );
}

async function criarAreasPadrao() {
  let criadas = 0;
  for (const a of AREAS_PADRAO) {
    try { await ctx.db.inserir('areas', { ...a }); criadas++; } catch { /* já existe */ }
  }
  await recarregar();
  pintar();
  toast(`${criadas} área(s) criada(s).`, 'ok');
}

function formArea(a) {
  const novo = !a;
  const nome = el('input', { class: 'input', value: a?.nome ?? '' });
  const id = el('input', { class: 'input', value: a?.id ?? '', disabled: !novo,
    placeholder: 'ex.: austin — sem espaço nem acento' });
  const cor = el('select', { class: 'select' },
    ...Array.from({ length: 8 }, (_, i) =>
      el('option', { value: i, selected: (a?.cor ?? 0) === i }, `Cor ${i + 1}`)));
  const ordem = el('input', { class: 'input', type: 'number', min: '0', value: a?.ordem ?? areas.length + 1 });
  const ativa = el('input', { type: 'checkbox', checked: a?.ativa !== false });

  const amostra = el('span', { class: 'dot', style: `background:${corDaArea(a?.cor ?? 0)};width:1.5rem;height:1.5rem` });
  cor.addEventListener('change', () => { amostra.style.background = corDaArea(Number(cor.value)); });

  return modal({
    titulo: novo ? 'Nova área' : `Editar ${a.nome}`,
    corpo: el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'Nome'), nome),
      el('div', { class: 'field' }, el('label', {}, 'Identificador'), id,
        el('p', { class: 'field__hint' }, novo
          ? 'Usado internamente e no histórico. Não dá para mudar depois.'
          : 'Não pode mudar: o histórico já lançado aponta para ele.')),
      el('div', { class: 'field' }, el('label', {}, 'Cor'), el('div', { class: 'row' }, cor, amostra),
        el('p', { class: 'field__hint' }, 'A cor segue a área em todos os gráficos.')),
      el('div', { class: 'field' }, el('label', {}, 'Ordem'), ordem),
      el('div', { class: 'field' }, el('label', { class: 'row' }, ativa, 'Área ativa')),
    ),
    aoConfirmar: async () => {
      const dados = {
        nome: nome.value.trim(),
        cor: Number(cor.value),
        ordem: Number(ordem.value) || 0,
        ativa: ativa.checked,
      };
      if (dados.nome.length < 2) throw new Error('Informe o nome.');

      if (novo) {
        const chave = id.value.trim();
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(chave)) {
          throw new Error('O identificador deve começar com letra e ter só letras e números.');
        }
        if (areas.some(x => x.id === chave)) throw new Error('Já existe uma área com esse identificador.');
        await ctx.db.inserir('areas', { id: chave, ...dados });
      } else {
        await ctx.db.atualizar('areas', a.id, dados);
      }
      await recarregar();
      pintar();
      toast(novo ? 'Área criada.' : 'Área atualizada.', 'ok');
    },
  });
}

/* ---------------------------------------------------------------------------
   Duplas do mês
--------------------------------------------------------------------------- */

function painelDuplas() {
  const ativas = areas.filter(a => a.ativa !== false);
  const daDupla = (areaId) => duplas.find(d => d.area_id === areaId && d.ano === ano && d.mes === mes + 1);

  const mudarMes = (passo) => {
    const d = new Date(ano, mes + passo, 1);
    ano = d.getFullYear(); mes = d.getMonth();
    pintar();
  };

  const salvar = async (areaId, campo, valor) => {
    const atual = daDupla(areaId);
    try {
      if (atual) await ctx.db.atualizar('duplas_missionarios', atual.id, { [campo]: valor || null });
      else await ctx.db.inserir('duplas_missionarios', { area_id: areaId, ano, mes: mes + 1, [campo]: valor || null });
      await recarregar();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'err'); }
  };

  const campo = (areaId, nome, valor) => {
    const inp = el('input', { class: 'input', value: valor ?? '', placeholder: 'ex.: E. Weaver' });
    inp.addEventListener('change', () => salvar(areaId, nome, inp.value.trim()));
    return inp;
  };

  return el('div', {},
    el('div', { class: 'row row--wrap', style: 'margin-bottom:1rem' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      el('strong', { style: 'min-width:9rem;text-align:center' }, `${MESES[mes]} ${ano}`),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Próximo mês', onclick: () => mudarMes(+1) }, '›'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: copiarMesAnterior }, 'Copiar do mês anterior'),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'Missionários por área'),
        el('span', { class: 'small muted' }, 'salva ao sair do campo'),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Área'), el('th', { style: 'min-width:11rem' }, 'Missionário 1'),
            el('th', { style: 'min-width:11rem' }, 'Missionário 2'),
          )),
          el('tbody', {}, ...ativas.map(a => {
            const d = daDupla(a.id);
            return el('tr', {},
              el('td', { class: 'nowrap' },
                el('span', { class: 'dot', style: `background:${corDaArea(a.cor ?? 0)};margin-right:.375rem` }), a.nome),
              el('td', {}, campo(a.id, 'missionario_1', d?.missionario_1)),
              el('td', {}, campo(a.id, 'missionario_2', d?.missionario_2)),
            );
          })),
        )),
    ),
  );
}

async function copiarMesAnterior() {
  const ant = new Date(ano, mes - 1, 1);
  const anoAnt = ant.getFullYear(), mesAnt = ant.getMonth() + 1;
  const origem = duplas.filter(d => d.ano === anoAnt && d.mes === mesAnt);

  if (!origem.length) return toast('O mês anterior não tem duplas cadastradas.', 'warn');
  if (!await confirmar('Copiar duplas',
    `Trazer as ${origem.length} dupla(s) de ${MESES[mesAnt - 1]} para ${MESES[mes]}? O que já estiver preenchido será substituído.`,
    { confirmar: 'Copiar', tom: 'primary' })) return;

  for (const o of origem) {
    const atual = duplas.find(d => d.area_id === o.area_id && d.ano === ano && d.mes === mes + 1);
    const dados = { missionario_1: o.missionario_1, missionario_2: o.missionario_2 };
    if (atual) await ctx.db.atualizar('duplas_missionarios', atual.id, dados);
    else await ctx.db.inserir('duplas_missionarios', { area_id: o.area_id, ano, mes: mes + 1, ...dados });
  }
  await recarregar();
  pintar();
  toast('Duplas copiadas.', 'ok');
}

/* ---------------------------------------------------------------------------
   Acesso
--------------------------------------------------------------------------- */

function painelAcesso() {
  const sql = (email) =>
    `insert into public.lideres (email, nome)\nvalues ('${email || 'novo@email.com'}', 'Nome')\non conflict (email) do nothing;`;

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, `${lideres.length} pessoa(s) com acesso de LMA`)),
      lideres.length
        ? el('div', { class: 'table-wrap' },
            el('table', { class: 'table' },
              el('thead', {}, el('tr', {}, el('th', {}, 'E-mail'), el('th', {}, 'Nome'), el('th', {}, 'Desde'))),
              el('tbody', {}, ...[...lideres].sort((a, b) => comparaNome(a.email, b.email)).map(l =>
                el('tr', {},
                  el('td', {}, el('strong', {}, l.email)),
                  el('td', {}, l.nome ?? '—'),
                  el('td', { class: 'small muted' }, l.criado_em ? dataCurta(l.criado_em.slice(0, 10)) : '—'),
                ))),
            ))
        : vazio('Lista vazia ou sem leitura',
            'Se você entrou com link mágico e não vê ninguém aqui, a conexão pode estar em modo local.', '🔑'),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Conceder acesso a alguém')),
      el('div', { class: 'card__body' },
        el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
          'Isto é feito no SQL Editor do Supabase, não pelo app — de propósito. Se o app pudesse ' +
          'conceder acesso, uma sessão de líder comprometida poderia se perpetuar sozinha. ' +
          'Trocar de LMA acontece uma vez por ano; duas linhas de SQL uma vez por ano custam pouco ' +
          'por essa garantia.'),
        el('pre', { class: 'codigo' }, sql()),
        el('p', { class: 'small muted', style: 'margin-top:.75rem' },
          'Para tirar o acesso de alguém: ',
          el('code', {}, "delete from public.lideres where email = 'pessoa@email.com';")),
      ),
    ),
  );
}

/* ---------------------------------------------------------------------------
   Dados
--------------------------------------------------------------------------- */

function painelDados() {
  const resultado = el('div');

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Cópia de segurança')),
      el('div', { class: 'card__body' },
        el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
          'Baixa tudo num arquivo JSON. Vale fazer de vez em quando: projetos Supabase no plano ' +
          'gratuito são pausados após um período sem uso, e o backup é o que garante que os dados ' +
          'da ala não dependem disso.'),
        el('div', { class: 'row row--wrap' },
          el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => exportarTudo(resultado) }, '⬇ Baixar backup'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => restaurar(resultado) }, '⬆ Restaurar de um backup'),
        ),
        resultado,
      ),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Importar voluntários de almoço')),
      el('div', { class: 'card__body' },
        el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
          'Salve a aba "Lista" da planilha de voluntários como CSV e envie aqui. ' +
          'Espera as colunas: Nome; Telefone; Endereço; Duplas; Observações — nessa ordem, ' +
          'com a primeira linha de cabeçalho.'),
        el('input', { class: 'input', type: 'file', accept: '.csv,text/csv',
          onchange: (e) => importarVoluntarios(e.target.files[0], resultado) }),
      ),
    ),
  );
}

async function exportarTudo(saida) {
  saida.replaceChildren(el('p', { class: 'small muted' }, 'Baixando…'));
  const backup = { versao: 1, gerado_em: new Date().toISOString(), dados: {} };
  const falhas = [];

  for (const c of COLECOES) {
    try { backup.dados[c] = await ctx.db.listar(c); }
    catch (err) { falhas.push(`${c}: ${err.message}`); }
  }

  const total = Object.values(backup.dados).reduce((t, l) => t + l.length, 0);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: `obra-missionaria-${hoje()}.json` });
  a.click();
  URL.revokeObjectURL(url);

  saida.replaceChildren(
    el('p', { class: 'small' }, `${total} registro(s) em ${COLECOES.length - falhas.length} coleção(ões).`),
    ...falhas.map(f => el('p', { class: 'small', style: 'color:var(--danger)' }, f)),
  );
  toast('Backup gerado.', 'ok');
}

async function restaurar(saida) {
  const arquivo = el('input', { class: 'input', type: 'file', accept: '.json,application/json' });

  const ok = await modal({
    titulo: 'Restaurar de um backup',
    corpo: el('div', {},
      el('p', { class: 'muted', style: 'margin-bottom:.75rem' },
        'Os registros do arquivo são acrescentados aos que já existem. Nada é apagado.'),
      el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
        'Restaurar o mesmo backup duas vezes é seguro: cada registro guarda seu ' +
        'identificador original, então o que já está no banco é pulado em vez de duplicado. ' +
        'O resumo diz quantos entraram e quantos foram pulados.'),
      el('div', { class: 'field' }, el('label', {}, 'Arquivo'), arquivo),
    ),
    confirmar: 'Restaurar',
    tom: 'danger',
  });
  if (ok !== true || !arquivo.files[0]) return;

  saida.replaceChildren(el('p', { class: 'small muted' }, 'Restaurando…'));
  let backup;
  try {
    backup = JSON.parse(await arquivo.files[0].text());
    if (!backup?.dados) throw new Error('formato irreconhecível');
  } catch (err) {
    saida.replaceChildren(el('p', { style: 'color:var(--danger)' }, `Arquivo inválido: ${err.message}`));
    return;
  }

  const resumo = [];
  for (const c of COLECOES) {
    const linhas = backup.dados[c];
    if (!Array.isArray(linhas) || !linhas.length) continue;
    let gravados = 0, pulados = 0;
    for (const linha of linhas) {
      // Preserva o `id` de propósito: ele é a chave primária, então restaurar
      // o mesmo backup duas vezes pula tudo em vez de duplicar. Descartá-lo
      // faria o banco gerar um id novo e nada colidiria.
      try { await ctx.db.inserir(c, linha); gravados++; }
      catch { pulados++; }
    }
    resumo.push(`${c}: ${gravados} gravado(s)${pulados ? `, ${pulados} pulado(s)` : ''}`);
  }

  // Sem pintar() aqui: ele recria o painel e o resumo iria parar num elemento
  // já descartado. O estado é recarregado e as outras abas repintam ao abrir.
  await recarregar();
  toast('Restauração concluída.', 'ok');
  saida.replaceChildren(
    el('p', { style: 'font-weight:600;margin-bottom:.375rem' }, 'Restauração concluída'),
    ...resumo.map(t => el('p', { class: 'small muted' }, t)),
  );
}

/** CSV simples: separador ; ou , com aspas opcionais. */
function lerCSV(texto) {
  const sep = (texto.split('\n')[0].match(/;/g)?.length ?? 0) >= (texto.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') dentroDeAspas = false;
      else campo += c;
    } else if (c === '"') dentroDeAspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(x => x.trim()));
}

async function importarVoluntarios(arquivo, saida) {
  if (!arquivo) return;
  saida.replaceChildren(el('p', { class: 'small muted' }, 'Lendo o arquivo…'));

  const linhas = lerCSV(await arquivo.text());
  if (linhas.length < 2) {
    saida.replaceChildren(el('p', { style: 'color:var(--danger)' }, 'O arquivo não tem linhas de dados.'));
    return;
  }

  const existentes = new Set((await ctx.db.listar('voluntarios_almoco')).map(v => v.nome.trim().toLowerCase()));
  let gravados = 0, pulados = 0;

  for (const l of linhas.slice(1)) {
    const [nome, telefone, endereco, duplasTxt, observacoes] = l.map(x => (x ?? '').trim());
    if (!nome || nome.length < 2) { pulados++; continue; }
    if (existentes.has(nome.toLowerCase())) { pulados++; continue; }

    try {
      await ctx.db.inserir('voluntarios_almoco', {
        nome,
        telefone: telefone || null,
        endereco: endereco || null,
        duplas: Math.min(4, Math.max(1, parseInt(duplasTxt, 10) || 1)),
        modalidade: /pix/i.test(observacoes || '') ? 'pix'
          : /quentinha/i.test(observacoes || '') ? 'quentinha' : 'presencial',
        periodicidade: 'livre',
        observacoes: observacoes || null,
      });
      existentes.add(nome.toLowerCase());
      gravados++;
    } catch { pulados++; }
  }

  saida.replaceChildren(
    el('p', { class: 'small' }, `${gravados} voluntário(s) importado(s).`),
    pulados ? el('p', { class: 'small muted' }, `${pulados} linha(s) pulada(s) — sem nome ou já cadastradas.`) : null,
  );
  toast(`${gravados} importado(s).`, 'ok');
}
