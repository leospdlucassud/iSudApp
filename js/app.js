/** Casca do aplicativo: cabeçalho, navegação, rotas e carregamento dos módulos. */

import { INICIO, MODULOS } from './config.js';
import * as db from './db.js';
import {
  $, el, modal, toast,
  aplicarTema, alternarTema, temaAtual,
  aplicarFonte, ajustarFonte,
  carregando, vazio,
} from './ui.js';

const rota = { modulo: null };

/* ---------------------------------------------------------------------------
   Cabeçalho
--------------------------------------------------------------------------- */

function pintarTema() {
  const escuro = temaAtual() === 'dark';
  const b = $('#btn-tema');
  b.textContent = escuro ? '☀️ Claro' : '🌙 Escuro';
  b.setAttribute('aria-label', escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
}

function pintarPapel() {
  const admin = db.ehAdmin();
  $('#papel-icone').textContent = admin ? '🔑' : '👥';
  $('#papel-texto').textContent = admin ? 'LMA' : 'Membro';
  $('#btn-papel').setAttribute(
    'aria-label',
    admin ? 'Você está como líder de missão da ala. Toque para sair.' : 'Entrar como líder de missão da ala',
  );
}

function ligarCabecalho() {
  aplicarTema();
  aplicarFonte();
  pintarTema();

  $('#btn-tema').addEventListener('click', () => { alternarTema(); pintarTema(); });

  const fonte = (passo) => {
    const { min, max } = ajustarFonte(passo);
    $('#btn-fonte-menos').disabled = min;
    $('#btn-fonte-mais').disabled = max;
  };
  $('#btn-fonte-menos').addEventListener('click', () => fonte(-1));
  $('#btn-fonte-mais').addEventListener('click', () => fonte(+1));
  fonte(0);

  $('#btn-papel').addEventListener('click', () => (db.ehAdmin() ? sairDoAdmin() : entrarComoAdmin()));
  pintarPapel();
}

/* ---------------------------------------------------------------------------
   Entrada e saída do líder

   Duas portas, e as duas terminam numa sessão de verdade do Supabase — a
   restrição real de acesso mora nas policies do banco, que leem o e-mail do
   token. Não existe login "só no JavaScript" aqui: seria decoração num arquivo
   que qualquer pessoa baixa, e o banco negaria tudo do mesmo jeito.

     1. Usuário e senha — a conta do dono. A sessão nasce neste aparelho.
     2. Código de 6 dígitos no e-mail — para os demais LMAs.

   O código passou a ser o caminho do e-mail por um motivo concreto: quem pedia
   o link no computador e abria o e-mail no celular acabava logado no celular,
   porque a sessão nasce em quem ABRE o link. O link continua chegando no mesmo
   e-mail e continua valendo; só deixou de ser a única opção.

   Enquanto o Supabase não está configurado, o modo prévia libera as telas
   restritas só neste aparelho, sem qualquer garantia — e diz isso com todas
   as letras.
--------------------------------------------------------------------------- */

async function entrarComoAdmin() {
  if (db.ehAdmin()) return;
  if (!db.temBackend()) return entrarEmPrevia();
  await telaDeSenha();
}

async function entrarEmPrevia() {
  const corpo = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:.75rem' },
      'O acesso de líder é validado pelo banco de dados, que ainda não foi conectado.'),
    el('p', { class: 'small muted' },
      'Você pode abrir as telas restritas em modo prévia para conferir o layout. ' +
      'Nesse modo nada é protegido e os dados ficam só neste aparelho.'),
  );
  const ok = await modal({ titulo: 'Acesso do LMA', corpo, confirmar: 'Abrir em modo prévia' });
  if (ok !== true) return;

  db.entrarEmPrevia();
  await aoMudarDePapel();
  toast('Modo prévia ativo. Nada aqui está protegido.', 'warn', 5000);
}

/** Porta principal: usuário e senha, a conta do dono. */
async function telaDeSenha() {
  const usuario = el('input', {
    class: 'input', type: 'text', autocomplete: 'username',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'usuário ou e-mail',
  });
  const senha = el('input', {
    class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'senha',
  });

  const corpo = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Usuário ou e-mail'), usuario),
    el('div', { class: 'field' }, el('label', {}, 'Senha'), senha),
    el('div', { class: 'ou' }, el('span', {}, 'ou')),
    el('button', {
      class: 'btn btn--ghost btn--bloco', type: 'button',
      onclick: () => telaDePedirCodigo(usuario.value),
    }, '✉️ Receber um código por e-mail'),
    el('p', { class: 'field__hint', style: 'margin-top:.5rem' },
      'O código é para quem o dono liberou pelo e-mail e não tem senha.'),
  );

  await modal({
    titulo: '🔑 Logar como ADM',
    corpo,
    confirmar: 'Entrar',
    aoConfirmar: () => db.entrarComSenha(usuario.value, senha.value),
  });
}

/** Pede o código e devolve o e-mail para o passo seguinte. */
async function telaDePedirCodigo(sugestao = '') {
  const inicial = String(sugestao || '').includes('@') ? String(sugestao).trim() : '';
  const email = el('input', {
    class: 'input', type: 'email', autocomplete: 'email',
    value: inicial, placeholder: 'seu e-mail',
  });

  const corpo = el('div', {},
    el('div', { class: 'field' },
      el('label', {}, 'E-mail'), email,
      el('p', { class: 'field__hint' },
        'Precisa ser um e-mail que já tenha acesso liberado. ' +
        'Você recebe um código de 6 dígitos para digitar aqui mesmo.')),
  );

  const alvo = await modal({
    titulo: '✉️ Entrar com código',
    corpo,
    confirmar: 'Enviar código',
    aoConfirmar: async () => {
      const v = email.value.trim().toLowerCase();
      await db.pedirCodigo(v);
      return v;
    },
  });

  // O modal resolve com o e-mail, e o encadeamento acontece aqui fora, não
  // dentro do `aoConfirmar`: abrir um modal enquanto o anterior ainda está
  // fechando faria o fechamento do antigo apagar o registro do novo.
  if (typeof alvo === 'string') await telaDeConferirCodigo(alvo);
}

async function telaDeConferirCodigo(email) {
  const codigo = el('input', {
    class: 'input input--num', type: 'text', inputmode: 'numeric',
    autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000',
  });

  const corpo = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:.875rem' },
      'Enviamos um código de 6 dígitos para ', el('strong', {}, email), '.'),
    el('div', { class: 'field' },
      el('label', {}, 'Código'), codigo,
      el('p', { class: 'field__hint' },
        'Digite o código aqui, neste mesmo aparelho — é o que garante que você ' +
        'entre onde começou. O link do mesmo e-mail também funciona, mas loga ' +
        'no aparelho em que for aberto.')),
    el('button', {
      class: 'btn btn--ghost btn--bloco', type: 'button',
      onclick: () => telaDePedirCodigo(email),
    }, 'Reenviar ou trocar o e-mail'),
  );

  await modal({
    titulo: '✉️ Código de acesso',
    corpo,
    confirmar: 'Entrar',
    aoConfirmar: () => db.conferirCodigo(email, codigo.value),
  });
}

async function sairDoAdmin() {
  await db.sair();
  await aoMudarDePapel();
  toast('Você saiu do acesso de líder.');
}

/** Repinta tudo e volta à tela inicial, que muda de conteúdo conforme o papel. */
async function aoMudarDePapel() {
  pintarPapel();
  if (location.hash.slice(1) === INICIO) await montarModulo();
  else irPara(INICIO);
}

/* ---------------------------------------------------------------------------
   Navegação

   Membro não vê barra de abas: a tela inicial é o lançador e cada módulo
   ganha um "voltar". O LMA, que alterna bastante entre módulos, vê a barra.
--------------------------------------------------------------------------- */

const modulosVisiveis = () => (db.ehAdmin() ? MODULOS : MODULOS.filter(m => !m.admin));

function pintarNav() {
  const nav = $('#nav');
  const admin = db.ehAdmin();

  nav.hidden = !admin;
  if (!admin) return nav.replaceChildren();

  const item = (id, rotulo) =>
    el('button', {
      class: 'nav__btn',
      type: 'button',
      'aria-current': id === rota.modulo ? 'page' : null,
      onclick: () => irPara(id),
    }, rotulo);

  nav.replaceChildren(
    item(INICIO, '🏠 Início'),
    ...modulosVisiveis().map(m => item(m.id, `${m.icone} ${m.label}`)),
  );
}

function irPara(id) {
  if (location.hash.slice(1) === id) montarModulo();
  else location.hash = id;
}

/* ---------------------------------------------------------------------------
   Rotas
--------------------------------------------------------------------------- */

function moduloDaURL() {
  const id = location.hash.slice(1);
  if (id === INICIO) return INICIO;
  return modulosVisiveis().some(m => m.id === id) ? id : INICIO;
}

/** Credenciais existem, mas não deu para conectar. */
function telaSemConexao() {
  return el('div', {},
    el('div', { class: 'page-head' },
      el('h2', {}, '📡 Sem conexão com o banco de dados'),
      el('p', {}, 'O app não conseguiu conectar, então nada seria compartilhado com a ala.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('p', { style: 'margin-bottom:.75rem' }, 'O motivo mais comum é um bloqueador de conteúdo.'),
      el('ul', { style: 'padding-left:1.125rem;display:grid;gap:.5rem;margin-bottom:1rem' },
        el('li', { class: 'small' }, 'No Brave, toque no escudo ao lado do endereço e desative para este site.'),
        el('li', { class: 'small' }, 'Em outros navegadores, verifique extensões de bloqueio de anúncios.'),
        el('li', { class: 'small' }, 'Se estiver sem internet, o app volta sozinho quando ela voltar.'),
      ),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => location.reload() },
        'Tentar de novo'),
      el('p', { class: 'small muted', style: 'margin-top:1rem' }, db.erroDeConexao()),
    )),
  );
}

/** Site publicado sem as credenciais do Supabase. */
function telaSemConfiguracao() {
  return el('div', {},
    el('div', { class: 'page-head' },
      el('h2', {}, '⚙️ App não configurado'),
      el('p', {}, 'Este endereço não está ligado ao banco de dados, então nada seria compartilhado.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('p', { class: 'muted', style: 'margin-bottom:.75rem' },
        'Se você é membro da ala, avise o líder de missão — o app volta assim que ele ajustar.'),
      el('p', { class: 'small muted' },
        'Para o LMA: defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente do ' +
        'Netlify e publique de novo. O build gera js/supabase-config.js sozinho.'),
    )),
  );
}

/** Banco conectado, tabelas ainda não criadas. */
function telaDeInstalacao() {
  return el('div', {},
    el('div', { class: 'page-head' },
      el('h2', {}, '🗄️ Falta criar as tabelas'),
      el('p', {}, 'O app já está conectado ao Supabase, mas o banco está vazio.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('ol', { style: 'padding-left:1.25rem;display:grid;gap:.625rem' },
        el('li', {}, 'Abra o painel do Supabase e vá em ', el('strong', {}, 'SQL Editor'), '.'),
        el('li', {}, 'Cole o conteúdo de ', el('code', {}, 'supabase/schema.sql'), ' e rode.'),
        el('li', {}, 'No fim do arquivo, descomente as últimas linhas com o seu e-mail e rode de novo — ',
          'sem estar na tabela ', el('code', {}, 'lideres'), ', ninguém abre as telas restritas.'),
        el('li', {}, 'Recarregue esta página.'),
      ),
    )),
  );
}

async function montarModulo() {
  const id = moduloDaURL();
  rota.modulo = id;

  // Rota inválida ou sem permissão: alinha a URL ao que está na tela.
  // replaceState não dispara hashchange, então não recursiona.
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);

  pintarNav();

  const alvo = $('#conteudo');
  alvo.replaceChildren(carregando());

  if (db.erroDeConexao()) {
    alvo.replaceChildren(telaSemConexao());
    return;
  }

  if (db.faltaConfiguracao()) {
    alvo.replaceChildren(telaSemConfiguracao());
    return;
  }

  if (!db.schemaPronto()) {
    alvo.replaceChildren(telaDeInstalacao());
    return;
  }

  try {
    const mod = await import(`./modules/${id}.js`);
    // Uma rota mais nova pode ter começado enquanto o import resolvia.
    if (rota.modulo !== id) return;

    alvo.replaceChildren();
    if (id !== INICIO && !db.ehAdmin()) {
      alvo.append(el('button', {
        class: 'voltar', type: 'button', onclick: () => irPara(INICIO),
      }, '‹ Início'));
    }

    // O módulo recebe um contêiner próprio: ele repinta a si mesmo com
    // replaceChildren e não pode levar o botão de voltar junto.
    const host = el('div');
    alvo.append(host);
    await mod.montar(host, { db, irPara, entrarComoAdmin });
  } catch (err) {
    if (rota.modulo !== id) return;
    console.error(`[${id}]`, err);
    alvo.replaceChildren(vazio(
      'Não foi possível abrir esta tela',
      err?.message || 'Tente recarregar a página.',
      '⚠️',
    ));
  }
  alvo.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------------------
   Início
--------------------------------------------------------------------------- */

async function iniciar() {
  ligarCabecalho();
  await db.iniciar();
  pintarPapel();

  // A sessão resolve depois do primeiro render — seja restaurada do
  // armazenamento, seja recém-criada pelo login. Quando resolve, o papel muda
  // e a tela precisa acompanhar.
  db.aoMudarSessao(async (evento) => {
    // Renovação silenciosa de token não muda papel nenhum e não deve repintar.
    if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;

    await aoMudarDePapel();

    if (db.sessaoSemPermissao()) {
      toast('Este e-mail não está na lista de líderes da ala.', 'warn', 7000);
    } else if (evento === 'SIGNED_IN' && db.ehAdmin()) {
      // Só no login de verdade: em INITIAL_SESSION este aviso reapareceria a
      // cada recarga de página para quem já está logado.
      toast('Você entrou como líder de missão da ala.', 'ok');
    }
  });

  addEventListener('hashchange', montarModulo);
  await montarModulo();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

iniciar();
