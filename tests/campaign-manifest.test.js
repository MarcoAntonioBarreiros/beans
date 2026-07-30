import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  campaignManifest,
  getAvailableUnlocksAt,
  getPathogensAt,
  getPhaseManifest,
  getPresentationForTrigger,
  getProceduralPoolAt,
  getRequiredPracticeAbilityAt,
  getSegmentAt,
  getTutorialModeAt,
  tutorialPacing,
  validateCampaignManifest,
  validateFirstEncounterProximity,
} from '../src/procgen/campaign-manifest.js';
import { getTutorialCard, tutorialCardIds } from '../src/procgen/tutorial-registry.js';

const cloneManifest = () => JSON.parse(JSON.stringify(campaignManifest));

test('manifesto completo valida contra os cartões reais', () => {
  assert.deepEqual(validateCampaignManifest({ knownCardIds: tutorialCardIds }), []);
  // 11 entradas: prologo (0) + fases 1..10. A Ralstonia ganhou fase propria (9)
  // e o ecossistema integrado passou a ser a fase 10.
  assert.equal(campaignManifest.length, 11);
  assert.equal(getPhaseManifest(0)?.id, 'prologue');
  assert.equal(getPhaseManifest(9)?.id, 'phase-9');
  assert.equal(getPhaseManifest(9)?.title, 'Ralstonia e murcha vascular');
  assert.equal(getPhaseManifest(10)?.id, 'phase-10');
  assert.equal(getPhaseManifest(10)?.title, 'Ecossistema integrado');
});

test('segmentos cobrem os chunks e expõem o modo tutorial esperado', () => {
  assert.equal(getSegmentAt(1, 4)?.id, 'p1-intro');
  assert.equal(getTutorialModeAt(1, 4), 'guided');
  assert.equal(getTutorialModeAt(1, 9), 'silent');
  assert.equal(getTutorialModeAt(99, 0), 'disabled');
});

test('pool procedural respeita estreia e poolFromChunk', () => {
  assert.deepEqual(getProceduralPoolAt(1, 8), []);
  assert.deepEqual(getProceduralPoolAt(1, 9), ['bacillus']);
  assert.equal(getProceduralPoolAt(5, 5).includes('oportunista'), false);
  assert.equal(getProceduralPoolAt(5, 6).includes('oportunista'), true);
  assert.equal(getProceduralPoolAt(5, 11).includes('pseudomonas'), false);
  assert.equal(getProceduralPoolAt(5, 12).includes('pseudomonas'), true);
});

test('unlock do chunk N só fica disponível a partir do chunk N+1', () => {
  // A fase 3 foi encurtada de 40 para 25 chunks e o desbloqueio do salto duplo
  // acompanhou o reescalonamento, do chunk 20 para o 16.
  assert.equal(getAvailableUnlocksAt(3, 16).doubleJump, false);
  assert.equal(getAvailableUnlocksAt(3, 17).doubleJump, true);
  assert.equal(getRequiredPracticeAbilityAt(3, 17), 'doubleJump');
  assert.equal(getAvailableUnlocksAt(7, 3).phosphateSolubilization, false);
  assert.equal(getAvailableUnlocksAt(7, 4).phosphateSolubilization, true);
});

test('Ralstonia so aparece depois de ter fase propria', () => {
  // A regra deixou de ser "nunca aparece" e passou a ser "nao aparece antes de
  // ser ensinada": ate a fase 8 nenhuma ocorrencia; na 9 (fase dela) so a partir
  // do chunk de estreia; na 10 (integrada) desde o inicio, porque ja foi
  // ensinada.
  for (let phase = 0; phase <= 8; phase++) {
    for (let chunk = 0; chunk < 40; chunk++) {
      assert.equal(
        getPathogensAt(phase, chunk).includes('ralstonia'), false,
        `fase ${phase}, chunk ${chunk}: Ralstonia antes de ser ensinada`,
      );
    }
  }

  const estreia = getPhaseManifest(9).pathogenDebuts.find(d => d.pathogen === 'ralstonia').fromChunk;
  assert.ok(estreia > 0, 'a estreia nao pode ser no primeiro chunk: o warmup vem antes');
  for (let chunk = 0; chunk < estreia; chunk++) {
    assert.equal(getPathogensAt(9, chunk).includes('ralstonia'), false, `fase 9, chunk ${chunk}`);
  }
  assert.equal(getPathogensAt(9, estreia).includes('ralstonia'), true, 'estreia na fase 9');
  assert.equal(getPathogensAt(10, 0).includes('ralstonia'), true, 'fase 10 ja comeca com ela');
});

test('primeiro encontro é proximidade, não criação distante', () => {
  assert.deepEqual(validateFirstEncounterProximity({ nearbyOrganismCardIds: [] }), []);
  assert.deepEqual(validateFirstEncounterProximity({
    nearbyOrganismCardIds: ['organism-bacillus'],
  }), []);
  assert.equal(tutorialPacing.firstAppearanceEvent, 'first-proximity-encounter');
  assert.equal(tutorialPacing.organismFirstAppearanceBypassesSpatialGate, true);
});

test('dois organismos ainda não explicados no mesmo raio são rejeitados', () => {
  const errors = validateFirstEncounterProximity({
    nearbyOrganismCardIds: ['organism-bacillus', 'organism-trichoderma'],
  });
  assert.equal(errors.length, 1);

  assert.deepEqual(validateFirstEncounterProximity({
    nearbyOrganismCardIds: ['organism-bacillus', 'organism-trichoderma'],
    explainedCardIds: ['organism-bacillus'],
  }), []);
});

test('zonas de estreia não podem compartilhar organismos novos', () => {
  const manifest = cloneManifest();
  const phase = manifest.find(entry => entry.phase === 5);
  const opportunist = phase.presentations.find(p => p.id === 'presentation-opportunistic-fungus');
  const pseudomonas = phase.presentations.find(p => p.id === 'presentation-pseudomonas');
  pseudomonas.debutZoneId = opportunist.debutZoneId;

  assert.match(
    validateCampaignManifest({ manifest, knownCardIds: tutorialCardIds }).join('\n'),
    /mais de um organismo novo na mesma zona de estreia/,
  );
});

test('organismos diferentes não podem compartilhar apresentação', () => {
  const manifest = cloneManifest();
  const presentation = manifest[1].presentations.find(p => p.id === 'presentation-bacillus');
  presentation.triggerIds.push('organism-trichoderma');

  assert.match(
    validateCampaignManifest({ manifest, knownCardIds: tutorialCardIds }).join('\n'),
    /organismos diferentes não podem compartilhar apresentação inicial/,
  );
});

test('cadeias agrupadas desbloqueiam páginas progressivamente', () => {
  const bacillus = getPresentationForTrigger('organism-bacillus');
  assert.deepEqual(bacillus.pageUnlocks, [
    { triggerId: 'organism-bacillus', pages: [0] },
    { triggerId: 'structure-biofilm', pages: [1, 2, 3] },
  ]);
  assert.equal(bacillus.derivedTriggerBehavior, 'guide-only');

  const manifest = cloneManifest();
  const invalid = manifest[1].presentations.find(p => p.id === 'presentation-bacillus');
  invalid.pageUnlocks[0].pages = [0, 1];
  invalid.pageUnlocks[1].pages = [2, 3];
  assert.match(
    validateCampaignManifest({ manifest, knownCardIds: tutorialCardIds }).join('\n'),
    /primeiro encontro deve desbloquear somente a página 0/,
  );
});

test('fungo, Pseudomonas e competição por ferro são apresentações separadas e ordenadas', () => {
  assert.equal(getPresentationForTrigger('organism-opportunistic-fungus')?.id, 'presentation-opportunistic-fungus');
  assert.equal(getPresentationForTrigger('organism-pseudomonas')?.id, 'presentation-pseudomonas');
  assert.deepEqual(
    getPresentationForTrigger('process-iron-competition')?.prerequisitePresentationIds,
    ['presentation-opportunistic-fungus', 'presentation-pseudomonas'],
  );
});

test('integração curricular usa manifesto sem acoplar pools ao fluxo dos cartões', () => {
  assert.match(readFileSync('src/procgen/campaign-progression.js', 'utf8'), /campaign-manifest/);
  assert.match(readFileSync('src/procgen/logic.js', 'utf8'), /campaign-manifest/);
  assert.match(readFileSync('src/procgen/campaign-encounters.js', 'utf8'), /getProceduralPoolAt/);
  assert.match(readFileSync('src/procgen/campaign-encounters.js', 'utf8'), /getRoamingDebutsAt/);
  assert.match(readFileSync('src/procgen/app.js', 'utf8'), /generateCampaignEncounters/);
  assert.match(readFileSync('src/procgen/microbe-roaming.js', 'utf8'), /requiresSeenCardId/);
  assert.match(readFileSync('src/procgen/tutorial-flow.js', 'utf8'), /campaign-manifest/);
  assert.match(readFileSync('src/procgen/tutorial-triggers.js', 'utf8'), /getTutorialModeAt/);

  for (const file of [
    'src/procgen/tutorial-flow.js',
    'src/procgen/tutorial-manager.js',
    'src/procgen/tutorial-triggers.js',
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /getProceduralPoolAt|getTetheredDebutsAt/);
  }
  assert.doesNotMatch(
    readFileSync('src/procgen/app.js', 'utf8'),
    /getTutorialModeAt|campaignEncounterTypes/,
  );
});

test('desbloqueios progressivos apontam para páginas existentes nos cartões reais', () => {
  for (const phase of campaignManifest) {
    for (const presentation of phase.presentations) {
      const card = getTutorialCard(presentation.cardId);
      for (const unlock of presentation.pageUnlocks || []) {
        for (const pageIndex of unlock.pages) {
          assert.ok(card.pages[pageIndex], `${presentation.id}/${unlock.triggerId}: página ${pageIndex}`);
        }
      }
    }
  }
});
