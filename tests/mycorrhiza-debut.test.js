import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLevel } from '../src/procgen/generator.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { applyPhaseFourMycorrhizaIntro } from '../src/procgen/phase-four-mycorrhiza-intro.js';
import { getPhaseManifest, getProceduralPoolAt } from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed, createCampaign, decorateCampaignLevel, prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';

const SEEDS = ['myco-a', 'myco-b', 'myco-c', 'myco-d'];

function faseQuatro(seedName) {
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = 4;
  const profile = prepareCampaignGeneration(campaign);
  const seed = campaignPhaseSeed(campaign);
  let level = generateLevel(seed);
  applyPhaseFourMycorrhizaIntro(level, 4, getPhaseManifest(4).mycorrhizaBridge);
  level = decorateCampaignLevel(level, campaign, profile);
  const encontros = generateCampaignEncounters({ platforms: level.platforms, phase: 4, seedValue: seed })
    .concat(level.authoredEncounters || []);
  return { level, encontros };
}

test('a micorriza e um organismo de verdade, com propagulo, e aparece mais de uma vez', () => {
  // Como ally ela vinha sem propagulo nenhum: dava para ler o cartao e nao havia
  // o que capturar. A ponte lateral que a prova final exige ficava impossivel de
  // construir, e a fase podia ser atravessada inteira sem poder ser concluida.
  //
  // Ela tambem aparecia num ponto so — estranho para o organismo-tema da fase.
  // Agora entra no pool depois da estreia, como os outros.
  for (const seed of SEEDS) {
    const { encontros } = faseQuatro(seed);
    const myco = encontros.filter(encontro => encontro.id === 'myco');
    assert.ok(myco.length > 1, `${seed}: o organismo-tema da fase nao pode aparecer uma vez so`);
    const estreia = myco.filter(zone => zone.source === 'debut');
    assert.equal(estreia.length, 1, `${seed}: mas a estreia e uma so`);
    assert.equal(estreia[0].logicIndex, 3, `${seed}: no chunk declarado`);
  }
});

test('so a estreia ensina: uma zona carrega o cartao e o desbloqueio', () => {
  // Se mais de uma carregasse, o cartao reabriria e a mecanica seria
  // desbloqueada de novo em qualquer encontro do pool.
  for (const seed of SEEDS) {
    const { encontros } = faseQuatro(seed);
    const myco = encontros.filter(encontro => encontro.id === 'myco');
    assert.equal(
      myco.filter(zone => zone.unlockFeature === 'mycorrhizaStructures').length, 1,
      `${seed}: exatamente uma zona pode desbloquear a ponte`,
    );
  }
});

test('o item de coleta da micorriza foi removido, nao escondido', () => {
  // O ally era resto da versao anterior da micorriza. Escondi-lo e manter o
  // gatilho, como cheguei a fazer, transformou a chave da mecanica num objeto
  // invisivel — pior do que estava. Ele nao pode voltar em nenhuma forma.
  for (const seed of SEEDS) {
    const { level } = faseQuatro(seed);
    assert.equal(
      (level.allies || []).filter(ally => ally.id === 'myco').length, 0,
      `${seed}: o ally da micorriza precisa ter sido removido`,
    );
  }
});

test('o desbloqueio da ponte mora no organismo', () => {
  // Este era o bug: mycorrhizaStructures so ligava ao encostar no ally, e o
  // simulador so roda o sistema de pontes se essa flag estiver ligada. Sem o
  // desbloqueio, NENHUMA ponte se formava — com inoculo ou sem.
  for (const seed of SEEDS) {
    const { encontros } = faseQuatro(seed);
    const estreia = encontros.find(encontro => encontro.id === 'myco' && encontro.source === 'debut');
    assert.equal(
      estreia?.unlockFeature, 'mycorrhizaStructures',
      `${seed}: o organismo precisa carregar o desbloqueio da mecanica`,
    );
    assert.equal(estreia.cardId, 'organism-mycorrhiza', 'e tambem o cartao');
    assert.ok(estreia.r >= 120, 'a area do desbloqueio e a do organismo, nao a de um item de 54px');
  }
});

test('rodar a decoracao duas vezes nao duplica nada', () => {
  const { level } = faseQuatro(SEEDS[0]);
  const antes = (level.authoredEncounters || []).filter(e => e.id === 'myco').length;
  const campaign = createCampaign(SEEDS[0], { storage: null });
  campaign.phase = 4;
  decorateCampaignLevel(level, campaign, prepareCampaignGeneration(campaign));
  const depois = (level.authoredEncounters || []).filter(e => e.id === 'myco').length;
  assert.equal(depois, antes, 'rodar a decoracao de novo nao pode duplicar o organismo');
  assert.equal((level.allies || []).filter(a => a.id === 'myco').length, 0, 'nem ressuscitar o ally');
});
