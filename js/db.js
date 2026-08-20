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
 *    desenvolver e conferir layout antes do backend existir. Não protege nada.
 *
 * Para ligar o Supabase, crie `js/supabase-config.js` (fora do Git):
 *
 *     export const URL = 'https://xxxx.supabase.co';
 *     export const ANON_KEY = 'eyJ...';
 */

import { DOMINIO_USUARIO } from './config.js';
import { uuid } from './util.js';

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
};

let backend = null;
let ehSupabase = false;
let previa = false;

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

function backendLocal() {
  const PREFIXO = 'om_dados_';
  const canal = 'BroadcastChannel' in self ? new BroadcastChannel('om_sync') : null;
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

  return {
    nome: 'local',

    async iniciar() {},

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

/**
 * Mensagens do GoTrue chegam em inglês e vazam vocabulário de API. Traduz as
 * que o usuário deste app realmente encontra; o resto passa como veio, para
 * não engolir informação de um caso não previsto.
 */
function traduzirErroDeAuth(error) {
  const m = String(error?.message || '');
  if (/invalid login credentials/i.test(m))  return 'Usuário ou senha incorretos.';
  if (/email not confirmed/i.test(m))        return 'Esta conta ainda não foi confirmada no Supabase.';
  if (/token has expired|invalid.*token|otp.*expired/i.test(m))
    return 'Código expirado ou incorreto. Peça um novo.';
  if (/rate limit|only request this after/i.test(m))
    return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  if (/signups? not allowed|not allowed for otp/i.test(m))
    return 'Este e-mail ainda não tem conta. Peça ao dono para liberar o acesso.';
  if (/failed to fetch|network/i.test(m))
    return 'Não foi possível falar com o servidor. Confira a conexão.';
  return m || 'Não foi possível entrar.';
}

async function backendSupabase(url, anonKey) {
  const createClient = await carregarClienteSupabase();
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let sessao = null;
  let lider = false;
  let dono = false;
  let schemaOk = true;

  const conferir = ({ data, error }) => {
    if (!error) return data;
    if (error.code === '23505') throw new ConflitoError();       // unique_violation
    if (error.code === '42501') throw new Error('Você não tem permissão para esta ação.');
    throw new Error(error.message);
  };

  /**
   * Ter sessão não é ser líder.
   *
   * Qualquer pessoa consegue pedir um código para o próprio e-mail e receber
   * uma sessão válida. Quem autoriza é a tabela `lideres`, consultada pela
   * função eh_lider() no banco — a mesma que as policies usam.
   */
  async function resolverLider() {
    if (!sessao) return (lider = dono = false);
    const [ehLider, ehDono] = await Promise.all([sb.rpc('eh_lider'), sb.rpc('eh_dono')]);
    lider = !ehLider.error && ehLider.data === true;
    // eh_dono() é nova: num banco onde o schema.sql ainda não rodou de novo, a
    // função não existe e o erro só significa "não é dono", não "quebrou".
    dono = lider && !ehDono.error && ehDono.data === true;
    return lider;
  }

  return {
    nome: 'supabase',
    sb,

    async iniciar() {
      // Sonda uma tabela conhecida: sem o schema.sql aplicado, o PostgREST
      // responde PGRST205 e todo módulo quebraria com erro incompreensível.
      const sonda = await sb.from('areas').select('id').limit(1);
      schemaOk = !(sonda.error && sonda.error.code === 'PGRST205');

      sessao = (await sb.auth.getSession()).data.session;
      await resolverLider();
      sb.auth.onAuthStateChange(async (evento, s) => {
        sessao = s;
        await resolverLider();
        avisarSessao(evento);
      });
    },

    get sessao() { return sessao; },
    get souLider() { return lider; },
    get souDono() { return dono; },
    get email() { return sessao?.user?.email ?? null; },
    get schemaOk() { return schemaOk; },

    /** Conta com senha — a do dono. A sessão nasce neste aparelho. */
    async entrarComSenha(email, senha) {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error(traduzirErroDeAuth(error));
    },

    async pedirCodigo(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin },
      });
      if (error) throw new Error(traduzirErroDeAuth(error));
    },

    async conferirCodigo(email, codigo) {
      const { error } = await sb.auth.verifyOtp({ email, token: codigo, type: 'email' });
      if (error) throw new Error(traduzirErroDeAuth(error));
    },

    async sair() { await sb.auth.signOut(); sessao = null; lider = dono = false; },

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

export async function iniciar() {
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
  await backend.iniciar();
  return backend.nome;
}

export const temBackend = () => ehSupabase;

/** true quando o app está publicado mas sem credenciais do Supabase. */
export const faltaConfiguracao = () => semConfiguracao;

/** Mensagem quando há credenciais mas a conexão falhou. `null` se está tudo bem. */
export const erroDeConexao = () => falhaAoConectar;

/** false quando o Supabase responde mas supabase/schema.sql ainda não rodou. */
export const schemaPronto = () => !ehSupabase || backend.schemaOk;

/**
 * Só é admin quem está na tabela `lideres`. Uma sessão qualquer não basta —
 * e mesmo que a interface se enganasse, o RLS negaria tudo do mesmo jeito.
 */
export function ehAdmin() {
  if (ehSupabase) return backend.souLider;
  return previa || sessionStorage.getItem('om_previa') === '1';
}

/** Tem sessão mas não está na lista de líderes. */
export const sessaoSemPermissao = () =>
  ehSupabase && Boolean(backend.sessao) && !backend.souLider;

/**
 * Só o dono concede e revoga acesso — quem entrou por código no e-mail não.
 * O app apenas esconde os botões; quem recusa de verdade são as policies de
 * `lideres`, que exigem eh_dono().
 */
export const souDono = () => ehSupabase && backend.souDono;

/** E-mail da sessão, para a tela de Acesso marcar "é você". */
export const emailDaSessao = () => (ehSupabase ? backend.email : null);

export function entrarEmPrevia() {
  previa = true;
  sessionStorage.setItem('om_previa', '1');
}

/**
 * Completa um nome de usuário com o domínio do app.
 *
 * O Supabase Auth só entende e-mail. `LeoADM` vira
 * `leoadm@isudapp.netlify.app`, que é o endereço com que a conta do dono foi
 * criada no painel. Quem digitar um e-mail de verdade passa intacto.
 */
export function usuarioParaEmail(entrada) {
  const v = String(entrada || '').trim().toLowerCase();
  if (!v) throw new Error('Digite o usuário ou o e-mail.');
  if (v.includes('@')) {
    if (!/^\S+@\S+\.\S+$/.test(v)) throw new Error('E-mail inválido.');
    return v;
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,30}$/.test(v)) {
    throw new Error('Usuário inválido. Use letras, números, ponto, hífen ou sublinhado.');
  }
  return `${v}@${DOMINIO_USUARIO}`;
}

const exigirSupabase = () => {
  if (!ehSupabase) throw new Error('Backend não configurado.');
};

/** Login do dono: usuário (ou e-mail) e senha, sem sair deste aparelho. */
export async function entrarComSenha(usuario, senha) {
  exigirSupabase();
  if (!senha) throw new Error('Digite a senha.');
  return backend.entrarComSenha(usuarioParaEmail(usuario), senha);
}

/**
 * Manda um e-mail com link E código de 6 dígitos.
 *
 * O código existe por causa de um problema real: quem pedia o link no
 * computador e abria o e-mail no celular acabava logado no celular, porque a
 * sessão nasce em quem abre o link. Digitando o código, a sessão nasce no
 * aparelho onde o login começou.
 */
export async function pedirCodigo(email) {
  exigirSupabase();
  if (!/^\S+@\S+\.\S+$/.test(String(email || '').trim())) {
    throw new Error('Digite um e-mail válido.');
  }
  return backend.pedirCodigo(String(email).trim().toLowerCase());
}

export async function conferirCodigo(email, codigo) {
  exigirSupabase();
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length < 6) throw new Error('O código tem 6 dígitos.');
  return backend.conferirCodigo(String(email).trim().toLowerCase(), c);
}

/* ---------------------------------------------------------------------------
   Lista de líderes

   Tabela pequena e de chave textual: `email` é a primária, então nem `remover`
   (que filtra por `id`) nem `inserir` servem aqui sem tratamento próprio.
--------------------------------------------------------------------------- */

export async function adicionarLider(email, nome) {
  exigirSupabase();
  const e = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Digite um e-mail válido.');
  const { error } = await backend.sb.from('lideres').insert({ email: e, nome: nome?.trim() || null });
  if (error) {
    if (error.code === '23505') throw new Error('Este e-mail já tem acesso.');
    if (error.code === '42501') throw new Error('Só o dono pode conceder acesso.');
    throw new Error(error.message);
  }
  return e;
}

export async function removerLider(email) {
  exigirSupabase();
  const e = String(email || '').trim().toLowerCase();
  const { data, error } = await backend.sb.from('lideres').delete().eq('email', e).select();
  if (error) throw new Error(error.message);
  // Sem permissão o RLS não gera erro: apenas não deixa linha visível para
  // apagar. Zero linhas é negativa, não sucesso — o mesmo cuidado de `remover`.
  if (!data?.length) throw new Error('Não foi possível remover. Só o dono pode, e o dono não se remove.');
}

export async function sair() {
  previa = false;
  sessionStorage.removeItem('om_previa');
  if (ehSupabase) await backend.sair();
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
