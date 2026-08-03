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

import { uuid } from './util.js';

/** Violação de unicidade — o registro já existe. */
export class ConflitoError extends Error {
  constructor(msg = 'Este horário acabou de ser preenchido por outra pessoa.') {
    super(msg);
    this.name = 'ConflitoError';
  }
}

/** Chaves únicas por coleção. Espelham as constraints UNIQUE do Postgres. */
const UNICOS = {
  almoco_agenda:      ['data', 'area_id'],
  licoes_agenda:      ['data', 'horario', 'area_id'],
  relatorio_semanal:  ['data', 'area_id'],
  frequencia_ala:     ['data'],
  caminho_marcos:     ['pessoa_id', 'marco'],
};

let backend = null;
let ehSupabase = false;
let previa = false;

/** Quem quer ser avisado quando a sessão muda (login pelo link do e-mail). */
const ouvintesDeSessao = new Set();
const avisarSessao = () => ouvintesDeSessao.forEach(fn => fn());

/** @param {() => void} cb @returns {() => void} cancelador */
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

  const ler    = (c) => { try { return JSON.parse(localStorage.getItem(PREFIXO + c)) ?? []; } catch { return []; } };
  const gravar = (c, linhas) => localStorage.setItem(PREFIXO + c, JSON.stringify(linhas));

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
      if (conflita(colecao, linhas, reg)) throw new ConflitoError();
      const novo = { id: uuid(), criado_em: new Date().toISOString(), ...reg };
      linhas.push(novo);
      gravar(colecao, linhas);
      avisar(colecao, true);
      return novo;
    },

    async atualizar(colecao, id, patch) {
      const linhas = ler(colecao);
      const i = linhas.findIndex(l => l.id === id);
      if (i < 0) throw new Error('Registro não encontrado.');
      const atualizado = { ...linhas[i], ...patch };
      if (conflita(colecao, linhas, atualizado, id)) throw new ConflitoError();
      linhas[i] = atualizado;
      gravar(colecao, linhas);
      avisar(colecao, true);
      return atualizado;
    },

    async remover(colecao, id) {
      gravar(colecao, ler(colecao).filter(l => l.id !== id));
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

async function backendSupabase(url, anonKey) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let sessao = null;
  let lider = false;
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
   * Qualquer pessoa consegue pedir um link mágico para o próprio e-mail e
   * receber uma sessão válida. Quem autoriza é a tabela `lideres`, consultada
   * pela função eh_lider() no banco — a mesma que as policies usam.
   */
  async function resolverLider() {
    if (!sessao) return (lider = false);
    const { data, error } = await sb.rpc('eh_lider');
    lider = !error && data === true;
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
      sb.auth.onAuthStateChange(async (_e, s) => {
        sessao = s;
        await resolverLider();
        avisarSessao();
      });
    },

    get sessao() { return sessao; },
    get souLider() { return lider; },
    get schemaOk() { return schemaOk; },

    async entrar(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin },
      });
      if (error) throw new Error(error.message);
    },

    async sair() { await sb.auth.signOut(); sessao = null; lider = false; },

    async listar(colecao, filtro) {
      let q = sb.from(colecao).select('*');
      for (const [k, v] of Object.entries(filtro || {})) q = q.eq(k, v);
      return conferir(await q) ?? [];
    },

    async inserir(colecao, reg) {
      return conferir(await sb.from(colecao).insert(reg).select().single());
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

export async function iniciar() {
  try {
    const cfg = await import('./supabase-config.js');
    if (cfg?.URL && cfg?.ANON_KEY) {
      backend = await backendSupabase(cfg.URL, cfg.ANON_KEY);
      ehSupabase = true;
    }
  } catch {
    // Sem arquivo de configuração.
  }

  // Num site publicado, cair no localStorage é pior do que não abrir: o app
  // pareceria funcionar e cada pessoa teria um calendário particular, sem
  // ninguém perceber. Fora de desenvolvimento isso vira erro visível.
  semConfiguracao = !ehSupabase && !ehDesenvolvimento();

  backend ??= backendLocal();
  await backend.iniciar();
  return backend.nome;
}

export const temBackend = () => ehSupabase;

/** true quando o app está publicado mas sem credenciais do Supabase. */
export const faltaConfiguracao = () => semConfiguracao;

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

export function entrarEmPrevia() {
  previa = true;
  sessionStorage.setItem('om_previa', '1');
}

export async function enviarLinkDeAcesso(email) {
  if (!ehSupabase) throw new Error('Backend não configurado.');
  return backend.entrar(email);
}

export async function sair() {
  previa = false;
  sessionStorage.removeItem('om_previa');
  if (ehSupabase) await backend.sair();
}

export const listar    = (c, f)    => backend.listar(c, f);
export const inserir   = (c, r)    => backend.inserir(c, r);
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
