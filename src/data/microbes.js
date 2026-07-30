import { seededRandom } from '../core/math.js';

export const microbeCatalog = {
  rhizobium: {
    name: 'Rhizobium',
    title: 'Rhizobium reconhecido',
    desc: 'Bactérias móveis aproximam-se dos pelos radiculares e iniciam a comunicação que pode levar à formação de nódulos.',
    color: '#79e8dc',
    soil: 3,
    hope: 2,
  },
  myco: {
    name: 'Micorriza',
    title: 'Rede micorrízica conectada',
    desc: 'As hifas ampliam o volume de solo explorado e ajudam a transportar fósforo e água até a raiz.',
    color: '#d6afff',
    soil: 6,
    hope: 3,
  },
  bacillus: {
    name: 'Bacillus',
    title: 'Microcolônia de Bacillus',
    desc: 'Biofilme e endósporos ajudam a comunidade a resistir. No jogo, as colônias de Bacillus funcionam como checkpoints.',
    color: '#70e5d6',
    soil: 3,
    hope: 3,
  },
  phos: {
    name: 'PGPB solubilizadora',
    title: 'Solubilizadora reconhecida',
    desc: 'A comunidade concentra secreções junto ao mineral e libera parte do fósforo antes inacessível.',
    color: '#8db8ff',
    soil: 6,
    hope: 4,
  },
  oportunista: {
    name: 'Fungo oportunista',
    title: 'Desequilíbrio detectado',
    desc: 'A colônia cresce com maior intensidade em tecido lesionado. Solo vivo não elimina riscos, mas ajuda a limitar oportunidades de invasão.',
    color: '#ff8297',
    soil: 0,
    hope: 0,
  },
  trichoderma: {
    name: 'Trichoderma',
    title: 'Trichoderma em ação',
    desc: 'Hifas de biocontrole reconhecem o fungo-alvo, enrolam-se ao redor dele e concentram enzimas na região de contato.',
    color: '#8df0a8',
    soil: 4,
    hope: 4,
  },
  azospirillum: {
    name: 'Azospirillum',
    title: 'Azospirillum reconhecido',
    desc: 'Células curvas colonizam regiões jovens da raiz e representam sinais associados ao crescimento de raízes laterais.',
    color: '#72e8dd',
    soil: 3,
    hope: 3,
  },
  pseudomonas: {
    name: 'Pseudomonas',
    title: 'Sideróforos fluorescentes',
    desc: 'Bastonetes finos capturam ferro com sideróforos, alterando a competição por esse micronutriente na rizosfera.',
    color: '#b9f36f',
    soil: 3,
    hope: 3,
  },
};

export const microbeEncounters = [
  { id: 'rhizobium', x: 430, y: 520, r: 165 },
  { id: 'myco', x: 1370, y: 430, r: 90, collect: true },
  { id: 'bacillus', x: 2260, y: 535, r: 150, collect: true },
  { id: 'phos', x: 2860, y: 385, r: 90, collect: true },
  { id: 'oportunista', x: 3515, y: 500, r: 155 },
  { id: 'trichoderma', x: 3700, y: 455, r: 150 },
  { id: 'azospirillum', x: 1080, y: 455, r: 145, collect: true },
  { id: 'pseudomonas', x: 4430, y: 520, r: 155 },
];

export function createMicrobeArt() {
  const artRnd = seededRandom(734291);
  return {
    rhizobium: Array.from({ length: 15 }, () => ({ x: (artRnd() - .5) * 240, y: (artRnd() - .5) * 125, a: artRnd() * 6.28, s: .68 + artRnd() * .55, p: artRnd() * 6.28 })),
    bacillus: Array.from({ length: 18 }, () => ({ x: (artRnd() - .5) * 245, y: (artRnd() - .5) * 115, a: artRnd() * 6.28, s: .7 + artRnd() * .55, p: artRnd() * 6.28, spore: artRnd() > .72 })),
    phos: Array.from({ length: 13 }, (_, i) => ({ a: i / 13 * 6.28 + artRnd() * .2, r: 42 + artRnd() * 48, s: .68 + artRnd() * .45, p: artRnd() * 6.28 })),
    azospirillum: Array.from({ length: 13 }, () => ({ x: (artRnd() - .5) * 230, y: (artRnd() - .5) * 115, a: artRnd() * 6.28, s: .72 + artRnd() * .5, p: artRnd() * 6.28 })),
    pseudomonas: Array.from({ length: 14 }, () => ({ x: (artRnd() - .5) * 235, y: (artRnd() - .5) * 115, a: artRnd() * 6.28, s: .65 + artRnd() * .45, p: artRnd() * 6.28 })),
    myco: Array.from({ length: 18 }, () => ({ a: -1.25 + artRnd() * 2.5, len: 75 + artRnd() * 155, bend: (artRnd() - .5) * 85, p: artRnd() * 6.28, branch: artRnd() > .35 })),
    opportunist: Array.from({ length: 14 }, () => ({ a: -2.5 + artRnd() * 2.2, len: 70 + artRnd() * 145, bend: (artRnd() - .5) * 80, p: artRnd() * 6.28 })),
    tricho: Array.from({ length: 13 }, () => ({ a: 2.55 + artRnd() * 1.25, len: 60 + artRnd() * 135, bend: (artRnd() - .5) * 65, p: artRnd() * 6.28 })),
  };
}
