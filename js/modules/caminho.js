import { emConstrucao } from './_placeholder.js';

export async function montar(alvo) {
  alvo.append(emConstrucao({
    icone: '✨',
    titulo: 'Caminho do Convênio',
    resumo: 'Acompanhamento de recém-conversos e de membros retornando à atividade.',
    fase: 'Fase 6',
    itens: [
      'Os 14 marcos da sua ficha, mais 6 que a orientação atual acrescenta: ministradores designados, recomendação para ordenanças vicárias, bênção patriarcal, instituto, preparação missionária.',
      'Janela de acompanhamento de dois anos, não de um — é o prazo do "Relatório de Progresso: No Caminho do Convênio".',
      'Grade de domingos na igreja, mês a mês, como a faixa "Domingos na Igreja" da planilha.',
      'Alertas de atraso: batizado há mais de 30 dias sem entrevista de acompanhamento, três domingos seguidos ausente, seis meses sem chamado.',
      'Marcação de consentimento para membros retornando à atividade, exigida pela orientação da Igreja antes de incluí-los no acompanhamento.',
      'Alimenta o indicador nº 6 do relatório — membros novos que assistiram à reunião sacramental.',
    ],
  }));
}
