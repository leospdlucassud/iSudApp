/**
 * Camada de dados.
 *
 * Dois backends por trás da mesma interface:
 *
 *  - Supabase — Postgres com Realtime e RLS. É o modo de produção. As telas
 *    restritas e a trava contra dois membros pegarem o mesmo dia só valem
 *    aqui, porque quem garante ambas é o banco, não o JavaScript.
 *
 *  - Local — localStorage com BroadcastChannel entre abas. Serve para
 *    desenvolver e para a demonstração. Não protege nada: o login local não
 *    confere senha, só escolhe quem a tela mostra.
 *
 * Os dois têm a mesma sessão por trás: ninguém usa o app sem entrar. O membro
 * entra com o e-mail e a senha do cadastro; o líder, com o usuário LMA ou ADM.
 *
 * Para ligar o Supabase, crie `js/supabase-config.js` (fora do Git):
 *
 *     export const URL = 'https://xxxx.supabase.co';
 *     export const ANON_KEY = 'eyJ...';
 */

import { DOMINIO_USUARIO } from './config.js';
import { hoje, uuid } from './util.js';

/** Violação de unicidade — o registro já existe. */
export class ConflitoError extends Error {
  constructor(msg = 'Este horário acabou de ser preenchido por outra pessoa.') {
    super(msg);
    this.name = 'ConflitoError';
  }
}

/**
 * Chaves únicas por coleção. Espelham as constraints UNIQUE do Postgres.
 *
 * Precisa estar completo: é daqui que sai o `onConflict` do upsert. Uma
 * coleção esquecida aqui cai no insert simples e transforma uma duplicata
 * inofensiva em erro na cara do usuário.
 */
const UNICOS = {
  almoco_agenda:       ['data', 'area_id'],
  licoes_agenda:       ['data', 'horario', 'area_id'],
  relatorio_semanal:   ['data', 'area_id'],
  frequencia_ala:      ['data'],
  caminho_marcos:      ['pessoa_id', 'marco'],
  caminho_frequencia:  ['pessoa_id', 'domingo'],
  plano_ala:           ['secao'],
};

let backend = null;
let ehSupabase = false;

/**
 * Quem quer ser avisado quando a sessão muda.
 *
 * O aviso carrega o evento do GoTrue ('INITIAL_SESSION', 'SIGNED_IN',
 * 'SIGNED_OUT', 'TOKEN_REFRESHED'...) porque a tela precisa distinguir "acabou
 * de entrar" de "sessão restaurada na carga da página".
 */
const ouvintesDeSessao = new Set();
const avisarSessao = (evento) => ouvintesDeSessao.forEach(fn => fn(evento));

/** @param {(evento: string) => void} cb @returns {() => void} cancelador */
export function aoMudarSessao(cb) {
  ouvintesDeSessao.add(cb);
  return () => ouvintesDeSessao.delete(cb);
}

/* ==========================================================================
   Backend local
   ========================================================================== */

/**
 * @param {string} PREFIXO chave do localStorage. A demonstração usa um prefixo
 *   próprio para nunca misturar os dados fictícios com os do desenvolvimento.
 * @param {string} nomeDoCanal idem, para as abas não trocarem avisos entre si.
 * @param {string} CHAVE_SESSAO onde a sessão de mentira mora (sessionStorage:
 *   vale pela aba, como a demonstração).
 */
function backendLocal(PREFIXO = 'om_dados_', nomeDoCanal = 'om_sync', CHAVE_SESSAO = 'om_sessao_local') {
  const canal = 'BroadcastChannel' in self ? new BroadcastChannel(nomeDoCanal) : null;
  const ouvintes = new Map(); // coleção -> Set<callback>

  const ler     = (c) => { try { return JSON.parse(localStorage.getItem(PREFIXO + c)) ?? []; } catch { return []; } };
  const escrever = (c, linhas) => localStorage.setItem(PREFIXO + c, JSON.stringify(linhas));

  const avisar = (colecao, local) => {
    ouvintes.get(colecao)?.forEach(fn => fn());
    if (local) canal?.postMessage({ colecao });
  };
  canal?.addEventListener('message', (e) => avisar(e.data.colecao, false));

  const conflita = (colecao, linhas, reg, ignorarId) => {
    const campos = UNICOS[colecao];
    if (!campos) return false;
    return linhas.some(l => l.id !== ignorarId && campos.every(c => l[c] === reg[c]));
  };

  /* --- Sessão de mentira -------------------------------------------------
     Para desenvolver e apresentar. Não confere senha: aqui nada é protegido,
     e entrar só decide quem a tela mostra — LMA e ADM pelo usuário, membro
     pelo e-mail de um cadastro guardado neste navegador. */
  let sessaoLocal = null;
  try { sessaoLocal = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)); } catch {}
  const gravarSessao = (sx) => {
    sessaoLocal = sx;
    try {
      if (sx) sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(sx));
      else sessionStorage.removeItem(CHAVE_SESSAO);
    } catch {}
  };
  const perfilLocal = () =>
    (sessaoLocal && !sessaoLocal.lider ? ler('membros').find(m => m.id === sessaoLocal.id) ?? null : null);
  const LIDERES_LOCAIS = ['lma', 'adm'];

  return {
    nome: 'local',

    async iniciar() {
      // A demonstração se regenera a cada dia, com ids que levam a data: um
      // membro "logado" desde ontem nesta aba não existe mais. Sem isto ele
      // cairia em "complete seu cadastro" com um e-mail que já está em uso.
      if (sessaoLocal && !sessaoLocal.lider && !perfilLocal()) gravarSessao(null);
    },

    get sessao() { return sessaoLocal; },
    get souLider() { return Boolean(sessaoLocal?.lider); },
    get nomeLider() { return sessaoLocal?.lider ? sessaoLocal.nome : null; },
    get perfil() { return perfilLocal(); },
    get provisoria() { return false; },
    get falhaSessao() { return null; },
    get email() { return sessaoLocal?.email ?? null; },
    get metadados() { return {}; },

    async entrar(email) {
      const [usuario, dominio] = email.split('@');
      if (dominio === DOMINIO_USUARIO) {
        if (!LIDERES_LOCAIS.includes(usuario)) throw new Error(MSG_CREDENCIAIS);
        gravarSessao({ id: `lider-${usuario}`, email, lider: true, nome: usuario.toUpperCase() });
      } else {
        const m = ler('membros').find(x => x.email === email);
        if (!m) throw new Error(MSG_CREDENCIAIS);
        gravarSessao({ id: m.id, email, lider: false });
      }
      avisarSessao('SIGNED_IN');
    },

    async cadastrar(dados) {
      if (ler('membros').some(m => m.email === dados.email)) throw new Error(MSG_JA_CADASTRADO);
      const novo = await this.inserir('membros', dados);
      gravarSessao({ id: novo.id, email: dados.email, lider: false });
      avisarSessao('CADASTRADO');
    },

    async completarCadastro(dados) {
      const linha = { ...dados, id: sessaoLocal.id, email: sessaoLocal.email };
      if (perfilLocal()) await this.atualizar('membros', sessaoLocal.id, linha);
      else await this.inserir('membros', linha);
      avisarSessao('CADASTRO');
    },

    async atualizarCadastro(patch) {
      await this.atualizar('membros', sessaoLocal.id, { ...patch, atualizado_em: new Date().toISOString() });
      avisarSessao('CADASTRO');
    },

    async trocarSenha() { avisarSessao('SENHA'); },
    async redefinirSenha() {},

    async sair() {
      gravarSessao(null);
      avisarSessao('SIGNED_OUT');
    },

    async listar(colecao, filtro) {
      const linhas = ler(colecao);
      if (!filtro) return linhas;
      return linhas.filter(l => Object.entries(filtro).every(([k, v]) => l[k] === v));
    },

    async inserir(colecao, reg) {
      const linhas = ler(colecao);
      // A chave primária também é uma restrição de unicidade. Sem isto, o
      // backend local aceitaria o mesmo `id` duas vezes e a restauração de um
      // backup duplicaria tudo — o Postgres recusaria.
      if (reg.id != null && linhas.some(l => l.id === reg.id)) throw new ConflitoError();
      if (conflita(colecao, linhas, reg)) throw new ConflitoError();
      const novo = { id: uuid(), criado_em: new Date().toISOString(), ...reg };
      linhas.push(novo);
      escrever(colecao, linhas);
      avisar(colecao, true);
      return novo;
    },

    async inserirVarios(colecao, registros) {
      const linhas = ler(colecao);
      const novos = [];
      for (const reg of registros) {
        if (conflita(colecao, linhas, reg)) continue;
        const novo = { id: uuid(), criado_em: new Date().toISOString(), ...reg };
        linhas.push(novo);
        novos.push(novo);
      }
      escrever(colecao, linhas);
      avisar(colecao, true);
      return novos;
    },

    async atualizar(colecao, id, patch) {
      const linhas = ler(colecao);
      const i = linhas.findIndex(l => l.id === id);
      if (i < 0) throw new Error('Registro não encontrado.');
      const atualizado = { ...linhas[i], ...patch };
      if (conflita(colecao, linhas, atualizado, id)) throw new ConflitoError();
      linhas[i] = atualizado;
      escrever(colecao, linhas);
      avisar(colecao, true);
      return atualizado;
    },

    async gravarNaChave(colecao, reg) {
      const campos = UNICOS[colecao];
      if (!campos) return this.inserir(colecao, reg);
      const linhas = ler(colecao);
      const i = linhas.findIndex(l => campos.every(c => l[c] === reg[c]));
      if (i < 0) return this.inserir(colecao, reg);
      linhas[i] = { ...linhas[i], ...reg };
      escrever(colecao, linhas);
      avisar(colecao, true);
      return linhas[i];
    },

    async remover(colecao, id) {
      escrever(colecao, ler(colecao).filter(l => l.id !== id));
      avisar(colecao, true);
    },

    observar(colecao, cb) {
      if (!ouvintes.has(colecao)) ouvintes.set(colecao, new Set());
      ouvintes.get(colecao).add(cb);
      return () => ouvintes.get(colecao)?.delete(cb);
    },
  };
}

/* ==========================================================================
   Backend Supabase
   ========================================================================== */

/**
 * Carrega o cliente Supabase de js/vendor/supabase.js.
 *
 * Era um import de CDN em tempo de execução, e isso quebrava para quem usa
 * bloqueador de conteúdo — o Brave, por exemplo, barra o esm.sh com o escudo
 * ligado, e o app caía no modo local sem avisar. Numa ala com centenas de
 * celulares e bloqueadores variados, depender de terceiro para carregar não é
 * aceitável. O arquivo é o build UMD oficial, versionado junto com o app.
 */
async function carregarClienteSupabase() {
  if (globalThis.supabase?.createClient) return globalThis.supabase.createClient;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/supabase.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar a biblioteca do Supabase.'));
    document.head.append(s);
  });

  if (!globalThis.supabase?.createClient) {
    throw new Error('A biblioteca do Supabase carregou incompleta.');
  }
  return globalThis.supabase.createClient;
}

const MSG_CREDENCIAIS = 'E-mail ou senha incorretos.';
const MSG_JA_CADASTRADO = 'Já existe um cadastro com este e-mail. Toque em "Já tenho cadastro — entrar", logo abaixo.';

/**
 * Mensagens do GoTrue chegam em inglês e vazam vocabulário de API. Traduz as
 * que o usuário deste app realmente encontra; o resto passa como veio, para
 * não engolir informação de um caso não previsto. O código (`error.code`)
 * vem primeiro quando existe — é estável; o texto, não.
 */
function traduzirErroDeAuth(error) {
  const c = String(error?.code || '');
  const m = String(error?.message || '');
  if (c === 'invalid_credentials' || /invalid login credentials/i.test(m)) return MSG_CREDENCIAIS;
  if (c === 'user_already_exists' || /already registered/i.test(m)) return MSG_JA_CADASTRADO;
  if (c === 'email_not_confirmed' || /email not confirmed/i.test(m))
    return 'Esta conta ainda espera confirmação por e-mail no Supabase. Avise o líder de missão.';
  // "Confirm email" ligado no painel: o e-mail de confirmação não sai (o
  // servidor embutido só entrega para a equipe do projeto) e o cadastro falha.
  if (c === 'email_address_not_authorized' || /email address not authorized/i.test(m))
    return 'O cadastro está pedindo confirmação por e-mail, que não chega. Avise o líder de missão.';
  if (c === 'signup_disabled' || /signups? not allowed/i.test(m))
    return 'O cadastro de membros está desligado no momento. Avise o líder de missão.';
  if (c === 'same_password' || /should be different/i.test(m))
    return 'A senha nova precisa ser diferente da atual.';
  if (c === 'weak_password' || /password should be|weak password/i.test(m))
    return 'O servidor recusou essa senha por ser fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  if (c === 'reauthentication_needed' || /reauthenticat/i.test(m))
    return 'Por segurança, saia e entre de novo antes de trocar a senha.';
  // Mutirão de cadastro no Wi-Fi da capela: todo mundo sai pelo mesmo IP, e o
  // Supabase aceita 30 cadastros a cada 5 minutos por IP.
  if (c === 'over_request_rate_limit' || /rate limit|only request this after|too many/i.test(m))
    return 'Muitas tentativas seguidas desta rede. Espere uns minutos, ou tente pelos dados móveis.';
  // Sem rede: o Chrome diz "Failed to fetch", o Firefox "NetworkError…", o
  // Safari "Load failed". O supabase-js embrulha os três no mesmo erro.
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0 || /failed to fetch|network|load failed/i.test(m))
    return 'Não foi possível falar com o servidor. Confira a conexão.';
  return m || 'Não foi possível concluir.';
}

async function backendSupabase(url, anonKey) {
  const createClient = await carregarClienteSupabase();
  const sb = createClient(url, anonKey, {
    // Sem link mágico desde outubro de 2026: não há sessão a colher da URL.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let sessao = null;
  let lider = false;
  let nomeLider = null;
  let perfil = null;
  let provisoria = false;
  let falhaSessao = null;
  let schemaOk = true;

  const conferir = ({ data, error }) => {
    if (!error) return data;
    if (error.code === '23505') throw new ConflitoError();       // unique_violation
    if (error.code === '42501') throw new Error('Você não tem permissão para esta ação.');
    // Coluna que o app conhece e o banco ainda não: é o schema.sql que não foi
    // rodado de novo depois de uma atualização. A mensagem crua do PostgREST
    // ("Could not find the 'titulo' column…") não diz a ninguém o que fazer.
    if (error.code === 'PGRST204') {
      throw new Error('O banco precisa ser atualizado: rode o supabase/schema.sql de novo no SQL Editor.');
    }
    throw new Error(error.message);
  };

  /*
   * Quem é a pessoa da sessão: líder, membro com cadastro, ou ainda nenhum.
   *
   * Ter sessão não é ser líder — qualquer um se cadastra e ganha uma. Quem
   * autoriza é a tabela `lideres`, pela função eh_lider() no banco, a mesma
   * que as policies usam.
   *
   * `versao` descarta respostas velhas. Uma resolução disparada por evento de
   * sessão pode terminar DEPOIS de uma mudança feita aqui (o cadastro recém
   * gravado, a senha provisória recém baixada) e desfazê-la com o que leu
   * antes. Toda mudança local sobe a versão; resposta de versão velha morre.
   *
   * `uidResolvido` é de quem é o estado. Uma falha de rede ao reler a MESMA
   * pessoa não a rebaixa: tratada como "sem cadastro", ela tirava os botões do
   * LMA, ou o nome do membro, a cada renovação de token com o sinal fraco.
   */
  let versao = 0;
  let uidResolvido = null;
  /**
   * Quem já trocou a senha provisória nesta carga da página. Se a baixa em
   * `senhas_provisorias` falhou, a linha continua no banco, e a próxima
   * releitura (a aba que volta, a renovação do token) mandaria a pessoa de
   * novo para a tela de troca — onde a senha que ela acabou de escolher é
   * recusada por ser igual à atual.
   */
  let senhaTrocadaPor = null;

  const zerar = () => {
    lider = false; nomeLider = null; perfil = null; provisoria = false; falhaSessao = null;
    uidResolvido = null;
  };

  /**
   * Assume, sem reler, o estado de uma conta de membro que acabou de ganhar
   * (ou não) a linha em `membros` — o cadastro recém gravado. Conta nova não
   * é líder nem tem senha provisória.
   */
  const assumir = (uid, { perfil: linha = null } = {}) => {
    versao++;
    lider = false; nomeLider = null; provisoria = false; falhaSessao = null;
    perfil = linha;
    uidResolvido = uid;
  };

  /** @returns {Promise<boolean>} false quando a resposta chegou velha e foi descartada */
  async function resolverSessao() {
    const v = versao;
    const uid = sessao?.user?.id;
    if (!uid) { zerar(); return true; }
    const [l, m, p] = await Promise.all([
      sb.rpc('eh_lider'),
      sb.from('membros').select('*').eq('id', uid).maybeSingle(),
      sb.from('senhas_provisorias').select('id').eq('id', uid).maybeSingle(),
    ]);
    let nome = null;
    if (!l.error && l.data === true) {
      const r = await sb.from('lideres').select('nome').eq('usuario_id', uid).maybeSingle();
      nome = r.data?.nome || 'LMA';
    }
    if (v !== versao || sessao?.user?.id !== uid) return false;

    const erro = l.error?.message || m.error?.message || p.error?.message || null;
    // Já se sabia quem é: fica o que se sabia (ver `uidResolvido`, acima).
    if (erro && uidResolvido === uid) return true;
    // Sem nada sabido, a falha vira a tela de "não foi possível carregar" —
    // e NÃO "complete seu cadastro", que mandaria um membro com o sinal fraco
    // preencher tudo de novo.
    falhaSessao = erro;
    lider = !l.error && l.data === true;
    nomeLider = nome;
    perfil = m.data ?? null;
    provisoria = Boolean(p.data) && senhaTrocadaPor !== uid;
    uidResolvido = erro ? null : uid;
    return true;
  }

  /*
   * Avisos de sessão.
   *
   * O callback do onAuthStateChange não chama o cliente direto: a própria
   * documentação do supabase-js avisa que usar outro método dele ali dentro
   * pode travar no lock do auth. A resolução sai do callback por setTimeout e
   * entra numa fila, para dois eventos seguidos não se atropelarem.
   *
   * `silenciar` cala os eventos que nascem no meio de uma operação daqui —
   * cadastro, troca de senha, saída —, que avisa por conta própria quando
   * termina. É lido no instante do evento, não quando a resolução acaba: lido
   * depois, o SIGNED_IN do signUp escapava se o cadastro terminasse primeiro,
   * e a tela piscava "complete seu cadastro" ou dava boas-vindas duas vezes.
   */
  let fila = Promise.resolve();
  let silenciar = 0;
  const enfileirar = (fn) => (fila = fila.then(fn).catch(err => console.error('[db] sessão:', err)));

  /*
   * Quem a casca acredita estar logado — o último uid anunciado.
   *
   * O anúncio sai da TROCA DE PESSOA, não do nome do evento do GoTrue. Pelo
   * nome, uma sessão que voltava por TOKEN_REFRESHED (aberta sem sinal, o
   * refresh falha e getSession devolve null; o sinal volta e o token renova)
   * ficava invisível: a tela seguia em "entrar", e o login da pessoa, já com a
   * mesma sessão por baixo, virava "renovação" — presa na tela de entrada.
   */
  let uidAnunciado = null;
  /**
   * Quem tocou em Sair sem conseguir falar com o servidor. A renovação de
   * token que estava no ar pode terminar depois — a rede voltou — e gravar a
   * sessão de novo: num celular emprestado, a pessoa voltaria a estar logada.
   * Sessão desse uid que reaparecer nesta carga é descartada.
   */
  let saidaForcada = null;
  const anunciar = (evento) => {
    uidAnunciado = sessao?.user?.id ?? null;
    avisarSessao(evento);
  };

  return {
    nome: 'supabase',
    sb,

    async iniciar() {
      // Sonda a tabela mais nova: sem o schema.sql desta versão aplicado, o
      // PostgREST responde PGRST205 e o app mostra o que fazer, em vez de cada
      // tela quebrar com um erro incompreensível.
      //
      // Em paralelo com a sessão, que não depende dela. Em série eram duas
      // idas ao servidor enfileiradas antes da primeira tela aparecer.
      const [sonda, resposta] = await Promise.all([
        sb.from('membros').select('id').limit(1),
        sb.auth.getSession(),
      ]);
      schemaOk = !(sonda.error && sonda.error.code === 'PGRST205');

      sessao = resposta.data.session;
      await resolverSessao();
      uidAnunciado = sessao?.user?.id ?? null;
      sb.auth.onAuthStateChange((evento, s) => {
        if (s && saidaForcada && s.user?.id === saidaForcada) {
          setTimeout(() => sb.auth.signOut({ scope: 'local' }).catch(() => {}), 0);
          return;
        }
        sessao = s;
        const calado = silenciar > 0;
        setTimeout(() => enfileirar(async () => {
          const valeu = await resolverSessao();
          if (!valeu || calado) return;
          const uid = sessao?.user?.id ?? null;
          // Pessoa nova (ou nenhuma): é entrada ou saída, chame-se o evento
          // como se chamar. Mesma pessoa: o supabase-js repete SIGNED_IN toda
          // vez que a aba volta a ficar visível — anunciado como login,
          // mandava todo mundo ao Início, com o formulário a meio perdido, e
          // repetia o "Olá". Vira renovação, que a casca ignora.
          // SIGNED_OUT de quem já saiu (o signOut que terminou depois da saída
          // local) também é silêncio: repintar apagaria o que a pessoa já
          // começou a digitar na tela de entrada.
          const anuncio = uid !== uidAnunciado ? (uid ? 'SIGNED_IN' : 'SIGNED_OUT')
            : (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') ? 'SESSAO_RENOVADA'
            : evento;
          anunciar(anuncio);
        }), 0);
      });
    },

    get sessao() { return sessao; },
    get souLider() { return lider; },
    get nomeLider() { return nomeLider; },
    get perfil() { return perfil; },
    get provisoria() { return provisoria; },
    get falhaSessao() { return falhaSessao; },
    get email() { return sessao?.user?.email ?? null; },
    /** Cópia do cadastro guardada no próprio usuário do Auth, no signUp. */
    get metadados() { return sessao?.user?.user_metadata ?? {}; },
    get schemaOk() { return schemaOk; },

    async entrar(email, senha) {
      saidaForcada = null;
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error(traduzirErroDeAuth(error));
    },

    async cadastrar(dados, senha) {
      saidaForcada = null;
      silenciar++;
      let conta = null;
      try {
        const { data, error } = await sb.auth.signUp({
          email: dados.email,
          password: senha,
          // Cópia no usuário do Auth: se gravar em `membros` falhar logo
          // abaixo, o "complete seu cadastro" do próximo login sai preenchido.
          options: {
            data: {
              nome_completo: dados.nome_completo, apelido: dados.apelido,
              telefone: dados.telefone, whatsapp: dados.whatsapp,
            },
          },
        });
        if (error) throw new Error(traduzirErroDeAuth(error));
        // "Confirm email" ligado: a conta nasce sem sessão. Hoje o servidor
        // embutido nem chega aqui (falha antes, ao mandar o e-mail), mas um
        // SMTP próprio mudaria isso.
        if (!data.session) {
          throw new Error('Cadastro recebido, mas o servidor pediu confirmação por e-mail. Avise o líder de missão.');
        }
        conta = data;
        sessao = data.session;
        // A linha gravada é o estado: reler logo depois arriscava uma
        // resposta velha, ou uma falha de rede, desfazendo o cadastro na tela.
        const r = await sb.from('membros').insert({ id: data.user.id, ...dados }).select().single();
        assumir(data.user.id, { perfil: r.error ? null : r.data });
        conferir(r);
      } finally {
        silenciar--;
        // Evento próprio: a tela de cadastro dá as boas-vindas; um SIGNED_IN
        // faria a casca dar outras por cima. Sem a linha gravada, a casca
        // mostra "complete seu cadastro", com os dados guardados na conta.
        if (conta) anunciar('CADASTRADO');
      }
    },

    async completarCadastro(dados) {
      // Upsert, não insert: esta tela existe para a resposta do cadastro que
      // se perdeu — e às vezes a linha CHEGOU ao banco. Com insert, cada
      // tentativa batia na chave primária e mostrava o aviso de "horário
      // preenchido por outra pessoa", sem saída.
      const r = await sb.from('membros')
        .upsert({ ...dados, id: sessao.user.id, email: sessao.user.email }, { onConflict: 'id' })
        .select().single();
      // A conta foi apagada no painel (o bloco A do schema.sql, por exemplo)
      // com o token ainda válido: a chave estrangeira para auth.users recusa.
      if (r.error?.code === '23503') {
        throw new Error('Esta conta não existe mais. Toque em "Sair" e faça um cadastro novo.');
      }
      assumir(sessao.user.id, { perfil: conferir(r) });
      anunciar('CADASTRO');
    },

    async atualizarCadastro(patch) {
      const linhas = conferir(await sb.from('membros')
        .update({ ...patch, atualizado_em: new Date().toISOString() })
        .eq('id', sessao.user.id).select());
      if (!linhas?.length) throw new Error('Não foi possível salvar o cadastro.');
      versao++;
      perfil = linhas[0];
      anunciar('CADASTRO');
    },

    async trocarSenha(nova) {
      silenciar++;
      try {
        const { error } = await sb.auth.updateUser({ password: nova });
        if (error) throw new Error(traduzirErroDeAuth(error));
        if (provisoria) {
          const r = await sb.from('senhas_provisorias').delete().eq('id', sessao.user.id);
          // A senha JÁ trocou. Prender a pessoa na tela de troca agora, porque
          // a baixa falhou, a faria inventar uma terceira senha — a segunda o
          // servidor recusa por ser igual à atual. Libera nesta sessão; o
          // próximo login pede outra troca.
          if (r.error) console.warn('[db] senha provisória sem baixa:', r.error.message);
        }
        versao++;
        provisoria = false;
        senhaTrocadaPor = sessao.user.id;
      } finally {
        silenciar--;
      }
      anunciar('SENHA');
    },

    async redefinirSenha(id, senha) {
      conferir(await sb.rpc('redefinir_senha_de_membro', { p_membro: id, p_senha: senha }));
    },

    async sair() {
      silenciar++;
      try {
        // Sem rede e com o token vencido, o signOut do supabase-js espera a
        // renovação do token — com novas tentativas, até uns 25 s — e então
        // desiste ANTES de apagar a sessão guardada. A pessoa tocou em Sair:
        // sai deste aparelho em poucos segundos, com ou sem servidor. Num
        // celular emprestado, a conta não pode continuar aberta.
        const LIMITE = Symbol('limite');
        const r = await Promise.race([
          sb.auth.signOut().catch(err => ({ error: err })),
          new Promise(ok => setTimeout(() => ok(LIMITE), 4000)),
        ]);
        if (r === LIMITE || r?.error) {
          saidaForcada = sessao?.user?.id ?? null;
          try { sb.auth.stopAutoRefresh(); } catch {}
          for (const k of ['', '-user', '-code-verifier']) {
            try { localStorage.removeItem(sb.auth.storageKey + k); } catch {}
          }
        }
      } finally {
        silenciar--;
      }
      sessao = null;
      versao++;
      zerar();
      anunciar('SIGNED_OUT');
    },

    async listar(colecao, filtro) {
      let q = sb.from(colecao).select('*');
      for (const [k, v] of Object.entries(filtro || {})) q = q.eq(k, v);
      return conferir(await q) ?? [];
    },

    async inserir(colecao, reg) {
      return conferir(await sb.from(colecao).insert(reg).select().single());
    },

    /**
     * Grava um lote deixando passar o que já existe.
     *
     * Vira ON CONFLICT DO NOTHING, que exige apenas permissão de INSERT — o
     * membro reenvia o formulário de disponibilidade sem tomar erro, mesmo
     * sem poder ler nem atualizar o que já gravou.
     *
     * Sem `.select()` de propósito: pedir as linhas de volta exigiria também
     * permissão de leitura, e numa tabela com telefone o anônimo não tem.
     *
     * Sem upsert também: resolver ON CONFLICT exige ler as linhas em conflito,
     * o que o anônimo não pode. Coleções que aceitam lote não têm constraint
     * de unicidade; a duplicata é tratada na leitura.
     */
    async inserirVarios(colecao, registros) {
      if (!registros.length) return [];
      conferir(await sb.from(colecao).insert(registros));
      return registros;
    },

    /**
     * Grava pela chave única, numa operação só.
     *
     * Existe para não decidir no cliente entre inserir e atualizar: entre a
     * leitura e a gravação cabe uma ida ao banco, e dois campos preenchidos em
     * sequência rápida numa linha ainda inexistente disparavam dois INSERT —
     * o segundo morria com 23505 e o valor digitado se perdia.
     *
     * Vira ON CONFLICT DO UPDATE apenas nas colunas enviadas, então gravar um
     * campo não apaga os outros da mesma linha.
     *
     * Exige que a carga traga toda coluna NOT NULL que não tenha default: o
     * Postgres monta a linha proposta e valida as restrições ANTES de resolver
     * o conflito, então omitir uma dessas colunas falha mesmo quando a linha
     * já existe e o caminho seria de update. Vale para relatorio_semanal e
     * frequencia_ala, onde tudo fora da chave tem default 0.
     */
    async gravarNaChave(colecao, reg) {
      const campos = UNICOS[colecao];
      if (!campos) return this.inserir(colecao, reg);
      return conferir(await sb.from(colecao)
        .upsert(reg, { onConflict: campos.join(',') })
        .select().single());
    },

    async atualizar(colecao, id, patch) {
      const resp = await sb.from(colecao).update(patch).eq('id', id).select();
      const linhas = conferir(resp);
      // Sem permissão, o RLS não gera erro: ele simplesmente não deixa nenhuma
      // linha visível para atualizar. Zero linhas afetadas é negativa, não sucesso.
      if (!linhas?.length) throw new Error('Sem permissão para alterar este registro.');
      return linhas[0];
    },

    async remover(colecao, id) {
      // Mesmo caso: `delete` sem permissão volta 200 apagando nada. Pedir o
      // retorno é o que separa "apagou" de "não pôde apagar".
      const linhas = conferir(await sb.from(colecao).delete().eq('id', id).select());
      if (!linhas?.length) throw new Error('Sem permissão para excluir este registro.');
    },

    observar(colecao, cb) {
      const canal = sb
        .channel(`rt_${colecao}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: colecao }, cb)
        .subscribe();
      return () => sb.removeChannel(canal);
    },
  };
}

/* ==========================================================================
   Interface pública
   ========================================================================== */

/** Máquina de desenvolvimento, onde o modo local é aceitável. */
const ehDesenvolvimento = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
  location.protocol === 'file:';

let semConfiguracao = false;
let falhaAoConectar = null;

/* ---------------------------------------------------------------------------
   Modo demonstração — `?demo` na URL

   Para apresentar o app sem expor a ala. Os dados são fictícios (js/demo.js),
   moram só no localStorage deste navegador, com prefixo próprio, e o Supabase
   nem chega a ser carregado: o desvio acontece aqui, antes de qualquer
   conexão. Não há caminho por onde um dado da demonstração chegue ao banco,
   nem por onde um dado do banco apareça na demonstração.

   O que liga o modo é a URL; o que o mantém é o sessionStorage, que morre com
   a aba. Fechar a aba encerra a demonstração, e quem abrir o endereço normal
   depois cai no app de verdade.

   Os dados valem pelo dia em que foram gerados, porque as datas saem de hoje:
   uma carga de semanas atrás abriria os calendários vazios. Dentro do mesmo
   dia eles são preservados — recarregar a página, abrir a demonstração numa
   segunda aba ou sair dela em uma das abas não desfaz o que já foi mexido.
   Só "Recomeçar dados" regenera, e a virada do dia.

   Quando uma aba regenera, as outras se recarregam sozinhas (ver
   vigiarOutrasAbas). Uma aba que continuasse mostrando a carga anterior
   agiria sobre registros que não existem mais.
--------------------------------------------------------------------------- */

const PREFIXO_DEMO = 'om_demo_';
/** Sessão da demonstração. Fora do prefixo: "Recomeçar dados" não desloga ninguém. */
const SESSAO_DEMO = 'om_demo:sessao';
const MARCA_SEMEADO = PREFIXO_DEMO + '_semeado';
/**
 * Sobe quando js/demo.js muda de forma: a marca guardada deixa de bater e o
 * navegador regenera em vez de mostrar dados no formato antigo.
 */
const VERSAO_DEMO = 4;
const marcaDeHoje = () => `${VERSAO_DEMO}|${hoje()}`;
let demo = false;

function apagarDadosDaDemonstracao() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(PREFIXO_DEMO)) localStorage.removeItem(k);
  }
}

/**
 * Grava cada coleção INTEIRA, com ids fixos — nunca acrescenta.
 *
 * Escreve direto no localStorage, no mesmo formato que o backendLocal lê
 * (prefixo + nome da coleção), porque o backend só sabe acrescentar. E
 * acrescentar era o defeito: duas abas semeando ao mesmo tempo somavam duas
 * cargas, e com as áreas em dobro todo total da ala saía em dobro. Como
 * gerar() é determinística, duas escritas simultâneas gravam o mesmo
 * conteúdo, e a que chegar por último não muda nada.
 *
 * O dia entra no id. O conteúdo de cada posição muda de um dia para o outro
 * (as datas saem de hoje), e com o id só pela posição uma aba esquecida aberta
 * desde ontem apagava, num "Liberar a vaga", a reserva de outro dia que
 * herdara aquele id — com aviso de sucesso. Com o dia no id, o registro velho
 * simplesmente não é encontrado.
 */
async function semearDemonstracao() {
  // Tudo que pode falhar vem ANTES de apagar: o import de demo.js vai à rede
  // (ou ao cache do service worker) e pode não voltar. Apagando primeiro, uma
  // falha aqui deixava a demonstração vazia em vez de intacta.
  const { gerar } = await import('./demo.js');
  const agora = new Date().toISOString();
  const dia = hoje();
  const carga = Object.entries(gerar()).map(([colecao, linhas]) =>
    [colecao, linhas.map((l, i) => ({ id: `demo-${dia}-${colecao}-${i}`, criado_em: agora, ...l }))]);

  // Daqui para baixo é síncrono: apaga e reescreve sem ninguém no meio.
  apagarDadosDaDemonstracao();
  for (const [colecao, linhas] of carga) {
    localStorage.setItem(PREFIXO_DEMO + colecao, JSON.stringify(linhas));
  }
  localStorage.setItem(MARCA_SEMEADO, marcaDeHoje());
}

/**
 * Recarrega esta aba quando outra regenera a demonstração.
 *
 * O evento `storage` só chega às OUTRAS abas, nunca à que escreveu. Reage à
 * marca recém-gravada, e não à remoção que vem antes dela: recarregar no meio
 * da escrita da outra aba só faria esta semear também.
 */
function vigiarOutrasAbas() {
  addEventListener('storage', (e) => {
    if (e.key === MARCA_SEMEADO && e.newValue) location.reload();
  });
}

/** Liga a demonstração se a URL pedir. Devolve se ela está ativa nesta aba. */
function ligarDemonstracaoSePedida() {
  // A apresentação começa na tela de entrada, como para qualquer pessoa: o
  // cadastro é parte do que se mostra. A própria tela oferece entrar como LMA
  // ou como um membro de exemplo com um toque.
  if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem('om_demo', '1');
  return sessionStorage.getItem('om_demo') === '1';
}

export const emDemonstracao = () => demo;

/**
 * O que o selo de conexão das agendas deve dizer.
 *
 * Na demonstração o backend é o local, e o selo antigo dizia "Offline" — em
 * vermelho, na frente de uma plateia, parecendo defeito.
 * @returns {'live'|'off'|'demo'}
 */
export const estadoDaConexao = () => (demo ? 'demo' : ehSupabase ? 'live' : 'off');

/** Descarta o que foi mexido durante a apresentação e gera tudo de novo. */
export async function recomecarDemonstracao() {
  if (!demo) return;
  await semearDemonstracao();
}

/**
 * Sai da demonstração NESTA aba.
 *
 * Não apaga os dados: o modo vale por aba, mas os dados são de todas, e
 * apagar aqui deixava vazia outra aba que continuasse apresentando. Eles são
 * fictícios, só são lidos dentro da demonstração e expiram com o dia.
 */
export function sairDaDemonstracao() {
  sessionStorage.removeItem('om_demo');
  sessionStorage.removeItem(SESSAO_DEMO);
  demo = false;
}

export async function iniciar() {
  demo = ligarDemonstracaoSePedida();
  if (demo) {
    backend = backendLocal(PREFIXO_DEMO, 'om_demo_sync', SESSAO_DEMO);
    // Mesma proteção do ramo normal, logo abaixo: se a semeadura lança — o
    // import de demo.js falhando num celular sem sinal, por exemplo —, o app
    // não pode ficar girando em "Carregando…" para sempre. Cai na tela de sem
    // conexão, que tem o botão de tentar de novo.
    try {
      if (localStorage.getItem(MARCA_SEMEADO) !== marcaDeHoje()) await semearDemonstracao();
    } catch (err) {
      falhaAoConectar = `Não foi possível montar a demonstração: ${err?.message || err}`;
      console.error('[db] falha ao semear a demonstração:', err);
    }
    // Depois de semear: ele confere a sessão da aba contra os membros do dia.
    await backend.iniciar();
    vigiarOutrasAbas();
    return backend.nome;
  }

  let cfg = null;
  try {
    cfg = await import('./supabase-config.js');
  } catch {
    // Sem arquivo de configuração: é o caso de "ainda não configurado".
  }

  if (cfg?.URL && cfg?.ANON_KEY) {
    try {
      backend = await backendSupabase(cfg.URL, cfg.ANON_KEY);
      ehSupabase = true;
    } catch (err) {
      // Distinguir isto de "sem configuração" é o ponto: aqui as credenciais
      // EXISTEM e mesmo assim não deu para conectar — biblioteca bloqueada por
      // um escudo de navegador, rede fora, projeto pausado. Cair no localStorage
      // calado faria cada pessoa ter um calendário particular sem perceber.
      falhaAoConectar = err?.message || 'Falha ao conectar no banco de dados.';
      console.error('[db] Supabase indisponível:', err);
    }
  } else {
    // Num site publicado, faltar configuração é erro; em desenvolvimento, não.
    semConfiguracao = !ehDesenvolvimento();
  }

  backend ??= backendLocal();

  // A partida do backend não pode derrubar a partida do app. Se ela lança, o
  // `await db.iniciar()` lá no app.js nunca retorna e a tela fica girando para
  // sempre — antes do indicador de carregamento isso era uma faixa em branco
  // eterna, igualmente sem saída. A tela de "sem conexão" existe justamente
  // para este caso, e traz o botão de tentar de novo.
  try {
    await backend.iniciar();
  } catch (err) {
    falhaAoConectar = err?.message || 'Falha ao iniciar o banco de dados.';
    console.error('[db] falha ao iniciar o backend:', err);
  }
  return backend.nome;
}

/** true quando o app está publicado mas sem credenciais do Supabase. */
export const faltaConfiguracao = () => semConfiguracao;

/** Mensagem quando há credenciais mas a conexão falhou. `null` se está tudo bem. */
export const erroDeConexao = () => falhaAoConectar;

/** false quando o Supabase responde mas supabase/schema.sql ainda não rodou. */
export const schemaPronto = () => !ehSupabase || backend.schemaOk;

/* ---------------------------------------------------------------------------
   Sessão

   Ninguém usa o app sem entrar. Os estados, na ordem em que a casca confere:
     sem sessão           → tela de entrada (login e cadastro)
     senha provisória     → trocar a senha antes de qualquer coisa
     sessão sem cadastro  → completar o cadastro (o signUp que não gravou)
     líder ou membro      → o app
--------------------------------------------------------------------------- */

export const sessaoAtiva = () => Boolean(backend?.sessao);

/**
 * Só é admin quem está na tabela `lideres`. Uma sessão qualquer não basta —
 * e mesmo que a interface se enganasse, o RLS negaria tudo do mesmo jeito.
 */
export const ehAdmin = () => Boolean(backend?.souLider);

/** O cadastro da pessoa logada — `null` para líder e para quem ainda não tem. */
export const meuCadastro = () => backend?.perfil ?? null;

/** Não deu para saber quem é a pessoa (rede). Mensagem, ou `null`. */
export const falhaDeSessao = () => backend?.falhaSessao ?? null;

export const precisaTrocarSenha = () => sessaoAtiva() && Boolean(backend.provisoria);

/**
 * Conta do domínio do app (lma@, adm@...) que não está na lista de líderes:
 * criada no painel, mas o passo final do schema.sql não rodou. Ela não é de
 * membro — o banco recusa cadastro nesse domínio —, então "complete seu
 * cadastro" só terminaria num erro.
 */
export const liderSemVinculo = () =>
  sessaoAtiva() && !ehAdmin() && !falhaDeSessao()
  && String(emailDaSessao() ?? '').endsWith(`@${DOMINIO_USUARIO}`);

export const faltaCadastro = () =>
  sessaoAtiva() && !ehAdmin() && !meuCadastro() && !falhaDeSessao() && !liderSemVinculo();

/** Como a pessoa aparece no cabeçalho e nos calendários. */
export const nomeNaSessao = () => (ehAdmin() ? backend.nomeLider : meuCadastro()?.apelido ?? '');

export const emailDaSessao = () => backend?.email ?? null;

/** O que o signUp guardou no usuário do Auth, para preencher "complete seu cadastro". */
export const cadastroGuardadoNaConta = () => backend?.metadados ?? {};

/** Login local (desenvolvimento e demonstração): não há senha a conferir. */
export const senhaDeMentira = () => !ehSupabase;

/**
 * Completa um nome de usuário com o domínio do app.
 *
 * O Supabase Auth só entende e-mail. `LMA` vira `lma@isudapp.netlify.app`,
 * o endereço com que a conta foi criada no painel. Quem digitar um e-mail de
 * verdade passa intacto.
 */
export function usuarioParaEmail(entrada) {
  const v = String(entrada || '').trim().toLowerCase();
  if (!v) throw new Error('Digite o seu e-mail.');
  if (v.includes('@')) {
    if (!/^\S+@\S+\.\S+$/.test(v)) throw new Error('E-mail inválido.');
    return v;
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,30}$/.test(v)) throw new Error('E-mail inválido.');
  return `${v}@${DOMINIO_USUARIO}`;
}

const SENHA_MIN = 8;

/** Senha nova: tamanho, e a repetição batendo. Sem recuperação por e-mail, um erro de digitação trancaria a pessoa. */
function conferirSenhaNova(senha, repetida) {
  const v = String(senha || '');
  if (v.length < SENHA_MIN) throw new Error(`A senha precisa de pelo menos ${SENHA_MIN} caracteres.`);
  if (v.length > 72) throw new Error('A senha pode ter no máximo 72 caracteres.');
  if (v !== String(repetida || '')) throw new Error('As duas senhas não estão iguais.');
  return v;
}

/**
 * Limpa e valida o cadastro. Devolve só os campos da tabela `membros`.
 * @param {{nome_completo?: string, apelido?: string, email?: string, telefone?: string, whatsapp?: boolean}} d
 * @param {{comEmail?: boolean}} [o] o e-mail fica de fora quando já vem da conta
 */
export function normalizarCadastro(d, { comEmail = true } = {}) {
  const limpo = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
  const nome_completo = limpo(d.nome_completo);
  const apelido = limpo(d.apelido);
  const telefone = limpo(d.telefone);
  const digitos = telefone.replace(/\D/g, '');

  if (nome_completo.split(' ').length < 2 || nome_completo.length < 5) {
    throw new Error('Digite o seu nome completo, com sobrenome.');
  }
  if (nome_completo.length > 120) throw new Error('O nome completo pode ter no máximo 120 caracteres.');
  if (apelido.length < 2) throw new Error('Diga como quer ser chamado.');
  if (apelido.length > 40) throw new Error('"Como quer ser chamado" pode ter no máximo 40 caracteres.');

  // Na ordem dos campos na tela: o e-mail vem antes do telefone. Conferido
  // depois, um e-mail errado aparecia como erro de telefone.
  const email = String(d.email ?? '').trim().toLowerCase();
  if (comEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Digite um e-mail válido.');
    // O domínio do app é das contas de líder. O banco recusa também.
    if (email.endsWith(`@${DOMINIO_USUARIO}`)) throw new Error('Use o seu e-mail pessoal.');
  }

  if (digitos.length < 10 || digitos.length > 13) {
    throw new Error('Digite o telefone com DDD, por exemplo (63) 99999-9999.');
  }

  const r = { nome_completo, apelido, telefone, whatsapp: Boolean(d.whatsapp) };
  return comEmail ? { ...r, email } : r;
}

export async function entrar(usuario, senha) {
  const email = usuarioParaEmail(usuario);
  if (!senha) throw new Error('Digite a senha.');
  return backend.entrar(email, senha);
}

export async function cadastrar(dados, senha, repetida) {
  const d = normalizarCadastro(dados);
  return backend.cadastrar(d, conferirSenhaNova(senha, repetida));
}

export async function completarCadastro(dados) {
  return backend.completarCadastro(normalizarCadastro(dados, { comEmail: false }));
}

export async function atualizarMeuCadastro(dados) {
  return backend.atualizarCadastro(normalizarCadastro(dados, { comEmail: false }));
}

export async function trocarSenha(nova, repetida) {
  return backend.trocarSenha(conferirSenhaNova(nova, repetida));
}

/**
 * Senha provisória para o membro que esqueceu a sua. Só o LMA; quem garante
 * é a função no banco, que confere eh_lider() e recusa conta de líder.
 */
export async function redefinirSenhaDeMembro(id, senha) {
  if (!ehAdmin()) throw new Error('Só o líder de missão gera senha provisória.');
  return backend.redefinirSenha(id, senha);
}

export async function sair() {
  await backend.sair();
}

export const listar        = (c, f)  => backend.listar(c, f);
export const inserir       = (c, r)  => backend.inserir(c, r);
export const inserirVarios = (c, rs) => backend.inserirVarios(c, rs);

/** Insere ou atualiza pela chave única, atomicamente. */
export const gravarNaChave = (c, r) => backend.gravarNaChave(c, r);
export const atualizar = (c, i, p) => backend.atualizar(c, i, p);
export const remover   = (c, i)    => backend.remover(c, i);
export const observar  = (c, cb)   => backend.observar(c, cb);

/**
 * Grava só se ainda estiver livre.
 *
 * A garantia contra dois membros escolherem o mesmo dia ao mesmo tempo vem da
 * constraint UNIQUE no banco, não desta verificação: o segundo INSERT
 * simultâneo falha com 23505 e vira ConflitoError. Conferir antes apenas
 * melhora a mensagem no caso comum.
 */
export async function reservar(colecao, registro) {
  const campos = UNICOS[colecao];
  if (campos) {
    const filtro = Object.fromEntries(campos.map(c => [c, registro[c]]));
    if ((await listar(colecao, filtro)).length) throw new ConflitoError();
  }
  return inserir(colecao, registro);
}
