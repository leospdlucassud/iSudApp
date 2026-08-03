import { emConstrucao } from './_placeholder.js';

export async function montar(alvo) {
  alvo.append(emConstrucao({
    icone: '📋',
    titulo: 'Coordenação missionária',
    resumo: 'Pauta da reunião semanal de coordenação, conforme o Manual Geral 23.4.',
    fase: 'Fase 7',
    itens: [
      'Pauta montada sozinha a partir do resto do app: lista de progredindo, recém-conversos em atraso e pessoas com data de batismo marcada.',
      'Presença dos participantes previstos no manual — presidências da Sociedade de Socorro, quórum de élderes e Primária, representante das Moças, assistente do quórum de sacerdotes, missionários de ala e de tempo integral.',
      'Designações com responsável e prazo, retomadas na semana seguinte.',
      'Plano da ala para compartilhar o evangelho, com as metas do trimestre.',
    ],
  }));
}
