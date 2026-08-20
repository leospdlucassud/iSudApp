/**
 * Constantes de domínio.
 *
 * As regras aqui saíram de duas fontes:
 *  - as planilhas que a ala já usava (Relatório de Progresso, Lista de almoço,
 *    Disponibilidade para lições, Plano de Retenção);
 *  - Manual Geral cap. 23, Pregar Meu Evangelho 2023 cap. 8 e o
 *    "Relatório de Progresso: No Caminho do Convênio".
 */

/**
 * Identidade da ala.
 *
 * Fonte única para tudo que exibe o nome. O `index.html` repete o título e o
 * subtítulo em HTML estático só para a primeira pintura não piscar — se mudar
 * aqui, mude lá também. O resto do app lê destas constantes.
 */
export const ALA = {
  nome: 'Ala Palmas 4',
  titulo: 'Obra Missionária da Ala Palmas 4',
  subtitulo: 'Ferramentas para o LMA',
  igreja: 'A Igreja de Jesus Cristo dos Santos dos Últimos Dias',
};

/* ---------------------------------------------------------------------------
   Áreas e duplas
   Uma dupla de missionários por área. O relatório é lançado por área e o
   consolidado da ala é a soma das áreas ativas.
--------------------------------------------------------------------------- */

/**
 * Áreas de partida. Servem de fallback de EXIBIÇÃO enquanto a tabela `areas`
 * estiver vazia, para o app não abrir quebrado antes da configuração — mas
 * elas não existem no banco. Em Configurações a lista mostra o que está
 * gravado de verdade, com um botão para criar estas.
 */
export const AREAS_PADRAO = [
  { id: 'area1', nome: 'Área 1', cor: 0, ordem: 1, ativa: true },
  { id: 'area2', nome: 'Área 2', cor: 1, ordem: 2, ativa: true },
];

/** Slot categórico fixo. A cor segue a entidade, nunca a posição na lista. */
export const corDaArea = (i) => `var(--area-${i % 8})`;

/* ---------------------------------------------------------------------------
   Indicadores do relatório semanal

   `split: true`  → o indicador se desdobra em Casados / Homens / Total,
                    exatamente como nas colunas mescladas da planilha.
   `soma: true`   → entra na consolidação da ala (soma das áreas).
   `derivado`     → não é digitado; sai de outra parte do sistema.
   `pmg`          → número do indicador-chave correspondente em
                    Pregar Meu Evangelho 2023, cap. 8.
--------------------------------------------------------------------------- */

/*
 * As chaves são snake_case porque viram nome de coluna no Postgres, que
 * rebaixa identificador não citado para minúsculas: `licoesMembro` viraria
 * `licoesmembro` e não casaria com o que o cliente manda.
 */
export const INDICADORES = [
  { key: 'referencias',       label: 'Referências de Membro',         abbr: 'Ref.',   split: false, soma: true },
  { key: 'licoes_membro',     label: 'Lições com Membros',            abbr: 'Liç.M',  split: false, soma: true, pmg: 2 },
  { key: 'outras_licoes',     label: 'Outras Lições',                 abbr: 'Out.L',  split: false, soma: true },
  { key: 'novas_pessoas',     label: 'Novas Pessoas Sendo Ensinadas', abbr: 'Novas',  split: true,  soma: true, pmg: 1, legado: 'Novos Pesquisadores' },
  { key: 'novos_com_data',    label: 'Novos com Data de Batismo',     abbr: 'N.Data', split: true,  soma: true },
  { key: 'total_com_data',    label: 'Total com Data de Batismo',     abbr: 'T.Data', split: true,  soma: true, pmg: 4, legado: 'Total Pesq C/ Data' },
  { key: 'sacramental',       label: 'Assistiram à Sacramental',      abbr: 'Sacr.',  split: false, soma: true, pmg: 3 },
  { key: 'progredindo',       label: 'Progredindo',                   abbr: 'Prog.',  split: false, soma: true, derivado: 'lista nominal de progredindo' },
  { key: 'batismos',          label: 'Batismos',                      abbr: 'Bat.',   split: true,  soma: true, pmg: 5, derivado: 'registro de batismos' },
  { key: 'confirmacoes',      label: 'Confirmações',                  abbr: 'Conf.',  split: true,  soma: true, pmg: 5, derivado: 'registro de batismos' },
  { key: 'novos_sacramental', label: 'Membros Novos na Sacramental',  abbr: 'M.Nov',  split: false, soma: true, pmg: 6, derivado: 'caminho do convênio' },
];

/**
 * Frequência sacramental é da ALA, não da área.
 * Na planilha ela era repetida idêntica nas quatro áreas (95, 92, 75);
 * aqui é lançada uma vez por domingo e nunca somada.
 */
export const FREQUENCIA = {
  key: 'frequencia',
  label: 'Frequência Sacramental da Ala',
  abbr: 'Freq.',
  escopo: 'ala',
  soma: false,
};

/**
 * Desdobramento das colunas mescladas da planilha.
 *
 * Atenção ao "Homens": na planilha significa homem ADULTO (18 anos ou mais),
 * não sexo masculino. Um menino de 8 anos conta em Total e zero em Homens.
 */
export const SUBCAMPOS = [
  { key: 'casados', label: 'Casados',        abbr: 'C' },
  { key: 'homens',  label: 'Homens adultos', abbr: 'H' },
  { key: 'total',   label: 'Total',          abbr: 'T' },
];

export const indicadorPorKey = Object.fromEntries(INDICADORES.map(i => [i.key, i]));

/** Os seis indicadores-chave para a conversão, na ordem do PMG 2023. */
export const INDICADORES_CHAVE = [1, 2, 3, 4, 5, 6]
  .map(n => INDICADORES.find(i => i.pmg === n))
  .filter(Boolean);

/**
 * Etapas do funil de conversão.
 *
 * Batismo e confirmação entram juntos porque no PMG 2023 são um único
 * indicador-chave ("pessoas batizadas e confirmadas") — e porque cinco etapas
 * é o que a rampa ordinal de um matiz comporta com degraus distinguíveis.
 */
export const FUNIL = [
  { key: 'novas_pessoas',  label: 'Novas pessoas' },
  { key: 'total_com_data', label: 'Com data' },
  { key: 'sacramental',    label: 'Na sacramental' },
  { key: 'progredindo',    label: 'Progredindo' },
  { key: 'batizados',      label: 'Batizados e confirmados' },
];

/* ---------------------------------------------------------------------------
   Batismos — classificação demográfica

   Regra tirada das fórmulas auxiliares da aba BATISMOS: a faixa sai do
   cruzamento de idade e sexo. Conferido contra o total de março/2025:
   3 Primária + 2 Rapazes + 0 Moças + 4 Homens + 5 Mulheres = 14.
--------------------------------------------------------------------------- */

export const FAIXAS = [
  { key: 'primaria',  label: 'Primária',  cor: 4 },
  { key: 'rapazes',   label: 'Rapazes',   cor: 0 },
  { key: 'mocas',     label: 'Moças',     cor: 5 },
  { key: 'homens',    label: 'Homens',    cor: 1 },
  { key: 'mulheres',  label: 'Mulheres',  cor: 3 },
];

/** @returns {'primaria'|'rapazes'|'mocas'|'homens'|'mulheres'} */
export function faixaEtaria(idade, sexo) {
  const s = String(sexo || '').trim().toLowerCase().charAt(0);
  const n = Number(idade);
  if (!Number.isFinite(n) || n < 12) return 'primaria';
  if (n < 18) return s === 'f' ? 'mocas' : 'rapazes';
  return s === 'f' ? 'mulheres' : 'homens';
}

/** Organizações que recebem a pessoa depois do batismo. */
export const ORGANIZACOES = [
  'Primária', 'Rapazes', 'Moças', 'Quórum de Élderes', 'Sociedade de Socorro',
];

/* ---------------------------------------------------------------------------
   Caminho do convênio

   A ficha antiga ia até "um ano". A orientação atual é acompanhar por
   DOIS anos ("Relatório de Progresso: No Caminho do Convênio"), então os
   14 marcos originais continuam e 6 marcos oficiais foram acrescentados.
--------------------------------------------------------------------------- */

export const MARCOS = [
  {
    grupo: 'Primeiro mês',
    prazoDias: 30,
    itens: [
      { key: 'entrevistaAcompanhamento', label: 'Entrevista de acompanhamento', abbr: 'Entrev.' },
      { key: 'amizades',                 label: 'Amizades na ala',              abbr: 'Amigos' },
      { key: 'ministracao',              label: 'Ministradores designados',     abbr: 'Minist.', novo: true },
      { key: 'sacerdocioAaronico',       label: 'Recebeu o Sacerdócio Aarônico', abbr: 'Sac.A', condicional: 'homem' },
      { key: 'licao1',                   label: '1ª lição para novos membros',  abbr: 'L1' },
      { key: 'licao2',                   label: '2ª lição para novos membros',  abbr: 'L2' },
      { key: 'licao3',                   label: '3ª lição para novos membros',  abbr: 'L3' },
      { key: 'licao4',                   label: '4ª lição para novos membros',  abbr: 'L4' },
      { key: 'licao5',                   label: '5ª lição para novos membros',  abbr: 'L5' },
    ],
  },
  {
    grupo: 'Seis meses',
    prazoDias: 180,
    itens: [
      { key: 'chamado',                  label: 'Recebeu um chamado',            abbr: 'Cham.' },
      { key: 'frequencia',               label: 'Frequência à igreja',           abbr: 'Freq.' },
      { key: 'historiaFamilia',          label: 'Faz a história da família',     abbr: 'Hist.F' },
      { key: 'sacerdocioMelquisedeque',  label: 'Recebeu o Sacerdócio de Melquisedeque', abbr: 'Sac.M', condicional: 'homem' },
      { key: 'recomendacaoLimitada',     label: 'Recomendação para ordenanças vicárias', abbr: 'Rec.L', novo: true },
      { key: 'templo',                   label: 'Foi ao templo',                 abbr: 'Templo' },
      { key: 'bencaoPatriarcal',         label: 'Bênção patriarcal',             abbr: 'B.Patr', novo: true },
    ],
  },
  {
    grupo: 'Quando preparado — até dois anos',
    prazoDias: 730,
    itens: [
      { key: 'preparacaoConvenios',      label: 'Preparação para os convênios maiores', abbr: 'Prep.C' },
      { key: 'instituto',                label: 'Instituto ou seminário',        abbr: 'Inst.', novo: true },
      { key: 'investidura',              label: 'Recebeu a investidura',         abbr: 'Invest.' },
      { key: 'selamento',                label: 'Família selada',                abbr: 'Selam.' },
      { key: 'preparacaoMissionaria',    label: 'Preparação missionária',        abbr: 'Prep.M', novo: true },
    ],
  },
];

export const MARCOS_ITENS = MARCOS.flatMap(g => g.itens.map(i => ({ ...i, grupo: g.grupo, prazoDias: g.prazoDias })));
export const MARCOS_KEYS  = MARCOS_ITENS.map(i => i.key);
export const marcoPorKey  = Object.fromEntries(MARCOS_ITENS.map(i => [i.key, i]));

export const TIPOS_ACOMPANHADO = [
  { key: 'recemConverso', label: 'Recém-converso',        icone: '✨' },
  { key: 'retornando',    label: 'Retornando à atividade', icone: '🔄', exigeConsentimento: true },
];

/* ---------------------------------------------------------------------------
   Calendário e horários
--------------------------------------------------------------------------- */

export const DIAS = [
  { key: 'dom', label: 'Domingo', abbr: 'Dom', dow: 0 },
  { key: 'seg', label: 'Segunda', abbr: 'Seg', dow: 1 },
  { key: 'ter', label: 'Terça',   abbr: 'Ter', dow: 2 },
  { key: 'qua', label: 'Quarta',  abbr: 'Qua', dow: 3 },
  { key: 'qui', label: 'Quinta',  abbr: 'Qui', dow: 4 },
  { key: 'sex', label: 'Sexta',   abbr: 'Sex', dow: 5 },
  { key: 'sab', label: 'Sábado',  abbr: 'Sáb', dow: 6 },
];

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * Marcações fixas da semana missionária, como apareciam na grade da planilha.
 * `bloqueia` impede o agendamento; `aviso` só mostra a etiqueta.
 */
export const MARCAS_SEMANA = {
  1: { rotulo: 'P-Day',            bloqueia: true  },
  2: { rotulo: 'Mesada da missão', bloqueia: false },
};

/** Faixas de horário para lições, como estavam na planilha de disponibilidade. */
export const HORARIOS = [
  '10:30 - 11:30',
  '14:00 - 15:00',
  '15:00 - 16:00',
  '16:00 - 17:00',
  '17:00 - 18:00',
  '18:00 - 19:00',
  '19:00 - 20:00',
  '20:00 - 21:00',
];

export const MODALIDADES_LICAO = [
  { key: 'presencial', label: 'Presencial',     icone: '🏠' },
  { key: 'video',      label: 'Vídeo chamada',  icone: '📱' },
];

/** Como o voluntário entrega o almoço — extraído da coluna OBS. da planilha. */
export const MODALIDADES_ALMOCO = [
  { key: 'presencial', label: 'Presencial',  icone: '🍽️' },
  { key: 'quentinha',  label: 'Quentinha',   icone: '🥡' },
  { key: 'pix',        label: 'Pix',         icone: '💸' },
];

/** Periodicidades recorrentes que apareciam escritas à mão nos OBS. */
export const PERIODICIDADES = [
  { key: 'livre',          label: 'Sem preferência' },
  { key: 'primeiroDom',    label: '1º domingo do mês' },
  { key: 'ultimoDom',      label: 'Último domingo do mês' },
  { key: 'inicioMes',      label: 'Início do mês' },
  { key: 'fimMes',         label: 'Fim do mês' },
  { key: 'duasVezesMes',   label: '2x por mês' },
];

/* ---------------------------------------------------------------------------
   Coordenação missionária — Manual Geral 23.4 (reunião semanal)
--------------------------------------------------------------------------- */

export const PARTICIPANTES_COORDENACAO = [
  'Líder de missão da ala',
  'Presidência do quórum de élderes',
  'Presidência da Sociedade de Socorro',
  'Presidência da Primária',
  'Representante das Moças',
  'Assistente do quórum de sacerdotes',
  'Missionários de ala',
  'Missionários de tempo integral',
];

/**
 * Seções do plano da ala para compartilhar o evangelho.
 *
 * O Manual Geral 23.6 pede que o plano — feito pelo presidente do quórum de
 * élderes, pela presidente da Sociedade de Socorro e pelo líder de missão,
 * com aprovação do bispo — cubra estes quatro pontos.
 */
export const SECOES_PLANO = [
  { key: 'acolher',     titulo: 'Receber bem quem chega',      dica: 'Como a ala acolhe visitantes e pessoas sendo ensinadas nas reuniões.' },
  { key: 'compartilhar', titulo: 'Compartilhar o evangelho',   dica: 'Amar, compartilhar e convidar — o que a ala vai fazer neste trimestre.' },
  { key: 'apoiar',      titulo: 'Apoiar quem está sendo ensinado', dica: 'Referências, lições com membros e acompanhamento à sacramental.' },
  { key: 'progresso',   titulo: 'Progresso espiritual',        dica: 'Como fortalecer membros novos e os que voltam à atividade.' },
];

export const STATUS_PESSOA = {
  progredindo:  { label: 'Progredindo',   tom: 'ok'   },
  dataMarcada:  { label: 'Data marcada',  tom: 'info' },
  semProgresso: { label: 'Sem progresso', tom: 'warn' },
  semContato:   { label: 'Sem contato',   tom: 'err'  },
  batizado:     { label: 'Batizado',      tom: 'ok'   },
};

/* ---------------------------------------------------------------------------
   Módulos e permissões

   `admin: true` → só o LMA/administrador acessa. A restrição de verdade fica
   nas policies de RLS no banco; isto aqui só controla o que a interface mostra.
--------------------------------------------------------------------------- */

export const MODULOS = [
  {
    id: 'almoco', label: 'Almoço', icone: '🍽️', admin: false,
    titulo: 'Calendário de almoço',
    descricao: 'Escolha um dia livre para receber os missionários para o almoço.',
  },
  {
    id: 'licoes', label: 'Lições', icone: '📖', admin: false,
    titulo: 'Lições com os missionários',
    descricao: 'Informe os dias e horários em que você pode acompanhar uma lição.',
  },
  {
    id: 'relatorio', label: 'Relatório', icone: '📊', admin: true,
    titulo: 'Relatório de Progresso',
    descricao: 'Indicadores semanais por área, consolidado da ala e gráficos.',
  },
  {
    id: 'caminho', label: 'Caminho do Convênio', icone: '✨', admin: true,
    titulo: 'Caminho do Convênio',
    descricao: 'Recém-conversos e membros retornando à atividade.',
  },
  {
    id: 'coordenacao', label: 'Coordenação', icone: '📋', admin: true,
    titulo: 'Coordenação missionária',
    descricao: 'Pauta da reunião semanal, designações e plano da ala.',
  },
  {
    id: 'config', label: 'Configurações', icone: '⚙️', admin: true,
    titulo: 'Configurações',
    descricao: 'Áreas, duplas de missionários, acessos e exportação.',
  },
];

/** Rota da tela inicial. Não é um módulo: é o lançador. */
export const INICIO = 'inicio';
