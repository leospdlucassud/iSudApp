/**
 * Regras de domínio puras — sem DOM, sem banco.
 *
 * Moram aqui as que mais de um módulo precisa. O caminho do convênio calcula
 * progresso e pendências; o relatório precisa do 6º indicador-chave; a
 * coordenação monta a pauta com as duas coisas. Regra duplicada em três
 * lugares é regra que vai divergir.
 */

import { MARCOS_ITENS } from './config.js';
import { diasEntre, hoje, pct, somaDias } from './util.js';

/** Janela oficial de acompanhamento: dois anos. */
export const DIAS_JANELA = 730;

export const diasNoCaminho = (p) => diasEntre(p.data_inicio, hoje());
export const mesesNoCaminho = (p) => Math.floor(diasNoCaminho(p) / 30.44);

/**
 * Marcos que valem para esta pessoa.
 * Ordenação ao sacerdócio só se aplica a homens — sem isso, toda irmã ficaria
 * presa abaixo de 100% para sempre.
 */
export const marcosDe = (p) =>
  MARCOS_ITENS.filter(m => m.condicional !== 'homem' || p.sexo === 'm');

export const marcoFeito = (marcos, pessoaId, key) =>
  marcos.find(m => m.pessoa_id === pessoaId && m.marco === key);

export function progresso(p, marcos) {
  const aplicaveis = marcosDe(p);
  const feitos = aplicaveis.filter(m => marcoFeito(marcos, p.id, m.key)).length;
  return { feitos, total: aplicaveis.length, pct: pct(feitos, aplicaveis.length) };
}

export const presencaEm = (frequencias, pessoaId, domingo) =>
  frequencias.find(f => f.pessoa_id === pessoaId && f.domingo === domingo);

/**
 * Pendências que o conselho da ala precisa ver.
 *
 * Só conta ausência REGISTRADA. Domingo sem preenchimento não é domingo
 * faltado, e tratar como falta encheria a tela de alerta falso.
 *
 * @returns {{tom:'err'|'warn'|'mute', texto:string}[]}
 */
export function alertasDoCaminho(p, marcos, frequencias) {
  const out = [];
  const dias = diasNoCaminho(p);

  if (p.tipo === 'retornando' && !p.consentimento) {
    out.push({ tom: 'err', texto: 'Sem consentimento registrado' });
  }
  if (dias > 30 && !marcoFeito(marcos, p.id, 'entrevistaAcompanhamento')) {
    out.push({ tom: 'err', texto: `${dias} dias sem entrevista de acompanhamento` });
  }
  if (dias > 180 && !marcoFeito(marcos, p.id, 'chamado')) {
    out.push({ tom: 'warn', texto: 'Mais de 6 meses sem chamado' });
  }

  // A janela vem dos domingos REGISTRADOS e só depois se exige que os três
  // sejam falta. Filtrar as ausências antes de cortar fazia três faltas em
  // qualquer ponto do histórico acenderem o alerta para sempre, mesmo com
  // presenças no meio e depois — o texto prometia "os 3 últimos" e entregava
  // "3 em qualquer lugar".
  const ultimos = frequencias
    .filter(f => f.pessoa_id === p.id && typeof f.presente === 'boolean')
    .sort((a, b) => String(a.domingo).localeCompare(String(b.domingo)))
    .slice(-3);
  if (ultimos.length === 3 && ultimos.every(f => f.presente === false)) {
    out.push({ tom: 'warn', texto: 'Faltou nos 3 últimos domingos registrados' });
  }

  if (dias > DIAS_JANELA) {
    out.push({ tom: 'mute', texto: 'Passou dos dois anos — pode arquivar' });
  }
  return out;
}

/** Pendências que exigem ação; o aviso de arquivar não conta. */
export const precisaDeAtencao = (p, marcos, frequencias) =>
  alertasDoCaminho(p, marcos, frequencias).some(a => a.tom !== 'mute');

/**
 * 6º indicador-chave do PMG 2023: membros novos que assistiram à sacramental.
 *
 * "Novo" é quem foi batizado nos 12 meses anteriores ÀQUELE domingo — não a
 * hoje. Contar a partir da data corrente faria o histórico mudar de valor com
 * o passar do tempo.
 */
export function novosNaSacramental(domingo, areaId, pessoas, frequencias) {
  const limite = somaDias(domingo, -365);
  const novos = pessoas.filter(p =>
    p.tipo === 'recemConverso' &&
    (areaId == null || p.area_id === areaId) &&
    p.data_inicio > limite &&
    p.data_inicio <= domingo);

  return novos.filter(p => frequencias.some(f =>
    f.pessoa_id === p.id && f.domingo === domingo && f.presente)).length;
}
