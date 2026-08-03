import { emConstrucao } from './_placeholder.js';

export async function montar(alvo) {
  alvo.append(emConstrucao({
    icone: '📖',
    titulo: 'Lições com os missionários',
    resumo: 'Disponibilidade dos membros para acompanhar as lições, e o agendamento em cima dela.',
    fase: 'Fase 4',
    itens: [
      'Grade recorrente por membro: modalidade (presencial ou vídeo chamada) × dia da semana × faixa de horário, com as oito faixas da planilha.',
      'O próprio membro marca sua disponibilidade; uma vez gravada, só o LMA altera.',
      'Calendário datado por cima da grade, onde os missionários marcam a lição de verdade num horário livre — com a mesma trava contra dois agendamentos simultâneos.',
      'Visão da semana para o LMA: quem está disponível, quando, e quais horários já foram usados.',
    ],
  }));
}
