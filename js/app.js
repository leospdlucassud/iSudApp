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

   A restrição real de acesso mora nas policies do banco. Enquanto o Supabase
   não está configurado, o modo prévia libera as telas restritas só neste
   aparelho, sem qualquer garantia — e diz isso com todas as letras.
--------------------------------------------------------------------------- */

async function entrarComoAdmin() {
  if (db.ehAdmin()) return;

  if (!db.temBackend()) {
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
    return;
  }

  const email = el('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'seu e-mail' });
  const corpo = el('div', {},
    el('div', { class: 'field' },
      el('label', {}, 'E-mail'), email,
      el('p', { class: 'field__hint' }, 'Você recebe um link de acesso. Não precisa de senha.')),
  );

  await modal({
    titulo: 'Logar como ADM',
    corpo,
    confirmar: 'Enviar link',
    aoConfirmar: async () => {
      const v = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(v)) throw new Error('Digite um e-mail válido.');
      await db.enviarLinkDeAcesso(v);
      toast('Link enviado. Confira sua caixa de entrada.', 'ok', 6000);
    },
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

  // A volta do link mágico chega depois do primeiro render: quando a sessão
  // resolve, o papel muda e a tela precisa acompanhar.
  db.aoMudarSessao(async () => {
    await aoMudarDePapel();
    if (db.sessaoSemPermissao()) {
      toast('Este e-mail não está na lista de líderes da ala.', 'warn', 7000);
    }
  });

  addEventListener('hashchange', montarModulo);
  await montarModulo();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

iniciar();
