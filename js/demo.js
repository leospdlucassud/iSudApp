/**
 * Dados fictícios do modo demonstração (`?demo`).
 *
 * TUDO AQUI É INVENTADO. Nomes, telefones, endereços e números não pertencem
 * a ninguém da ala — o repositório é público e o app guarda dado sensível,
 * então nenhuma pessoa real pode servir de exemplo. Os telefones usam o
 * prefixo 90000, que não é distribuído a celulares.
 *
 * Estes dados nunca tocam o Supabase: o db.js, em modo demonstração, troca o
 * backend pelo localStorage com prefixo próprio antes de qualquer conexão.
 *
 * Duas escolhas de construção:
 *
 *  - As datas saem de HOJE, não de um mês fixo. Uma carga presa a outubro
 *    abriria os calendários vazios numa apresentação em março.
 *  - O sorteio tem semente fixa, então os números são os mesmos a cada
 *    carga. Dá para ensaiar a apresentação e encontrar o mesmo gráfico.
 *
 * E uma de conteúdo: a história é coerente de ponta a ponta. Quem aparece em
 * "progredindo" é batizado semanas depois, entra no Caminho do Convênio com a
 * data do batismo e alimenta "membros novos na sacramental" pela frequência.
 * Cada tela de relatório conta a mesma ala.
 */

import {
  AREAS_PADRAO, DIAS, HORARIOS, MARCAS_SEMANA, MARCOS_ITENS,
  PARTICIPANTES_COORDENACAO, SECOES_PLANO,
} from './config.js';
import { deISO, diasDoMes, diasEntre, domingoDaSemana, hoje, iso, somaDias } from './util.js';

/* ---------------------------------------------------------------------------
   Sorteio reprodutível (mulberry32)
--------------------------------------------------------------------------- */

function sorteador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
   Elenco fictício
--------------------------------------------------------------------------- */

const tel = (n) => `(63) 90000-${String(n).padStart(4, '0')}`;

/** Duplas por área: a segunda entra numa transferência, dois meses atrás. */
const DUPLAS = {
  area1: [['Élder Andrade', 'Élder Moreira'], ['Élder Andrade', 'Élder Pacheco']],
  area2: [['Síster Lima', 'Síster Carvalho'], ['Síster Teles', 'Síster Carvalho']],
};

const VOLUNTARIOS = [
  { nome: 'Família Albuquerque', periodicidade: 'primeiroDom', duplas: 2 },
  { nome: 'Irmã Helena Batista', periodicidade: 'livre',       duplas: 1 },
  { nome: 'Família Cardoso',     periodicidade: 'duasVezesMes', duplas: 2 },
  { nome: 'Irmão Jorge Dantas',  periodicidade: 'fimMes',      duplas: 1 },
  { nome: 'Família Esteves',     periodicidade: 'livre',       duplas: 2 },
  { nome: 'Irmã Lúcia Fontes',   periodicidade: 'inicioMes',   duplas: 1 },
  { nome: 'Família Guimarães',   periodicidade: 'ultimoDom',   duplas: 2 },
  { nome: 'Irmão Renato Holanda', periodicidade: 'livre',      duplas: 1 },
  { nome: 'Família Igarashi',    periodicidade: 'livre',       duplas: 1 },
  { nome: 'Irmã Marta Junqueira', periodicidade: 'duasVezesMes', duplas: 1 },
];

const OBS_ALMOCO = ['Sem lactose para o élder Pacheco', 'Almoço às 13h', 'Moramos ao lado da capela', null, null, null];

/** Membros que se ofereceram para acompanhar lições: [nome, modalidade, [dia, horário]...] */
const DISPONIVEIS = [
  ['Irmão Caio Lacerda',    'presencial', [['ter', 4], ['qui', 4], ['sab', 1]]],
  ['Irmã Denise Macedo',    'presencial', [['seg', 2], ['qua', 2], ['qua', 3]]],
  ['Irmão Fábio Nunes',     'video',      [['ter', 6], ['qui', 6]]],
  ['Irmã Gabriela Otero',   'presencial', [['sab', 0], ['sab', 1], ['dom', 2]]],
  ['Irmão Hugo Paiva',      'presencial', [['qua', 5], ['sex', 5], ['sex', 6]]],
  ['Irmã Ingrid Quaresma',  'video',      [['seg', 7], ['ter', 7], ['qui', 7]]],
  ['Irmão Júlio Rezende',   'presencial', [['sab', 2], ['sab', 3]]],
  ['Irmã Karina Sampaio',   'presencial', [['qui', 3], ['sex', 3]]],
  ['Irmã Olga Tavares',     'video',      [['qua', 6], ['sex', 7]]],
];

/**
 * Pessoas sendo ensinadas, e o que acontece com cada uma.
 *
 * `entra` e `batiza` são índices da janela de domingos (0 = o mais antigo).
 * `futuro` é a data marcada em dias a partir de hoje, para quem ainda não foi
 * batizado — é o que enche "Datas de batismo marcadas" na Coordenação.
 */
const ENSINADOS = [
  { nome: 'Rafael Nogueira',      sexo: 'm', idade: 34, area: 'area1', entra: 2,  batiza: 9,  familia: true,  org: 'Quórum de Élderes' },
  { nome: 'Juliana Nogueira',     sexo: 'f', idade: 31, area: 'area1', entra: 2,  batiza: 9,  familia: true,  org: 'Sociedade de Socorro' },
  { nome: 'Pedro Henrique Lopes', sexo: 'm', idade: 9,  area: 'area1', entra: 5,  batiza: 12, familia: false, org: 'Primária' },
  { nome: 'Larissa Prado',        sexo: 'f', idade: 15, area: 'area2', entra: 6,  batiza: 14, familia: false, org: 'Moças' },
  { nome: 'Antônio Barbosa',      sexo: 'm', idade: 58, area: 'area2', entra: 8,  batiza: 17, familia: false, org: 'Quórum de Élderes' },
  { nome: 'Camila Freitas',       sexo: 'f', idade: 27, area: 'area1', entra: 12, batiza: 20, familia: false, org: 'Sociedade de Socorro' },
  { nome: 'Mateus Ramos',         sexo: 'm', idade: 16, area: 'area2', entra: 14, batiza: 22, familia: false, org: 'Rapazes' },
  // Batizada no último fim de semana: o mês corrente sempre abre com um batismo.
  { nome: 'Sandra Azevedo',       sexo: 'f', idade: 45, area: 'area2', entra: 15, batiza: 25, familia: false, org: 'Sociedade de Socorro' },
  { nome: 'Thiago Mendes',        sexo: 'm', idade: 29, area: 'area1', entra: 18, futuro: 6,  familia: true,  org: 'Quórum de Élderes' },
  { nome: 'Beatriz Mendes',       sexo: 'f', idade: 26, area: 'area1', entra: 18, futuro: 6,  familia: true,  org: 'Sociedade de Socorro' },
  { nome: 'Gustavo Rocha',        sexo: 'm', idade: 41, area: 'area2', entra: 20, futuro: 20, familia: false, org: 'Quórum de Élderes' },
  { nome: 'Vitória Campos',       sexo: 'f', idade: 19, area: 'area2', entra: 21,             familia: false, org: 'Sociedade de Socorro' },
  { nome: 'Eduardo Pires',        sexo: 'm', idade: 37, area: 'area1', entra: 22,             familia: false, org: 'Quórum de Élderes' },
];

/**
 * Acompanhados que vêm de antes da janela, ou que voltaram à atividade.
 * Cada um existe para acender uma situação diferente no Caminho do Convênio.
 */
const ACOMPANHADOS_ANTIGOS = [
  // Batizada há ~10 meses e faltando — dispara "faltou nos 3 últimos domingos".
  { nome: 'Fernanda Duarte', sexo: 'f', area: 'area2', tipo: 'recemConverso', diasAtras: 300, consentimento: true, faltando: true },
  // Batizado há ~14 meses e sem chamado — dispara "mais de 6 meses sem
  // chamado", e já fica de fora de "membros novos na sacramental" (> 12 meses).
  { nome: 'Marcos Vieira', sexo: 'm', area: 'area1', tipo: 'recemConverso', diasAtras: 420, consentimento: true, semChamado: true },
  { nome: 'Cláudio Teixeira', sexo: 'm', area: 'area1', tipo: 'retornando', diasAtras: 95, consentimento: true },
  // Sem consentimento registrado — o alerta vermelho que o Manual exige.
  { nome: 'Patrícia Moura', sexo: 'f', area: 'area2', tipo: 'retornando', diasAtras: 40, consentimento: false },
];

/** Antônio fica sem entrevista de acompanhamento: o alerta de mais de 30 dias. */
const SEM_ENTREVISTA = 'Antônio Barbosa';

const PLANO = {
  acolher:
    'Dois casais de recepção por domingo na porta da capela, revezando entre os quóruns e a ' +
    'Sociedade de Socorro. Todo visitante sai da reunião sacramental com o nome anotado e um ' +
    'convite para o almoço da semana com os missionários.',
  compartilhar:
    'Neste trimestre, cada família da ala convida uma pessoa para uma noite familiar com os ' +
    'missionários. O quórum de élderes organiza duas atividades abertas: um mutirão de serviço ' +
    'no bairro e uma noite de jogos na capela.',
  apoiar:
    'Toda lição com pessoa sendo ensinada tem um membro junto — a lista de disponibilidade do ' +
    'app é a fonte. Quem tem data marcada recebe carona para a sacramental e um amigo designado ' +
    'até o batismo.',
  progresso:
    'Entrevista de acompanhamento na primeira semana após o batismo, ministradores designados ' +
    'no primeiro mês e um chamado até o sexto. A coordenação revisa o Caminho do Convênio toda ' +
    'semana e trata primeiro quem está com alerta.',
};

const DESIGNACOES = [
  { descricao: 'Visitar a família Nogueira com os élderes antes da confirmação', responsavel: 'Presidência do quórum de élderes', reuniao: 5, prazoDias: -30, concluida: true },
  { descricao: 'Designar ministradoras para Camila Freitas', responsavel: 'Presidência da Sociedade de Socorro', reuniao: 4, prazoDias: -20, concluida: true },
  { descricao: 'Organizar carona para Antônio Barbosa nos domingos', responsavel: 'Presidência do quórum de élderes', reuniao: 3, prazoDias: -5, concluida: false },
  { descricao: 'Entrevista de acompanhamento com Antônio Barbosa', responsavel: 'Líder de missão da ala', reuniao: 2, prazoDias: -2, concluida: false },
  { descricao: 'Preparar a 2ª lição para novos membros com Mateus Ramos', responsavel: 'Missionários de ala', reuniao: 1, prazoDias: 5, concluida: false },
  { descricao: 'Convidar três famílias para noite familiar com os missionários', responsavel: 'Presidência do quórum de élderes', reuniao: 1, prazoDias: 12, concluida: false },
  { descricao: 'Apresentar Patrícia Moura à presidência da Sociedade de Socorro', responsavel: 'Presidência da Sociedade de Socorro', reuniao: 0, prazoDias: 7, concluida: false },
  { descricao: 'Preencher as vagas de almoço da próxima semana', responsavel: 'Líder de missão da ala', reuniao: 0, prazoDias: 3, concluida: false },
];

/* ---------------------------------------------------------------------------
   Geração
--------------------------------------------------------------------------- */

/**
 * Janela da história, em semanas: quem é ensinado, batizado e acompanhado
 * cabe nos últimos seis meses. Os índices `entra` e `batiza` de ENSINADOS
 * contam a partir do começo desta janela.
 *
 * Os números semanais do relatório vão além: cobrem o ano corrente inteiro.
 * Com só 26 semanas, os gráficos do ano saíam com janeiro a abril colados no
 * zero, e numa apresentação isso lê como "o app não tinha dados".
 */
const HISTORIA = 26;

/**
 * Gera a demonstração inteira, sem gravar nada: devolve { colecao: linhas }.
 *
 * Função pura de propósito — mesma data, mesmo resultado, até nos ids. Quem
 * grava é o db.js, escrevendo cada coleção INTEIRA. Duas abas abrindo a
 * demonstração ao mesmo tempo já semearam por cima uma da outra e deixaram
 * tudo em dobro (as áreas inclusive, e com elas todos os totais da ala);
 * escrevendo o mesmo conteúdo determinístico, a corrida vira inofensiva.
 */
export function gerar() {
  const r = sorteador(20260917);
  const entre = (min, max) => min + Math.floor(r() * (max - min + 1));
  const chance = (p) => r() < p;
  const um = (lista) => lista[Math.floor(r() * lista.length)];

  const HOJE = hoje();
  // O último domingo que já aconteceu. domingoDaSemana devolve o domingo que
  // FECHA a semana, que fica no futuro em qualquer dia que não seja domingo.
  const fecha = domingoDaSemana(HOJE);
  const ultimo = fecha > HOJE ? somaDias(fecha, -7) : fecha;
  // Do primeiro domingo do ano até o último que passou — ou as 26 semanas da
  // história, se o ano ainda for mais curto que isso (apresentação em março).
  const doAno = Math.floor(diasEntre(`${ultimo.slice(0, 4)}-01-01`, ultimo) / 7) + 1;
  const total = Math.max(HISTORIA, doAno);
  const domingos = Array.from({ length: total }, (_, i) => somaDias(ultimo, -7 * (total - 1 - i)));
  const base = total - HISTORIA;  // onde a janela da história começa
  const sabadoAntes = (domingo) => somaDias(domingo, -1);

  /** Primeiro sábado em ou depois de uma data. */
  const sabadoApos = (data) => {
    const d = deISO(data);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    return iso(d);
  };

  /** Meses de (deslocamento) em relação ao atual, como {ano, mes 0-11}. */
  const mesRelativo = (desloc) => {
    const d = deISO(HOJE);
    d.setDate(1);
    d.setMonth(d.getMonth() + desloc);
    return { ano: d.getFullYear(), mes: d.getMonth() };
  };

  const L = {};

  /* --- Áreas e duplas ------------------------------------------------------ */

  L.areas = AREAS_PADRAO.map(a => ({ ...a }));

  L.duplas_missionarios = [];
  for (let desloc = -6; desloc <= 1; desloc++) {
    const { ano, mes } = mesRelativo(desloc);
    for (const area of Object.keys(DUPLAS)) {
      const [m1, m2] = DUPLAS[area][desloc < -1 ? 0 : 1];
      L.duplas_missionarios.push({ area_id: area, ano, mes: mes + 1, missionario_1: m1, missionario_2: m2 });
    }
  }

  /* --- Almoço --------------------------------------------------------------- */

  L.voluntarios_almoco = VOLUNTARIOS.map((v, i) => ({
    ...v,
    telefone: tel(100 + i),
    endereco: `Rua ${['das Palmeiras', 'dos Ipês', 'do Buriti', 'das Acácias', 'da Serra'][i % 5]}, ${100 + i * 17}`,
    observacoes: i === 3 ? 'Pede para avisar com dois dias de antecedência' : null,
  }));

  L.almoco_agenda = [];
  for (let desloc = -1; desloc <= 1; desloc++) {
    const { ano, mes } = mesRelativo(desloc);
    for (const d of diasDoMes(ano, mes)) {
      if (MARCAS_SEMANA[d.dow]?.bloqueia) continue;
      const distancia = diasEntre(HOJE, d.data);
      // Passado quase cheio, próxima semana com vagas para a pauta mostrar,
      // fim do próximo mês ainda aberto — como um calendário de verdade.
      const p = distancia < 0 ? 0.85 : distancia <= 14 ? 0.55 : 0.3;
      for (const area of ['area1', 'area2']) {
        if (!chance(p)) continue;
        const v = um(VOLUNTARIOS);
        L.almoco_agenda.push({
          data: d.data, area_id: area, nome: v.nome, observacao: um(OBS_ALMOCO),
        });
      }
    }
  }

  /* --- Lições ---------------------------------------------------------------- */

  L.disponibilidade_licoes = [];
  DISPONIVEIS.forEach(([nome, modalidade, slots], i) => {
    for (const [dia, h] of slots) {
      L.disponibilidade_licoes.push({
        nome, telefone: tel(200 + i), modalidade, dia, horario: HORARIOS[h],
        criado_em: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
      });
    }
  });

  L.licoes_agenda = [];
  for (let desloc = -1; desloc <= 1; desloc++) {
    const { ano, mes } = mesRelativo(desloc);
    for (const d of diasDoMes(ano, mes)) {
      if (MARCAS_SEMANA[d.dow]?.bloqueia) continue;
      const dia = DIAS.find(x => x.dow === d.dow).key;
      // Só quem disse que pode naquele dia da semana acompanha a lição.
      const quem = L.disponibilidade_licoes.filter(x => x.dia === dia);
      for (const area of ['area1', 'area2']) {
        if (!quem.length || !chance(diasEntre(HOJE, d.data) < 0 ? 0.35 : 0.22)) continue;
        const pessoa = um(quem);
        L.licoes_agenda.push({
          data: d.data, horario: pessoa.horario, area_id: area,
          nome: pessoa.nome, modalidade: pessoa.modalidade, observacao: null,
        });
      }
    }
  }

  /* --- Relatório semanal e frequência ---------------------------------------- */

  // Leve crescimento ao longo do ano, com a Sul um pouco menor: é a história
  // que o gráfico conta numa apresentação.
  const ESCALA = { area1: 1, area2: 0.8 };

  L.relatorio_semanal = [];
  L.frequencia_ala = [];
  domingos.forEach((data, i) => {
    const t = i / (domingos.length - 1);
    for (const area of ['area1', 'area2']) {
      const k = ESCALA[area];
      const n = (base, ganho, folga) => Math.max(0, Math.round((base + ganho * t + r() * folga) * k));

      const novas = n(2, 3, 3);
      const novosData = chance(0.4 + 0.2 * t) ? entre(1, 2) : 0;
      const totalData = Math.max(novosData, n(2, 2, 2));

      L.relatorio_semanal.push({
        data, area_id: area,
        referencias: n(0, 2, 3),
        licoes_membro: n(3, 4, 3),
        outras_licoes: n(8, 6, 6),
        // Só o total: Casados e Homens adultos deixaram de ser lançados.
        novas_pessoas_total: novas,
        novos_com_data_total: novosData,
        total_com_data_total: totalData,
        sacramental: n(2, 3, 2),
      });
    }
    L.frequencia_ala.push({ data, valor: Math.round(88 + 14 * t + (r() - 0.5) * 12) });
  });

  /* --- Ensinados: progredindo, batismos e entrada no Caminho ----------------- */

  L.progredindo = [];
  L.batismos = [];
  L.caminho_pessoas = [];

  for (const p of ENSINADOS) {
    const batizou = p.batiza != null;
    const dataBatismo = batizou
      ? sabadoAntes(domingos[base + p.batiza])
      : p.futuro != null ? sabadoApos(somaDias(HOJE, p.futuro)) : null;
    // Data marcada três semanas antes do batismo; quem ainda não foi batizado
    // e tem data já a vê em todas as semanas recentes.
    const marcaEm = batizou ? p.batiza - 3 : HISTORIA - 4;
    const ate = batizou ? p.batiza - 1 : HISTORIA - 1;

    let sacramentais = 0;
    for (let w = p.entra; w <= ate; w++) {
      if (chance(0.8)) sacramentais++;
      L.progredindo.push({
        data: domingos[base + w], nome: p.nome, area_id: p.area,
        sacramentais,
        data_batismo: dataBatismo && w >= marcaEm ? dataBatismo : null,
        organizacao: p.org,
      });
    }

    if (!batizou) continue;

    L.batismos.push({
      nome: p.nome, sexo: p.sexo, idade: p.idade, area_id: p.area,
      data_batismo: dataBatismo,
      data_confirmacao: domingos[base + p.batiza],
      familia_completa: p.familia,
    });
    L.caminho_pessoas.push({
      id: `demo-${HOJE}-pessoa-${L.caminho_pessoas.length}`, nome: p.nome, tipo: 'recemConverso', area_id: p.area, sexo: p.sexo,
      data_inicio: dataBatismo, telefone: tel(300 + L.caminho_pessoas.length),
      consentimento: true, observacoes: null, ativo: true,
    });
  }

  for (const a of ACOMPANHADOS_ANTIGOS) {
    L.caminho_pessoas.push({
      id: `demo-${HOJE}-pessoa-${L.caminho_pessoas.length}`, nome: a.nome, tipo: a.tipo, area_id: a.area, sexo: a.sexo,
      data_inicio: somaDias(ultimo, -a.diasAtras), telefone: tel(300 + L.caminho_pessoas.length),
      consentimento: a.consentimento,
      observacoes: a.tipo === 'retornando' ? 'Voltou a frequentar depois de visita dos ministradores.' : null,
      ativo: true, _a: a,
    });
  }

  /* --- Caminho: marcos e frequência ------------------------------------------ */

  L.caminho_marcos = [];
  L.caminho_frequencia = [];

  for (const p of L.caminho_pessoas) {
    const extra = p._a ?? {};
    delete p._a;
    const dias = diasEntre(p.data_inicio, HOJE);

    const porGrupo = {};
    for (const m of MARCOS_ITENS) {
      if (m.condicional === 'homem' && p.sexo !== 'm') continue;
      const idx = (porGrupo[m.grupo] = (porGrupo[m.grupo] ?? -1) + 1);

      // Quantos dias depois do início este marco costuma acontecer.
      const quando = m.prazoDias <= 30 ? 6 + idx * 4
        : m.prazoDias <= 180 ? 45 + idx * 22
        : 220 + idx * 90;
      const prob = m.prazoDias <= 30 ? 0.95 : m.prazoDias <= 180 ? 0.75 : 0.5;

      if (dias < quando || !chance(prob)) continue;
      if (m.key === 'entrevistaAcompanhamento' && p.nome === SEM_ENTREVISTA) continue;
      if (m.key === 'chamado' && extra.semChamado) continue;

      L.caminho_marcos.push({
        pessoa_id: p.id, marco: m.key, data: somaDias(p.data_inicio, quando), observacao: null,
      });
    }

    const seus = domingos.filter(d => d >= p.data_inicio);
    seus.forEach((domingo, i) => {
      const nosUltimos3 = i >= seus.length - 3;
      L.caminho_frequencia.push({
        pessoa_id: p.id, domingo,
        presente: extra.faltando && nosUltimos3 ? false : chance(0.85),
      });
    });
  }

  /* --- Coordenação ----------------------------------------------------------- */

  // Seis reuniões semanais, a mais recente no último domingo.
  const reunioes = Array.from({ length: 6 }, (_, k) => ({
    id: `demo-${HOJE}-reuniao-${k}`,
    data: domingos[domingos.length - 1 - k],
    observacoes: k === 0
      ? 'Foco da semana: carona e entrevista do irmão Antônio, e as vagas de almoço em aberto.'
      : k === 3 ? 'Batismo da Larissa confirmado; Moças vão recebê-la no domingo.' : null,
  }));
  L.coordenacao_reunioes = reunioes;

  L.coordenacao_presencas = reunioes.flatMap(reu => PARTICIPANTES_COORDENACAO.map(papel => ({
    reuniao_id: reu.id, papel,
    presente: papel === 'Líder de missão da ala' || chance(0.82),
  })));

  L.coordenacao_designacoes = DESIGNACOES.map(d => {
    const reu = reunioes[d.reuniao];
    return {
      reuniao_id: reu.id,
      descricao: d.descricao,
      responsavel: d.responsavel,
      prazo: somaDias(HOJE, d.prazoDias),
      concluida: d.concluida,
      concluida_em: d.concluida ? somaDias(HOJE, d.prazoDias - 2) : null,
      criado_em: deISO(reu.data).toISOString(),
    };
  });

  L.plano_ala = SECOES_PLANO.map(s => ({ secao: s.key, texto: PLANO[s.key] ?? '' }));

  /* --- Acesso ---------------------------------------------------------------- */

  // example.com é o domínio reservado para exemplos: não chega a ninguém.
  L.lideres = [
    { email: 'lma@example.com', nome: 'Líder de missão (demonstração)', dono: true, criado_em: somaDias(HOJE, -200) + 'T12:00:00Z' },
    { email: 'secretario@example.com', nome: 'Secretário da ala (demonstração)', dono: false, criado_em: somaDias(HOJE, -60) + 'T12:00:00Z' },
  ];

  return L;
}
