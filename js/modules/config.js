import { emConstrucao } from './_placeholder.js';

export async function montar(alvo) {
  alvo.append(emConstrucao({
    icone: '⚙️',
    titulo: 'Configurações',
    resumo: 'Áreas, duplas, acessos e exportação.',
    fase: 'Fase 7',
    itens: [
      'Áreas da ala: criar, renomear, ativar e desativar. O relatório e o calendário seguem as áreas ativas.',
      'Duplas de missionários do mês, por área — os nomes que apareciam no cabeçalho de cada bloco da planilha.',
      'Quem tem acesso de LMA, com entrada por link no e-mail.',
      'Exportação de tudo para Excel e importação das planilhas antigas.',
    ],
  }));
}
