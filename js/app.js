/** Casca do aplicativo: cabeçalho, navegação, rotas e carregamento dos módulos. */

import { ALA, INICIO, MODULOS } from './config.js';
import * as db from './db.js';
import { menuDaConta, telaDeCompletarCadastro, telaDeEntrada, telaDeTrocarSenha } from './entrada.js';
import { botaoImprimir, definirImpressao } from './impressao.js';
import {
  $, el, modal, toast, confirmar, fecharModal,
  aplicarTema, alternarTema, temaAtual,
  aplicarFonte, ajustarFonte,
  carregando, vazio,
} from './ui.js';

/**
 * `portao`: a tela é uma das de antes do app (entrar, trocar senha, completar
 * cadastro). Quando a sessão muda ali, a pessoa segue para o início.
 */
const rota = { modulo: null, portao: false };

/* ---------------------------------------------------------------------------
   Cabeçalho
--------------------------------------------------------------------------- */

function pintarTema() {
  const escuro = temaAtual() === 'dark';
  const b = $('#btn-tema');
  b.textContent = escuro ? '☀️ Claro' : '🌙 Escuro';
  b.setAttribute('aria-label', escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
}

/**
 * O nome da pessoa no topo, que abre o menu da conta, e o subtítulo do papel.
 * Sem sessão o botão some: não há "logar como LMA" — o líder entra pela
 * mesma tela de todo mundo.
 */
function pintarConta() {
  const admin = db.ehAdmin();
  const nome = db.nomeNaSessao() || (admin ? 'LMA' : 'Conta');
  const b = $('#btn-papel');
  b.hidden = !db.sessaoAtiva();
  $('#papel-icone').textContent = admin ? '🔑' : '👤';
  $('#papel-texto').textContent = nome;
  b.setAttribute('aria-label', `Sua conta: ${nome}. Trocar senha ou sair.`);
  $('.hdr__sub').textContent = admin ? ALA.subtitulo : ALA.subtituloMembro;
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

  $('#btn-papel').addEventListener('click', menuDaConta);
}

/* ---------------------------------------------------------------------------
   Sessão

   Ninguém usa o app sem entrar (js/entrada.js). O membro entra com o e-mail
   e a senha do cadastro; o líder, com o usuário LMA ou ADM no mesmo campo.
   As duas portas terminam numa sessão de verdade do Supabase, e a restrição
   real mora nas policies do banco: um login "só no JavaScript" seria
   decoração num arquivo que qualquer pessoa baixa.
--------------------------------------------------------------------------- */

/**
 * Eventos que não mudam quem está na tela. SESSAO_RENOVADA é o SIGNED_IN que
 * o supabase-js repete, com a mesma pessoa, sempre que a aba volta a ficar
 * visível — o db.js o renomeia para ele não passar por login.
 */
const EVENTOS_SILENCIOSOS = new Set(['TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION', 'SESSAO_RENOVADA']);

async function aoMudarSessao(evento) {
  if (EVENTOS_SILENCIOSOS.has(evento)) return;
  // Trocou a pessoa (outra aba saiu e entrou com outra conta): um "Meu
  // cadastro" ou "Trocar senha" aberto aqui gravaria na conta NOVA o que a
  // anterior digitou.
  if (['SIGNED_IN', 'SIGNED_OUT', 'CADASTRADO'].includes(evento)) fecharModal();
  pintarConta();

  // Editar "Meu cadastro" troca o nome nos calendários: remonta a tela atual,
  // sem tirar a pessoa de onde ela está.
  if (evento === 'CADASTRO' && !rota.portao) return montarModulo();
  // Trocar a senha pelo menu não muda nada na tela.
  if (evento === 'SENHA' && !rota.portao) return;

  if (location.hash.slice(1) === INICIO) await montarModulo();
  else irPara(INICIO);

  // Boas-vindas só quando o app abre de fato — não por cima de "não foi
  // possível carregar o seu cadastro" nem da conta de líder sem vínculo,
  // onde saía um "Olá, !" sem nome.
  const entrouNoApp = !db.precisaTrocarSenha() && !db.faltaCadastro()
    && !db.falhaDeSessao() && !db.liderSemVinculo();
  if (evento === 'SIGNED_IN' && entrouNoApp) {
    toast(db.ehAdmin() ? 'Você entrou como líder de missão da ala.' : `Olá, ${db.nomeNaSessao()}!`, 'ok');
  }
}

/* ---------------------------------------------------------------------------
   Faixa da demonstração

   Fica no topo de todas as telas enquanto o modo durar. Numa apresentação
   projetada, ninguém na sala pode sair achando que aqueles nomes são da ala.
--------------------------------------------------------------------------- */

function pintarFaixaDeDemonstracao() {
  document.title = `Demonstração — ${document.title}`;

  const recomecar = async () => {
    const ok = await confirmar(
      'Recomeçar a demonstração?',
      'Os dados fictícios voltam ao estado inicial. O que foi mexido durante a apresentação se perde.',
      { confirmar: 'Recomeçar', tom: 'primary' },
    );
    if (!ok) return;
    try {
      await db.recomecarDemonstracao();
    } catch (err) {
      // A carga nova é montada antes de apagar a antiga, então uma falha aqui
      // deixa a demonstração como estava — só falta dizer isso.
      console.error('[demo] falha ao recomeçar:', err);
      return toast('Não foi possível recomeçar agora. Os dados atuais continuam.', 'err', 6000);
    }
    location.reload();
  };

  const sair = () => {
    db.sairDaDemonstracao();
    location.replace('/');
  };

  // Logo depois do "pular para o conteúdo", que precisa continuar sendo o
  // primeiro foco da página. Pelo href, não por `.sr-only`: outros elementos
  // usam essa classe.
  $('a[href="#conteudo"]').after(el('div', { class: 'demo-faixa', role: 'note' },
    el('span', {},
      el('strong', {}, '🎭 Demonstração'),
      ' — dados fictícios, guardados só neste navegador. Nada aqui chega ao banco da ala.'),
    el('span', { class: 'demo-faixa__acoes' },
      el('button', { class: 'demo-faixa__btn', type: 'button', onclick: recomecar }, 'Recomeçar dados'),
      el('button', { class: 'demo-faixa__btn', type: 'button', onclick: sair }, 'Sair da demonstração'),
    ),
  ));
}

/* ---------------------------------------------------------------------------
   Navegação

   Membro não vê barra de abas: a tela inicial é o lançador e cada módulo
   ganha um "voltar". O LMA, que alterna bastante entre módulos, vê a barra.
--------------------------------------------------------------------------- */

const modulosVisiveis = () => (db.ehAdmin() ? MODULOS : MODULOS.filter(m => !m.admin));

function pintarNav() {
  const nav = $('#nav');
  const admin = db.ehAdmin() && !rota.portao;

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
  // A tela prometia "o app volta sozinho quando a internet voltar" e nada
  // escutava a volta. Agora escuta: a rede volta, a página recarrega.
  addEventListener('online', () => location.reload(), { once: true });

  // Na demonstração não há banco nem bloqueador envolvidos: o que falhou foi
  // carregar o arquivo com os dados de exemplo, quase sempre por falta de rede.
  if (db.emDemonstracao()) {
    return el('div', {},
      el('div', { class: 'page-head' },
        el('h2', {}, '📡 Não foi possível montar a demonstração'),
        el('p', {}, 'Os dados de exemplo não carregaram. Geralmente é falta de internet.'),
      ),
      el('div', { class: 'card' }, el('div', { class: 'card__body' },
        el('p', { class: 'small muted', style: 'margin-bottom:1rem' },
          'Quando a internet voltar, a página tenta de novo sozinha.'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => location.reload() },
          'Tentar de novo'),
        el('p', { class: 'small muted', style: 'margin-top:1rem' }, db.erroDeConexao()),
      )),
    );
  }

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

/** Banco conectado, tabelas desta versão ainda não criadas. */
function telaDeInstalacao() {
  return el('div', {},
    el('div', { class: 'page-head' },
      el('h2', {}, '🗄️ O banco precisa ser atualizado'),
      el('p', {}, 'O app está conectado ao Supabase, mas faltam as tabelas desta versão.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('p', { class: 'muted', style: 'margin-bottom:.75rem' },
        'Se você é membro da ala, avise o líder de missão — o app volta assim que ele rodar a atualização.'),
      el('ol', { style: 'padding-left:1.25rem;display:grid;gap:.625rem' },
        el('li', {}, 'Abra o painel do Supabase e vá em ', el('strong', {}, 'SQL Editor'), '.'),
        el('li', {}, 'Cole o conteúdo de ', el('code', {}, 'supabase/schema.sql'), ' e rode.'),
        el('li', {}, 'Siga o "último passo", no fim do arquivo, na ordem em que está escrito: ',
          'as contas LMA e ADM primeiro, os blocos A e B, e só então o cadastro sem confirmação de e-mail.'),
        el('li', {}, 'Recarregue esta página.'),
      ),
    )),
  );
}

/**
 * Conta de líder (lma@, adm@...) criada no painel do Supabase mas ainda fora
 * da lista de líderes. Sem esta tela, ela caía em "complete seu cadastro" de
 * membro, que o banco recusa nesse domínio com um erro em inglês.
 */
function telaLiderSemVinculo() {
  const email = db.emailDaSessao() ?? '';
  // Não basta mandar rodar o bloco B: ele só liga conta que NUNCA entrou (é
  // a proteção contra quem registra o endereço antes do dono), e quem vê esta
  // tela acabou de entrar. Mandar rodar de novo era um laço sem fim.
  return el('div', { class: 'entrada' },
    el('div', { class: 'page-head' },
      el('h2', {}, '🔑 Esta conta não está na lista de líderes'),
      el('p', {}, 'Você entrou como ', el('strong', {}, email), '.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('p', { class: 'small', style: 'margin-bottom:.75rem' },
        'A senha está certa, mas a conta não abre as telas do LMA. Desde outubro de 2026, o LeoADM ' +
        'e os acessos liberados por e-mail não entram mais.'),
      el('p', { class: 'small', style: 'margin-bottom:1rem' },
        'Se esta conta deve ser de líder: no Supabase, em Authentication → Users, apague-a e crie de ' +
        'novo com "Auto Confirm User"; rode o bloco B do fim de supabase/schema.sql ANTES de entrar ' +
        'com ela — o bloco só liga conta que nunca entrou.'),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => db.sair() }, 'Sair'),
    )),
  );
}

/** Tem sessão, mas a rede falhou ao perguntar quem é a pessoa. */
function telaFalhaDeSessao() {
  addEventListener('online', () => location.reload(), { once: true });
  return el('div', { class: 'entrada' },
    el('div', { class: 'page-head' },
      el('h2', {}, '📡 Não foi possível carregar o seu cadastro'),
      el('p', {}, 'Geralmente é a internet. Seus dados continuam lá.'),
    ),
    el('div', { class: 'card' }, el('div', { class: 'card__body' },
      el('div', { class: 'row row--wrap' },
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => location.reload() },
          'Tentar de novo'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => db.sair() }, 'Sair'),
      ),
      el('p', { class: 'small muted', style: 'margin-top:1rem' }, db.falhaDeSessao()),
    )),
  );
}

async function montarModulo() {
  const id = moduloDaURL();
  rota.modulo = id;

  // Rota inválida ou sem permissão: alinha a URL ao que está na tela.
  // replaceState não dispara hashchange, então não recursiona.
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);

  // Antes do app: sem sessão, senha provisória, cadastro incompleto, ou sem
  // saber quem é a pessoa. Nada disso tem barra de módulos nem o que imprimir.
  const bloqueio = !db.sessaoAtiva() ? telaDeEntrada
    : db.falhaDeSessao() ? (a) => a.replaceChildren(telaFalhaDeSessao())
    : db.precisaTrocarSenha() ? telaDeTrocarSenha
    : db.liderSemVinculo() ? (a) => a.replaceChildren(telaLiderSemVinculo())
    : db.faltaCadastro() ? telaDeCompletarCadastro
    : null;
  rota.portao = Boolean(bloqueio);

  pintarNav();
  // Até a tela nova montar, não há o que descrever no papel.
  definirImpressao(null);

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

  if (bloqueio) {
    bloqueio(alvo);
    return;
  }

  try {
    const mod = await import(`./modules/${id}.js`);
    // Uma rota mais nova pode ter começado enquanto o import resolvia.
    if (rota.modulo !== id) return;

    // O módulo recebe um contêiner próprio — ele repinta a si mesmo com
    // replaceChildren e não pode levar o botão de voltar junto — e monta FORA
    // da página, entrando só quando termina.
    //
    // Antes o contêiner entrava vazio e o "Carregando…" saía no mesmo
    // instante, então a faixa ficava em branco justamente durante a parte
    // lenta: as consultas que o módulo faz ao banco dentro de montar().
    const host = el('div');
    await mod.montar(host, { db, irPara });
    if (rota.modulo !== id) return;

    alvo.replaceChildren();

    // Imprimir / PDF em toda tela que sabe dizer o que está mostrando — o
    // módulo exporta impressao() —, e só para o LMA (pedido do usuário em
    // outubro de 2026). Fica fora do host pelo mesmo motivo do botão de
    // voltar: o módulo repinta o próprio contêiner.
    const imprime = mod.impressao && db.ehAdmin();
    definirImpressao(imprime ? () => mod.impressao() : null);
    if (imprime) alvo.append(el('div', { class: 'acoes-tela' }, botaoImprimir()));

    if (id !== INICIO && !db.ehAdmin()) {
      alvo.append(el('button', {
        class: 'voltar', type: 'button', onclick: () => irPara(INICIO),
      }, '‹ Início'));
    }
    alvo.append(host);
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
  // O "Carregando…" desta espera vem pintado do index.html: ele aparece junto
  // com o cabeçalho, antes de qualquer módulo ser avaliado. db.iniciar() baixa
  // a biblioteca do Supabase e fala com o servidor, e era aqui que a tela
  // ficava em branco.
  await db.iniciar();
  if (db.emDemonstracao()) pintarFaixaDeDemonstracao();
  pintarConta();

  // Entrar, sair, cadastrar, trocar a senha provisória: a tela acompanha.
  db.aoMudarSessao(aoMudarSessao);

  addEventListener('hashchange', montarModulo);
  await montarModulo();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

iniciar();
