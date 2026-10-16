/**
 * Entrada no app: login, cadastro, cadastro incompleto, troca de senha e o
 * menu da conta.
 *
 * Desde outubro de 2026 ninguém usa o app sem entrar. Uma tela só serve a
 * todos: o membro entra com o e-mail e a senha do cadastro, e o líder digita
 * LMA (ou ADM) no mesmo campo. Não existe mais botão de "logar como LMA".
 *
 * Nenhuma senha mora aqui. Quem confere é o Supabase Auth, e quem decide o
 * que cada um vê são as policies do banco.
 */

import * as db from './db.js';
import { el, fecharModal, modal, toast } from './ui.js';

/** Qual das duas telas de quem ainda não entrou: o login ou o cadastro. */
let visao = 'entrar';

let seq = 0;
/** Rótulo, campo e dica, ligados por id — o leitor de tela lê os três juntos. */
function campo(rotulo, entrada, dica) {
  entrada.id ||= `entrada-${++seq}`;
  const p = dica && el('p', { class: 'field__hint', id: `${entrada.id}-dica` }, dica);
  if (p) entrada.setAttribute('aria-describedby', p.id);
  return el('div', { class: 'field' }, el('label', { for: entrada.id }, rotulo), entrada, p);
}

const texto = (atrs) => el('input', { class: 'input', type: 'text', ...atrs });

const SEM_CORRECAO = { autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' };

/**
 * Envia um formulário: trava o botão, mostra o erro embaixo dele. O sucesso
 * não faz nada aqui — a sessão muda e a casca troca a tela inteira.
 */
async function enviar(botao, erro, fn) {
  botao.disabled = true;
  erro.textContent = '';
  try {
    await fn();
  } catch (err) {
    erro.textContent = err?.message || 'Não foi possível concluir.';
    botao.disabled = false;
  }
}

/** Campos de cadastro, os mesmos no cadastro, no "complete" e em "Meu cadastro". */
function camposDoCadastro(inicial = {}) {
  const c = {
    nome_completo: texto({ name: 'nome', autocomplete: 'name', value: inicial.nome_completo ?? '', maxlength: '120' }),
    apelido: texto({ name: 'apelido', autocomplete: 'nickname', value: inicial.apelido ?? '', maxlength: '40' }),
    telefone: el('input', {
      class: 'input', type: 'tel', name: 'telefone', autocomplete: 'tel', inputmode: 'tel',
      placeholder: '(63) 99999-9999', value: inicial.telefone ?? '',
    }),
    whatsapp: el('input', { type: 'checkbox', name: 'whatsapp', checked: inicial.whatsapp ?? true }),
  };
  const ler = () => ({
    nome_completo: c.nome_completo.value,
    apelido: c.apelido.value,
    telefone: c.telefone.value,
    whatsapp: c.whatsapp.checked,
  });
  const nos = [
    campo('Nome completo', c.nome_completo),
    campo('Como quer ser chamado', c.apelido,
      'É o nome que aparece nos calendários de almoço e de lições. Ex.: Irmã Helena, Família Souza.'),
    campo('Telefone ou WhatsApp', c.telefone),
    el('label', { class: 'check' }, c.whatsapp, 'Este número tem WhatsApp'),
  ];
  return { nos, ler };
}

const senhaNova = (rotulo, nome) => el('input', {
  class: 'input', type: 'password', name: nome, autocomplete: 'new-password', placeholder: rotulo,
});

/* ---------------------------------------------------------------------------
   Sem sessão: entrar ou cadastrar
--------------------------------------------------------------------------- */

export function telaDeEntrada(alvo) {
  const pintar = (v) => { visao = v; telaDeEntrada(alvo); };
  alvo.replaceChildren(el('div', { class: 'entrada' },
    ...(visao === 'cadastro' ? telaDeCadastro(pintar) : telaDeLogin(pintar))));
  focarPrimeiroCampo(alvo);
}

function telaDeLogin(pintar) {
  const email = texto({
    name: 'email', autocomplete: 'username', inputmode: 'email', placeholder: 'seu e-mail', ...SEM_CORRECAO,
  });
  const senha = el('input', {
    class: 'input', type: 'password', name: 'senha', autocomplete: 'current-password', placeholder: 'sua senha',
  });
  const erro = el('p', { class: 'form__erro', role: 'alert' });
  const botao = el('button', { class: 'btn btn--primary btn--bloco', type: 'submit' }, 'Entrar');

  const login = el('form', {
    class: 'card', novalidate: true,
    onsubmit: (e) => { e.preventDefault(); enviar(botao, erro, () => db.entrar(email.value, senha.value)); },
  },
    el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Entrar')),
    el('div', { class: 'card__body' },
      campo('E-mail', email),
      campo('Senha', senha),
      erro,
      botao,
      el('button', { class: 'btn-link', type: 'button', onclick: esqueciASenha }, 'Esqueci minha senha'),
    ),
  );

  const convite = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Primeira vez aqui?')),
    el('div', { class: 'card__body' },
      el('p', { class: 'small muted', style: 'margin-bottom:.875rem' },
        'Quem vai oferecer almoço aos missionários, acompanhar lições ou usar o app ' +
        'faz um cadastro rápido, uma vez só.'),
      el('button', { class: 'btn btn--ghost btn--bloco', type: 'button', onclick: () => pintar('cadastro') },
        'Criar meu cadastro'),
    ),
  );

  return [
    el('div', { class: 'page-head' },
      el('h2', {}, 'Bem-vindo'),
      el('p', {}, 'Para usar o app, entre com o seu cadastro.'),
    ),
    login,
    convite,
    db.senhaDeMentira() && atalhosSemSenha(),
  ];
}

function esqueciASenha() {
  modal({
    titulo: 'Esqueci minha senha',
    corpo: el('div', {},
      el('p', { class: 'muted', style: 'margin-bottom:.75rem' },
        'Peça ao líder de missão da ala uma senha provisória.'),
      el('p', { class: 'small muted' },
        'Ele gera a senha pelo app. Você entra com ela e escolhe uma nova na mesma hora.'),
    ),
    confirmar: 'Entendi',
    cancelar: null,
  });
}

/**
 * Demonstração e desenvolvimento local: senha nenhuma é conferida, e quem
 * apresenta precisa trocar de lado rápido. Um toque entra como LMA ou como um
 * membro de exemplo.
 */
function atalhosSemSenha() {
  const membro = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', hidden: true }, '👤 Entrar como membro de exemplo');
  db.listar('membros').then((ms) => {
    // Uma pessoa, não uma família: é quem a plateia imagina usando o app.
    const ordem = [...ms].sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'));
    const m = ordem.find(x => /^Irm[ãa]o? /.test(x.apelido)) ?? ordem[0];
    if (!m) return;
    membro.hidden = false;
    membro.textContent = `👤 Entrar como ${m.apelido}`;
    membro.addEventListener('click', () => db.entrar(m.email, '-').catch(err => toast(err.message, 'err')));
  }).catch(() => {});

  return el('div', { class: 'card entrada__atalhos' },
    el('div', { class: 'card__body' },
      el('p', { class: 'small', style: 'margin-bottom:.625rem' },
        el('strong', {}, db.emDemonstracao() ? '🎭 Demonstração' : '🛠️ Modo local'),
        ' — aqui a senha não é conferida. Para a visão do líder, digite LMA (ou ADM) e ' +
        'qualquer senha. Para a de membro, use o e-mail de um cadastro, ou o atalho:'),
      // Sem botão de "entrar como LMA", nem aqui: o pedido foi tirá-lo da
      // tela. O LMA entra digitando, como no app de verdade.
      el('div', { class: 'row row--wrap' }, membro),
    ),
  );
}

function telaDeCadastro(pintar) {
  const cad = camposDoCadastro();
  // autocomplete "username", e não "email": é o que diz ao gerenciador de
  // senhas de quem é a senha nova. Sem ele, o Chrome escolhia o campo de texto
  // mais perto da senha — o telefone — e o próximo login saía preenchido com
  // o número no lugar do e-mail.
  const email = el('input', {
    class: 'input', type: 'email', name: 'email', autocomplete: 'username', placeholder: 'seu e-mail', ...SEM_CORRECAO,
  });
  const senha = senhaNova('pelo menos 8 caracteres', 'senha');
  const repetida = senhaNova('a mesma senha de novo', 'senha2');
  const erro = el('p', { class: 'form__erro', role: 'alert' });
  const botao = el('button', { class: 'btn btn--primary btn--bloco', type: 'submit' }, 'Criar cadastro');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      enviar(botao, erro, async () => {
        await db.cadastrar({ ...cad.ler(), email: email.value }, senha.value, repetida.value);
        // Volta ao login para a próxima pessoa no mesmo aparelho — quando ela
        // sair, encontra a tela de entrar, não um cadastro a meio.
        visao = 'entrar';
        toast(`Cadastro criado. Bem-vindo, ${db.meuCadastro()?.apelido ?? ''}!`, 'ok', 5000);
      });
    },
  },
    el('div', { class: 'card__head' }, el('span', { class: 'card__title' }, 'Criar meu cadastro')),
    el('div', { class: 'card__body' },
      cad.nos[0], cad.nos[1],
      campo('E-mail', email, 'É com ele que você entra no app.'),
      cad.nos[2], cad.nos[3],
      campo('Senha', senha),
      campo('Repita a senha', repetida,
        'Guarde bem: se esquecer, só o líder de missão gera uma provisória.'),
      el('p', { class: 'small muted', style: 'margin-bottom:.875rem' },
        'Seu e-mail e telefone ficam visíveis só para o líder de missão da ala.'),
      erro,
      botao,
      el('button', { class: 'btn-link', type: 'button', onclick: () => pintar('entrar') },
        'Já tenho cadastro — entrar'),
    ),
  );

  return [
    el('div', { class: 'page-head' },
      el('h2', {}, 'Cadastro de membro'),
      el('p', {}, 'Leva um minuto, e é uma vez só.'),
    ),
    form,
  ];
}

/* ---------------------------------------------------------------------------
   Com sessão, antes do app
--------------------------------------------------------------------------- */

/**
 * Sessão sem cadastro: o signUp criou a conta, mas gravar em `membros`
 * falhou (rede caindo no meio, por exemplo). Os dados voltam do próprio
 * usuário do Auth, guardados no signUp.
 */
const focarPrimeiroCampo = (alvo) =>
  alvo.querySelector('input:not([hidden]):not([type=hidden])')?.focus({ preventScroll: true });

export function telaDeCompletarCadastro(alvo) {
  visao = 'entrar';
  const cad = camposDoCadastro(db.cadastroGuardadoNaConta());
  const erro = el('p', { class: 'form__erro', role: 'alert' });
  const botao = el('button', { class: 'btn btn--primary btn--bloco', type: 'submit' }, 'Salvar e continuar');

  alvo.replaceChildren(el('div', { class: 'entrada' },
    el('div', { class: 'page-head' },
      el('h2', {}, 'Falta completar o seu cadastro'),
      el('p', {}, 'Sua conta existe, mas os dados não chegaram a ser gravados. Confira e salve.'),
    ),
    el('form', {
      class: 'card', novalidate: true,
      onsubmit: (e) => { e.preventDefault(); enviar(botao, erro, () => db.completarCadastro(cad.ler())); },
    },
      el('div', { class: 'card__body' },
        el('p', { class: 'small muted', style: 'margin-bottom:.875rem' },
          'E-mail: ', el('strong', {}, db.emailDaSessao() ?? '—')),
        ...cad.nos,
        erro,
        botao,
        el('button', { class: 'btn-link', type: 'button', onclick: () => db.sair() }, 'Sair'),
      ),
    ),
  ));
  focarPrimeiroCampo(alvo);
}

/** Senha provisória (a inicial do LMA, ou a que o LMA gerou): troca antes de tudo. */
export function telaDeTrocarSenha(alvo) {
  visao = 'entrar';
  const senha = senhaNova('pelo menos 8 caracteres', 'senha');
  const repetida = senhaNova('a mesma senha de novo', 'senha2');
  const erro = el('p', { class: 'form__erro', role: 'alert' });
  const botao = el('button', { class: 'btn btn--primary btn--bloco', type: 'submit' }, 'Salvar e continuar');

  alvo.replaceChildren(el('div', { class: 'entrada' },
    el('div', { class: 'page-head' },
      el('h2', {}, 'Escolha uma senha nova'),
      el('p', {}, 'Você entrou com uma senha provisória. Defina a sua para continuar.'),
    ),
    el('form', {
      class: 'card', novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        enviar(botao, erro, async () => {
          await db.trocarSenha(senha.value, repetida.value);
          toast('Senha trocada.', 'ok');
        });
      },
    },
      el('div', { class: 'card__body' },
        // O usuário vai junto, escondido: é o que deixa o gerenciador de senhas
        // do celular guardar a senha nova na conta certa.
        el('input', { type: 'text', name: 'email', autocomplete: 'username', value: db.emailDaSessao() ?? '', hidden: true, readonly: true }),
        campo('Senha nova', senha),
        campo('Repita a senha nova', repetida),
        erro,
        botao,
        el('button', { class: 'btn-link', type: 'button', onclick: () => db.sair() }, 'Sair'),
      ),
    ),
  ));
  focarPrimeiroCampo(alvo);
}

/* ---------------------------------------------------------------------------
   Menu da conta — o nome no topo da tela
--------------------------------------------------------------------------- */

export function menuDaConta() {
  const lider = db.ehAdmin();
  const item = (rotulo, fn) =>
    el('button', { class: 'btn btn--ghost btn--bloco', type: 'button', onclick: fn }, rotulo);

  modal({
    titulo: 'Sua conta',
    corpo: el('div', {},
      el('p', { style: 'margin-bottom:.125rem' }, el('strong', {}, db.nomeNaSessao())),
      el('p', { class: 'small muted', style: 'margin-bottom:1rem' },
        lider ? 'Líder de missão da ala' : db.emailDaSessao()),
      el('div', { class: 'stack', style: 'gap:.5rem' },
        // Só com cadastro gravado: na tela de "complete seu cadastro" não há
        // o que editar, e salvar acabaria em erro.
        db.meuCadastro() && item('✏️ Meu cadastro', editarMeuCadastro),
        item('🔒 Trocar senha', trocarSenhaPeloMenu),
        item('↩ Sair', async () => {
          // Fecha o menu antes: a tela inteira vai mudar com a sessão.
          fecharModal();
          await db.sair();
          toast('Você saiu.');
        }),
      ),
    ),
    confirmar: null,
    cancelar: 'Fechar',
  });
}

function editarMeuCadastro() {
  const atual = db.meuCadastro() ?? {};
  const cad = camposDoCadastro(atual);
  modal({
    titulo: 'Meu cadastro',
    corpo: el('div', {},
      el('p', { class: 'small muted', style: 'margin-bottom:.875rem' },
        'E-mail: ', el('strong', {}, atual.email ?? '—'),
        ' — é com ele que você entra, e por isso não muda por aqui.'),
      ...cad.nos,
    ),
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      await db.atualizarMeuCadastro(cad.ler());
      toast('Cadastro atualizado.', 'ok');
    },
  });
}

function trocarSenhaPeloMenu() {
  const senha = senhaNova('pelo menos 8 caracteres', 'senha');
  const repetida = senhaNova('a mesma senha de novo', 'senha2');
  modal({
    titulo: 'Trocar senha',
    corpo: el('div', {},
      el('input', { type: 'text', name: 'email', autocomplete: 'username', value: db.emailDaSessao() ?? '', hidden: true, readonly: true }),
      campo('Senha nova', senha),
      campo('Repita a senha nova', repetida),
    ),
    confirmar: 'Trocar',
    aoConfirmar: async () => {
      await db.trocarSenha(senha.value, repetida.value);
      toast('Senha trocada.', 'ok');
    },
  });
}
