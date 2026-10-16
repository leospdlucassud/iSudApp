/**
 * Configurações — só o LMA.
 *
 * Áreas, duplas de missionários do mês, membros cadastrados e os dados.
 *
 * Sobre o acesso, desde outubro de 2026: cada membro se cadastra sozinho na
 * tela de entrada, e líder é só quem está na tabela `lideres` — as contas LMA
 * e ADM, ligadas por SQL. O app não concede nem tira acesso de ninguém; o que
 * ele faz aqui é mostrar os cadastros ao LMA e gerar senha provisória para
 * quem esqueceu a sua.
 *
 * Quem recusa de verdade são as policies do banco; os botões daqui só evitam
 * oferecer o que ele negaria.
 */

import { AREAS_PADRAO, MESES, corDaArea } from '../config.js';
import { chave, comparaNome, dataCurta, hoje } from '../util.js';
import { confirmar, el, modal, toast, vazio } from '../ui.js';

/**
 * Coleções restauradas de um backup, na ordem em que devem entrar.
 *
 * `membros` não volta na restauração: cada linha é presa a uma conta do
 * Supabase Auth, e restaurar sem a conta falharia — noutro projeto, cada
 * membro se cadastra de novo. Mas o backup a LEVA (ver SO_NO_BACKUP), para o
 * LMA não perder os contatos se o projeto se perder.
 */
const COLECOES = [
  'areas', 'duplas_missionarios',
  'voluntarios_almoco', 'almoco_agenda',
  'disponibilidade_licoes', 'licoes_agenda',
  'relatorio_semanal', 'frequencia_ala', 'batismos', 'progredindo',
  'caminho_pessoas', 'caminho_marcos', 'caminho_frequencia',
  'coordenacao_reunioes', 'coordenacao_presencas', 'coordenacao_designacoes',
  'plano_ala',
];

/** Vão no arquivo, para consulta, mas não são restauradas. */
const SO_NO_BACKUP = ['membros'];

let ctx, raiz;
let aba = 'areas';
let ano = new Date().getFullYear();
let mes = new Date().getMonth();
let areas = [], duplas = [], membros = [];
/** Busca da lista de membros. No módulo, para sobreviver às repinturas. */
let buscaMembro = '';

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
    ctx.db.listar('membros').catch(() => []),
  ]);
  // Aqui, ao contrário dos outros módulos, mostramos o que está GRAVADO.
  // Exibir AREAS_PADRAO como se existisse faria as áreas "sumirem" no
  // instante em que a primeira área real fosse criada.
  areas = [...as].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  duplas = ds;
  membros = ls;
}

/* ---------------------------------------------------------------------------
   Estrutura
--------------------------------------------------------------------------- */

const ABAS = [
  { id: 'areas',  rotulo: '🗺️ Áreas' },
  { id: 'duplas', rotulo: '👔 Duplas' },
  { id: 'membros', rotulo: '👥 Membros' },
  { id: 'dados',  rotulo: '💾 Dados' },
];

function pintar() {
  const paineis = { areas: painelAreas, duplas: painelDuplas, membros: painelMembros, dados: painelDados };

  raiz.replaceChildren(
    el('div', { class: 'page-head' },
      el('h2', {}, '⚙️ Configurações'),
      el('p', {}, 'Áreas da ala, duplas do mês, membros cadastrados e cópia de segurança.'),
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
        el('span', { class: 'small muted nao-imprimir' }, 'salva ao sair do campo'),
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
   Membros cadastrados
--------------------------------------------------------------------------- */

/** Link do WhatsApp: com DDD, o 55 do Brasil vai na frente. */
function linkWhatsApp(telefone) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

function painelMembros() {
  const busca = el('input', {
    class: 'input', type: 'search', placeholder: 'Buscar por nome ou e-mail…',
    style: 'max-width:18rem', value: buscaMembro, 'aria-label': 'Buscar membro',
  });
  const corpo = el('tbody');
  const contagem = el('span', { class: 'small muted' });

  // Só o corpo da tabela repinta ao digitar: repintar o painel inteiro
  // recriaria o campo de busca e tiraria o foco dele a cada letra.
  const desenhar = () => {
    const q = chave(busca.value);
    const lista = membros
      .filter(m => !q || chave(`${m.nome_completo} ${m.apelido} ${m.email}`).includes(q))
      .sort((a, b) => comparaNome(a.nome_completo, b.nome_completo));
    contagem.textContent = q ? `${lista.length} de ${membros.length}` : `${membros.length} cadastrado(s)`;

    corpo.replaceChildren(...(lista.length ? lista.map(m => {
      const zap = m.whatsapp && linkWhatsApp(m.telefone);
      return el('tr', {},
        el('td', {},
          el('strong', {}, m.nome_completo),
          el('div', { class: 'small muted' }, `chamado de ${m.apelido}`)),
        el('td', { class: 'small' }, m.email),
        el('td', { class: 'small nowrap' },
          m.telefone,
          zap && el('div', {}, el('a', { href: zap, target: '_blank', rel: 'noopener' }, '💬 WhatsApp'))),
        el('td', { class: 'small muted nowrap' }, m.criado_em ? dataCurta(m.criado_em.slice(0, 10)) : '—'),
        el('td', {}, el('button', {
          class: 'btn btn--ghost btn--sm nowrap', type: 'button',
          'aria-label': `Gerar senha provisória para ${m.nome_completo}`,
          onclick: () => senhaProvisoria(m),
        }, '🔑 Senha provisória')),
      );
    }) : [el('tr', {}, el('td', { colspan: 5 },
      vazio(q ? 'Ninguém encontrado' : 'Ninguém cadastrado ainda',
            q ? 'Tente outro nome ou e-mail.' : 'Os membros se cadastram na tela de entrada do app.', '👥')))]));
  };
  busca.addEventListener('input', () => { buscaMembro = busca.value; desenhar(); });
  desenhar();

  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'card__title' }, 'Membros cadastrados'),
        contagem,
      ),
      el('div', { class: 'card__body', style: 'padding-bottom:0' }, busca),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Nome'), el('th', {}, 'E-mail'), el('th', {}, 'Telefone'),
            el('th', {}, 'Desde'), el('th', {}, ''),
          )),
          corpo,
        )),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Como o acesso funciona')),
      el('div', { class: 'card__body' },
        el('ul', { style: 'padding-left:1.125rem;display:grid;gap:.5rem' },
          el('li', { class: 'small' },
            'Cada membro se cadastra sozinho na tela de entrada, com nome completo, como quer ser ' +
            'chamado, e-mail, telefone e uma senha. Sem cadastro, ninguém vê nada do app.'),
          el('li', { class: 'small' },
            'Quem esquecer a senha: gere uma provisória aqui e passe para a pessoa. Ela entra com ' +
            'a provisória e o app pede uma nova na mesma hora.'),
          el('li', { class: 'small' },
            'Entram como líder só as contas LMA e ADM. Líder novo é uma linha de SQL no Supabase — ' +
            'de propósito, o app não promove ninguém. O passo a passo está no fim do supabase/schema.sql.'),
        ),
      ),
    ),
  );
}

/** 8 caracteres sem os que se confundem lidos em voz alta ou à mão (l, 1, i, o, 0). */
function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789';
  const sorteio = crypto.getRandomValues(new Uint32Array(8));
  return [...sorteio].map(n => letras[n % letras.length]).join('');
}

async function senhaProvisoria(m) {
  const ok = await confirmar(
    'Gerar senha provisória?',
    `A senha atual de ${m.nome_completo} deixa de funcionar. Você passa a provisória para ` +
    'a pessoa, e o app pede uma senha nova assim que ela entrar.',
    { confirmar: 'Gerar', tom: 'primary' },
  );
  if (!ok) return;

  const senha = gerarSenha();
  try {
    await ctx.db.redefinirSenhaDeMembro(m.id, senha);
  } catch (err) {
    return toast(err?.message || 'Não foi possível gerar a senha.', 'err');
  }

  await modal({
    titulo: 'Senha provisória',
    corpo: el('div', {},
      el('p', { class: 'muted', style: 'margin-bottom:.5rem' }, `Passe para ${m.apelido}:`),
      el('p', { class: 'senha-provisoria' }, senha),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', style: 'margin:.25rem 0 .875rem',
        onclick: () => navigator.clipboard?.writeText(senha)
          .then(() => toast('Senha copiada.', 'ok'), () => toast('Não deu para copiar. Anote a senha.', 'warn')),
      }, '📋 Copiar'),
      el('p', { class: 'small muted' },
        `A pessoa entra com o e-mail ${m.email} e esta senha. Esta janela é a única vez ` +
        'que a senha aparece — se perder, gere outra.'),
      ctx.db.emDemonstracao() && el('p', { class: 'small muted', style: 'margin-top:.5rem' },
        'Na demonstração nenhuma senha é conferida; aqui só se vê como funciona.'),
    ),
    confirmar: 'Pronto',
    cancelar: null,
  });
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
        el('p', { class: 'small muted', style: 'margin-bottom:.75rem' },
          'O cadastro de membros vai no arquivo para consulta — nomes, e-mails e telefones —, mas ' +
          'não volta numa restauração: ele é preso às contas de cada um, e num projeto novo cada ' +
          'membro se cadastra de novo. Guarde o arquivo com cuidado.'),
        el('div', { class: 'row row--wrap' },
          el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => exportarTudo(resultado) }, '⬇ Baixar backup'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => restaurar(resultado) }, '⬆ Restaurar de um backup'),
        ),
        resultado,
      ),
    ),
  );
}

async function exportarTudo(saida) {
  saida.replaceChildren(el('p', { class: 'small muted' }, 'Baixando…'));
  const backup = { versao: 1, gerado_em: new Date().toISOString(), dados: {} };
  const falhas = [];

  for (const c of [...COLECOES, ...SO_NO_BACKUP]) {
    try { backup.dados[c] = await ctx.db.listar(c); }
    catch (err) { falhas.push(`${c}: ${err.message}`); }
  }

  const total = Object.values(backup.dados).reduce((t, l) => t + l.length, 0);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: `obra-missionaria-${hoje()}.json` });
  a.click();
  URL.revokeObjectURL(url);

  saida.replaceChildren(
    el('p', { class: 'small' }, `${total} registro(s) em ${COLECOES.length + SO_NO_BACKUP.length - falhas.length} coleção(ões).`),
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
        'O resumo diz quantos entraram, quantos já existiam e quantos deram erro.'),
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

  // Reservas e disponibilidades feitas por membro levam o membro_id, que
  // aponta para `membros` — e o cadastro não volta numa restauração. Num
  // projeto novo, toda linha dessas batia na chave estrangeira e sumia,
  // contada como "pulada". Sem o cadastro, ela entra sem o vínculo: o nome
  // continua na linha, e é o nome que a grade mostra.
  let cadastrados;
  try {
    cadastrados = new Set((await ctx.db.listar('membros')).map(m => m.id));
  } catch (err) {
    // Sem a lista, cada vínculo seria desfeito à toa — inclusive o de quem
    // tem cadastro. Melhor não restaurar nada agora.
    saida.replaceChildren(el('p', { style: 'color:var(--danger)' },
      `Não foi possível ler os cadastros para restaurar: ${err?.message || err}. Tente de novo.`));
    return;
  }

  const resumo = [];
  for (const c of COLECOES) {
    const linhas = backup.dados[c];
    if (!Array.isArray(linhas) || !linhas.length) continue;
    let gravados = 0, existiam = 0, desligados = 0;
    const falhas = [];
    for (const original of linhas) {
      const semVinculo = Boolean(original.membro_id) && !cadastrados.has(original.membro_id);
      const linha = semVinculo ? { ...original, membro_id: null } : original;
      // Preserva o `id` de propósito: ele é a chave primária, então restaurar
      // o mesmo backup duas vezes pula tudo em vez de duplicar. Descartá-lo
      // faria o banco gerar um id novo e nada colidiria.
      try {
        await ctx.db.inserir(c, linha);
        gravados++;
        if (semVinculo) desligados++;
      }
      catch (err) {
        // Só o conflito de chave é "já estava no banco". Qualquer outro erro
        // é falha, e aparece como falha — contado como "pulado", ele passava
        // por duplicata.
        if (err?.name === 'ConflitoError') existiam++;
        else falhas.push(err?.message || 'erro desconhecido');
      }
    }
    resumo.push([
      `${c}: ${gravados} gravado(s)`,
      existiam && `${existiam} já existia(m)`,
      desligados && `${desligados} sem o vínculo com o cadastro do membro`,
      falhas.length && `${falhas.length} com erro (${[...new Set(falhas)].slice(0, 2).join('; ')})`,
    ].filter(Boolean).join(', '));
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
