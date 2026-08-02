import { createRandom } from './random.js';
import {
  createPhaseVerticalPlan,
  plannedRouteGates,
  ROUTE_GATE_KINDS,
  validatePhaseVerticalPlan,
  verticalBandAt,
} from './phase-vertical-plan.js';
import { generateLogicGraph } from './logic.js';
import { generatePrimitives } from './primitives.js';
import { generateGeometry } from './geometry.js';
import { validateChunk } from './agents.js';
import { evaluateMycorrhizaBridgeCandidate } from './mycorrhiza-bridge-feasibility.js';
import { evaluatePropulsionCrossing } from './propulsion-feasibility.js';
import { getTraversalEncounterTemplate } from './traversal-encounter-templates.js';
import { selectTraversalEncounters } from './traversal-encounter-selector.js';
import { validateTraversalEncounter } from './traversal-encounter-validator.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const lerp = (a, b, t) => a + (b - a) * t;

// Quanto cada passo é puxado para a linha-alvo do plano. 0 seria o ruído puro
// de hoje; 1 apagaria o relevo local e faria a rota virar uma rampa. Medido:
// 0.55 leva a corrida sustentada de 2,6 para acima de 4 passos sem perder a
// variação de degrau a degrau.
const VERTICAL_PLAN_PULL = 0.68;

function traversalLimits(chunk, primitive, index) {
  const requiresDouble = primitive.requires.includes('doubleJump');
  const requiresDash = primitive.requires.includes('dash');
  const isLearning = chunk.isSkillIntro || chunk.allyId || chunk.isCheckpoint;

  if (index < 4) {
    return { minGap: 42, maxGap: 92, maxRise: 28, maxDrop: 58, minWidth: 175 };
  }
  if (isLearning) {
    return { minGap: 45, maxGap: 108, maxRise: 38, maxDrop: 68, minWidth: 185 };
  }
  if (requiresDash) {
    return {
      minGap: 100,
      maxGap: chunk.difficultyTarget === 'hard' ? 288 : 246,
      maxRise: 48,
      maxDrop: 92,
      minWidth: 118,
    };
  }
  if (requiresDouble) {
    return {
      minGap: 78,
      maxGap: chunk.difficultyTarget === 'hard' ? 238 : 205,
      // O salto duplo alcanca ~175px na teoria, mas o vao horizontal consome
      // tempo de subida e o agente nao otimiza o timing do segundo salto. 92px
      // cabe no alcance pratico e elimina as subidas que travavam a rota.
      maxRise: 92,
      maxDrop: 142,
      minWidth: 118,
    };
  }
  return {
    minGap: 45,
    maxGap: chunk.difficultyTarget === 'hard' ? 142 : 122,
    maxRise: chunk.difficultyTarget === 'hard' ? 58 : 46,
    maxDrop: chunk.difficultyTarget === 'hard' ? 96 : 82,
    minWidth: chunk.difficultyTarget === 'hard' ? 102 : 132,
  };
}

function stabilizeGeometry(candidate, previous, chunk, primitive, index, verticalPlan = null) {
  const limits = traversalLimits(chunk, primitive, index);
  const previousEnd = previous.x + previous.w;
  const rawGap = candidate.x - previousEnd;
  const rawDeltaY = candidate.y - previous.y;

  candidate.x = previousEnd + clamp(rawGap, limits.minGap, limits.maxGap);

  // A faixa vem do plano vertical quando ele existe; sem plano é a faixa fixa
  // de sempre, e o resultado é byte a byte o de antes.
  const band = verticalPlan ? verticalBandAt(verticalPlan, index) : null;
  const floorY = band ? band.top : 235;
  const ceilingY = band ? band.bottom : 565;

  // A ORDEM importa. Primeiro mira a faixa, depois aplica o limite do passo:
  // assim o passo nunca excede a física, e quando a faixa se afasta mais do que
  // um salto alcança, a rota leva vários chunks para chegar lá — que é
  // exatamente a corrida sustentada que faltava.
  // Limitar o passo À faixa não bastava: a faixa tem 100 px de altura e o passo
  // médio da fase tem 81 px, então o ruído continuava mandando e a rota
  // serpenteava DENTRO da faixa. O passo agora é puxado em direção à linha-alvo
  // — o acaso continua escolhendo o relevo local, mas quem decide a direção do
  // trecho é o plano.
  // A atração NUNCA briga com a intenção da zona. Sem esta regra, um degrau
  // alto de escada jogava a rota acima da linha-alvo e os chunks seguintes a
  // puxavam de volta para baixo — a escalada era desfeita pelo próprio plano.
  let pulled = previous.y + rawDeltaY;
  if (band) {
    const towardTarget = lerp(pulled, band.target, VERTICAL_PLAN_PULL);
    const climbing = band.verticalIntent === 'climb' || band.verticalIntent === 'recover';
    const descending = band.verticalIntent === 'descend' || band.verticalIntent === 'valley';
    if (climbing && towardTarget > previous.y) pulled = Math.min(pulled, previous.y);
    else if (descending && towardTarget < previous.y) pulled = Math.max(pulled, previous.y);
    else pulled = towardTarget;
  }
  const desiredY = clamp(pulled, floorY, ceilingY);
  candidate.y = previous.y + clamp(desiredY - previous.y, -limits.maxRise, limits.maxDrop);
  if (band) candidate.verticalZoneId = band.zoneId;
  candidate.w = Math.max(candidate.w, limits.minWidth);
  // Espessura uniforme: a faixa antiga (42-88) fazia blocos grossos parecerem
  // muito mais altos do que o topo (onde os pes pousam) realmente esta.
  candidate.h = clamp(candidate.h, 48, 62);
  candidate.logicIndex = index;
  return candidate;
}

// PORTÕES DA ROTA — geometria autoral, fora do pipeline do chunk
// ===============================================================
//
// Três tipos, um mecanismo. A escada de Azospirillum foi o primeiro; ela SOMA
// aos outros dois em vez de substituí-los, e é por isso que os três dividem
// este ramo do laço em vez de cada um ganhar o seu.
//
//   azospirillumAscent — degrau alto demais para saltar (240 a 330 px).
//   mycorrhizaBridge   — vão largo demais para saltar (520 a 610 px), quase
//                        sem desnível porque o runtime da ponte exige |dy|<=68.
//   phosphateWall      — a plataforma é comum; o que fecha a passagem é o
//                        depósito mineral que `app.js` planta sobre ela. Aqui
//                        só se reserva o espaço e se marca o hospedeiro.
//
// A plataforma de um portão NÃO passa por `stabilizeGeometry` nem por
// `validated`. Não é descuido: é a razão de o portão existir.
// `stabilizeGeometry` fecha em `previous.y + clamp(dy, -maxRise, maxDrop)` e
// esmagaria os 250 px em 92; o que sobrasse seria reprovado por `validated` e
// substituído por `createSafeFallback` a `previous.y ± 42`. Duas tentativas
// anteriores morreram exatamente aí.
//
// O precedente é o encontro de travessia, logo acima neste mesmo laço: ele
// também constrói a própria geometria e segue adiante. A diferença é que o
// portão deixa um vão INTRANSPONÍVEL de propósito — quem o abre é a escada de
// Azospirillum, e `isIntentionalDynamicCrossing` o reconhece para a auditoria
// não o ler como falha.
const ROUTE_GATE_HOST_MIN_WIDTH = 168;
// Vão curto de propósito: o degrau fica quase em cima do hospedeiro, então a
// escada sobe reta e a silhueta lê como torre, não como rampa. Também mantém
// `createRecoveryRoots` fora (ela exige vão >= 82 px) — uma raiz de recuperação
// embaixo do portão seria um caminho alternativo.
const ASCENT_GATE_GAP_RANGE = Object.freeze([44, 78]);
const ASCENT_GATE_WIDTH_RANGE = Object.freeze([168, 214]);
// Folga entre o topo do degrau e o teto do envelope da faixa.
const ASCENT_GATE_CEILING_MARGIN = 60;

function buildAscentGatePlatform(previous, gate, rnd, index, band) {
  const [minimumRise, maximumRise] = gate.riseRange;
  const ceiling = (band ? band.floorLimit : 235) + ASCENT_GATE_CEILING_MARGIN;
  const available = previous.y - ceiling;
  // Sem altura para o degrau, não há portão: o chunk volta a ser um chunk
  // comum. Um portão que não sobe o bastante seria saltável — e aí a escada
  // vira decoração.
  if (available < minimumRise) return null;
  const rise = Math.round(clamp(
    lerp(minimumRise, maximumRise, rnd()),
    minimumRise,
    Math.min(maximumRise, available),
  ));
  const gap = Math.round(lerp(ASCENT_GATE_GAP_RANGE[0], ASCENT_GATE_GAP_RANGE[1], rnd()));
  const width = Math.round(lerp(ASCENT_GATE_WIDTH_RANGE[0], ASCENT_GATE_WIDTH_RANGE[1], rnd()));
  return {
    x: previous.x + previous.w + gap,
    y: previous.y - rise,
    w: width,
    h: 54,
    type: 'root',
    logicIndex: index,
    ascentGate: true,
    ascentGateId: `azo-ascent-${index}`,
    ascentGateRise: rise,
    ascentGateMechanic: gate.mechanic,
    verticalZoneId: gate.zoneId,
  };
}

// A ponte de hifas atravessa o vão na horizontal, então o desnível tem de ser
// pequeno: `findBridgeTarget` recusa alvo com |dy| > 68 quando a fase roda em
// `horizontalOnly`, que é o caso da 10. Um portão de ponte com 200 px de
// degrau seria construído e mesmo assim intransponível.
const BRIDGE_GATE_WIDTH_RANGE = Object.freeze([176, 226]);

function buildBridgeGatePlatform(previous, gate, rnd, index, band) {
  const [minimumGap, maximumGap] = gate.gapRange;
  const gap = Math.round(lerp(minimumGap, maximumGap, rnd()));
  const width = Math.round(lerp(BRIDGE_GATE_WIDTH_RANGE[0], BRIDGE_GATE_WIDTH_RANGE[1], rnd()));
  const limit = gate.maximumVerticalDelta;
  // O passo segue a faixa do plano, mas dentro do teto da ponte: a silhueta
  // continua mandando na direção, só que este degrau é quase plano.
  const planned = band ? band.target - previous.y : 0;
  const delta = Math.round(clamp(planned, -limit, limit));
  const y = band
    ? clamp(previous.y + delta, band.floorLimit + 40, band.ceilingLimit - 40)
    : previous.y + delta;
  if (Math.abs(y - previous.y) > limit) return null;
  return {
    x: previous.x + previous.w + gap,
    y,
    w: width,
    h: 54,
    type: 'root',
    logicIndex: index,
    bridgeGate: true,
    bridgeGateId: `myco-bridge-${index}`,
    bridgeGateGap: gap,
    bridgeGateMechanic: gate.mechanic,
    verticalZoneId: gate.zoneId,
  };
}

// O portao de FBN e o unico que ocupa DOIS chunks. A raiz nitrogenada REMOVE a
// plataforma do meio e so o nodulo a devolve, entao a rota precisa de um trio:
// esquerda -> ALVO -> direita, com cada perna saltavel e o vao total nao.
// `nitrogen-root.js` recusava quase toda posicao da rota porque procurava esse
// trio por acaso; aqui ele e construido de proposito.
function buildNitrogenGatePlatform(previous, gate, rnd, index, band, role) {
  const [minimumGap, maximumGap] = gate.landingGapRange;
  const gap = Math.round(lerp(minimumGap, maximumGap, rnd()));
  const [minimumWidth, maximumWidth] = gate.targetWidthRange;
  const width = role === 'target'
    ? Math.round(lerp(minimumWidth, maximumWidth, rnd()))
    : Math.round(lerp(150, 196, rnd()));
  // Quase sem desnivel: o trio tem de ser saltavel perna a perna, e um degrau
  // grande no meio dele trocaria o desafio da FBN por um de salto.
  const planned = band ? band.target - previous.y : 0;
  const y = Math.round(previous.y + clamp(planned, -34, 44));
  return {
    x: previous.x + previous.w + gap,
    y,
    w: width,
    h: 54,
    // O alvo tem de ser RAIZ: e nele que o nodulo nasce. Sem isto o sorteio de
    // 25% de solo do gerador continuaria recusando o portao.
    type: 'root',
    logicIndex: index,
    nitrogenGate: role,
    nitrogenGateId: gate.gateId,
    verticalZoneId: gate.zoneId,
  };
}

function isForgivingChunk(chunk, index) {
  return index < 4 || chunk.isSkillIntro || chunk.allyId || chunk.isCheckpoint || chunk.difficultyTarget !== 'hard';
}

function validated(candidate, previous, primitive, chunk, index) {
  if (!validateChunk(previous, candidate, primitive, 'normal')) return false;
  if (isForgivingChunk(chunk, index) && !validateChunk(previous, candidate, primitive, 'conservative')) return false;
  return true;
}

// Quanto o fallback mira a linha-alvo do plano, e o teto de cada passo. O
// fallback usa `running-jump-short`, então uma subida acima de ~46 px seria
// reprovada pela própria física e a tentativa se perderia.
const FALLBACK_PLAN_PULL = 0.45;
const FALLBACK_PLAN_MAX_RISE = 34;
const FALLBACK_PLAN_MAX_DROP = 58;

// O TERCEIRO clamp absoluto escondido do gerador — o mesmo defeito que o T3c
// tirou da senoide de `geometry.js` e do `[220, 560]`, sobrevivendo aqui.
//
// `y: clamp(..., 250, 555)` teleportava para 250 qualquer rota que estivesse
// acima disso. Como quase metade dos chunks cai neste fallback (medido: 17,6
// de 40 por seed), era ele quem achatava a silhueta — e, com os portões
// ligados, era pior que achatar: um degrau que subia 316 px era desfeito no
// chunk seguinte, de volta a 250, num único passo.
//
// Sem plano, os limites continuam 250/555 e o resultado é byte a byte o de
// hoje. Com plano, o fallback passa a respeitar o envelope e a mirar a faixa,
// como qualquer outro passo.
function createSafeFallback(previous, chunk, primitives, rnd, index, band = null) {
  const basic = primitives.find(p => p.id === 'running-jump-short')
    || primitives.find(p => p.requires.length === 0)
    || primitives[0];

  const floorY = band ? band.floorLimit : 250;
  const ceilingY = band ? band.ceilingLimit : 555;
  // A intenção da zona vale aqui pela mesma razão que vale em
  // `stabilizeGeometry`: um portão deixa a rota bem ACIMA da linha-alvo, e sem
  // esta regra o fallback devolvia 58 px de altura por chunk logo depois dele.
  const climbing = band?.verticalIntent === 'climb' || band?.verticalIntent === 'recover';
  const descending = band?.verticalIntent === 'descend' || band?.verticalIntent === 'valley';
  const plannedDelta = band
    ? clamp(
        (band.target - previous.y) * FALLBACK_PLAN_PULL,
        descending ? -12 : -FALLBACK_PLAN_MAX_RISE,
        climbing ? 22 : FALLBACK_PLAN_MAX_DROP,
      )
    : 0;

  const baseDelta = (rnd() - .5) * (index < 4 ? 24 : 42);
  for (let attempt = 0; attempt < 8; attempt++) {
    const gap = Math.max(28, (index < 4 ? 82 : 102) - attempt * 9);
    const candidate = {
      x: previous.x + previous.w + gap,
      y: clamp(previous.y + plannedDelta + baseDelta * (1 - attempt / 10), floorY, ceilingY),
      w: 185 + rnd() * 55,
      h: 48 + rnd() * 14,
      type: rnd() > .25 ? 'root' : 'soil',
      logicIndex: index,
      repaired: true,
    };
    if (validated(candidate, previous, basic, chunk, index)) return { platform: candidate, primitive: basic };
  }

  return {
    platform: {
      x: previous.x + previous.w + 24,
      y: previous.y,
      w: 230,
      h: 58,
      type: 'root',
      logicIndex: index,
      repaired: true,
    },
    primitive: basic,
  };
}

// Plataformas de recuperacao DECORATIVAS: continuam sendo geradas, mas nascem
// desligadas (invisiveis e nao-solidas) — ver DEFAULT_RECOVERY_PLATFORMS_DISABLED
// em simulator.js. Eram as plataforminhas soltas na parte de baixo dos vaos
// (y 535-620) e o jogador pediu para tira-las.
//
// Por que nao parar de GERAR: (1) elas consomem numeros do gerador aleatorio, e
// pular essas chamadas deslocaria a sequencia inteira da seed, mudando toda a
// geometria ja validada; (2) a demonstracao de Azospirillum da fase 3 escolhe
// justamente uma raiz de recuperacao como hospedeiro — e ao promove-la
// generateAzospirillumRootLadders faz `host.recovery = false`, entao a raiz da
// demonstracao volta a ser solida e visivel. Desligar na origem apagaria a
// demonstracao junto.
function createRecoveryRoots(previous, next, chunk, rnd, index) {
  const previousEnd = previous.x + previous.w;
  const gap = next.x - previousEnd;
  const ordinaryTraversal = !chunk.requires.includes('doubleJump') && !chunk.requires.includes('dash');
  const shouldAdd = (ordinaryTraversal && gap > 104) || index < 3;
  if (!shouldAdd || gap < 82) return [];

  const width = clamp(gap * .52, 82, 138);
  const midpoint = previousEnd + gap * (.48 + (rnd() - .5) * .08);
  const top = clamp(Math.max(previous.y, next.y) + 92 + rnd() * 22, 535, 620);
  return [{
    x: midpoint - width / 2,
    y: top,
    w: width,
    h: 34,
    type: 'root',
    recovery: true,
    logicIndex: index,
  }];
}

const BASIC_TRAVERSAL_PRIMITIVES = Object.freeze([
  { id: 'standing-jump-short', requires: [] },
  { id: 'running-jump-short', requires: [] },
]);

function encounterBaseY(template, previous) {
  if (template.id === 'fork-high-reward-01') {
    // A bifurcação pode ultrapassar os limites verticais históricos. Sua
    // entrada permanece alinhada à rota existente e os limites do mundo são
    // calculados depois de toda a geometria, sem achatar o fork.
    return previous.y;
  }
  // A entrada acompanha a plataforma anterior. A camera vertical atual suporta
  // a rota alta; forcar toda torre para y=420 criava uma queda de ate 185 px
  // antes mesmo da escolha e tornava a entrada dependente da seed.
  const minimum = Math.max(185, -template.minY);
  const maximum = Math.min(530, 620 - template.maxY);
  return clamp(previous.y, minimum, maximum);
}

function instantiateTraversalEncounter({
  template,
  plan,
  previous,
  platforms,
  exudates,
}) {
  const baseX = previous.x + previous.w + 38;
  const baseY = encounterBaseY(template, previous);
  const createdPlatforms = template.blocks.map(definition => {
    const platformId = `${plan.encounterInstanceId}:platform:${definition.id}`;
    return {
      ...definition,
      id: platformId,
      platformId,
      x: baseX + definition.x,
      y: baseY + definition.y,
      logicIndex: plan.logicIndex,
      traversalEncounterId: template.id,
      encounterId: template.id,
      encounterInstanceId: plan.encounterInstanceId,
      optionalTraversal: definition.routeRole === 'optional',
    };
  });
  const entry = createdPlatforms.find(platform => platform.blockRole === 'entry');
  const exit = createdPlatforms.find(platform => platform.blockRole === 'exit');
  const rewardHost = createdPlatforms.find(platform => platform.blockRole === 'route'
    && platform.platformId.endsWith(`:${template.rewardSocket.blockId}`));
  if (!entry || !exit || !rewardHost) return { valid: false, reason: 'incompleteTemplate' };
  const previousReachable = BASIC_TRAVERSAL_PRIMITIVES.some(primitive => (
    validateChunk({ ...previous }, { ...entry }, primitive, 'normal')
  ));
  if (!previousReachable) return { valid: false, reason: 'entryUnreachable' };

  const rewardIds = [];
  const createdRewards = [-18, 18].map((offset, rewardIndex) => {
    const id = `${plan.encounterInstanceId}:reward:${rewardIndex + 1}`;
    rewardIds.push(id);
    return {
      id,
      platform: rewardHost,
      platformId: rewardHost.platformId,
      logicIndex: plan.logicIndex,
      encounterInstanceId: plan.encounterInstanceId,
      optionalReward: true,
      x: rewardHost.x + template.rewardSocket.offsetX + offset,
      y: rewardHost.y + template.rewardSocket.offsetY,
      taken: false,
    };
  });
  const encounter = {
    encounterId: template.id,
    templateId: template.id,
    encounterInstanceId: plan.encounterInstanceId,
    logicIndex: plan.logicIndex,
    entryPlatformId: entry.platformId,
    exitPlatformId: exit.platformId,
    platformIds: createdPlatforms.map(platform => platform.platformId),
    rewardIds,
    generation: template.generation || null,
  };
  const validation = validateTraversalEncounter(
    { platforms: createdPlatforms, exudates: createdRewards },
    encounter,
  );
  if (!validation.valid) return { valid: false, reason: 'templateValidation', validation };

  platforms.push(...createdPlatforms);
  exudates.push(...createdRewards);
  return {
    valid: true,
    encounter: { ...encounter, validation },
    entry,
    exit,
    platformCount: createdPlatforms.length,
  };
}

export function generateLevel(seedString, {
  referenceScreenWorldWidth = 1280,
  referenceScreenWorldHeight = 720,
  suppressTowerSafeFall = false,
  // Silhueta planejada da rota principal. Desligada por padrão: sem plano, a
  // geração é exatamente a que está no ar. O fallback do modo topológico não é
  // um segundo caminho a manter — é a ausência deste.
  verticalPlan: verticalPlanOption = false,
} = {}) {
  const rnd = createRandom(seedString);
  const primitives = generatePrimitives();
  const logic = generateLogicGraph(rnd);

  const platforms = [];
  const debugInfo = [];
  const allies = [];
  const checkpoints = [];
  const enemies = [];
  const hazards = [];
  const crystals = [];
  const exudates = [];
  const traversalEncounters = [];
  const phase = logic[0]?.campaignPhase ?? 1;
  const selection = selectTraversalEncounters({
    logic,
    phase,
    seedValue: seedString,
    suppressTowerSafeFall,
  });
  const traversalPlans = new Map(selection.plans.map(plan => [plan.logicIndex, plan]));
  const traversalEncounterStats = selection.stats;

  // O plano nasce fora do `rnd` do gerador, com semente própria: assim ligá-lo
  // ou desligá-lo não desloca a sequência aleatória de tudo o que vem depois, e
  // a fase clássica continua idêntica à de hoje.
  let verticalPlan = null;
  let verticalPlanViolations = null;
  // Portões de subida: só existem quando o chamador declara `ascentGates`, e o
  // chamador só declara quando a escada de Azospirillum está liberada. Um
  // portão sem a habilidade que o abre é um softlock, não um desafio.
  const routeGateRequests = new Map();
  const routeGates = [];
  let pendingNitrogenGate = null;
  if (verticalPlanOption) {
    const requested = verticalPlanOption === true ? {} : verticalPlanOption;
    verticalPlan = createPhaseVerticalPlan({
      seedValue: seedString,
      phase,
      totalChunks: logic.length,
      baseY: 500,
      familyId: requested.familyId || null,
    });
    verticalPlanViolations = validatePhaseVerticalPlan(verticalPlan);
    if (verticalPlanViolations.length) verticalPlan = null;
    // `ascentGates: true` continua valendo e agora significa TODOS os tipos de
    // portão. Uma lista explícita restringe — é assim que uma fase sem uma das
    // habilidades deixa de pedir o portão que ela não pode abrir.
    const requestedKinds = Array.isArray(requested.gateKinds)
      ? requested.gateKinds
      : requested.ascentGates ? ROUTE_GATE_KINDS : [];
    if (verticalPlan && requestedKinds.length) {
      for (const gate of plannedRouteGates(verticalPlan, { kinds: requestedKinds })) {
        routeGateRequests.set(gate.chunkIndex, gate);
      }
    }
  }

  let prevPlatform = { x: 50, y: 500, w: 240, h: 100, type: 'root', logicIndex: -1 };
  platforms.push(prevPlatform);

  for (let i = 0; i < logic.length; i++) {
    const chunk = logic[i];
    const traversalPlan = traversalPlans.get(i);
    if (traversalPlan) {
      const template = getTraversalEncounterTemplate(traversalPlan.templateId, {
        referenceScreenWorldWidth,
        encounterScreenCount: traversalPlan.encounterScreenCount,
        seedValue: traversalPlan.templateSeed,
        primitives,
      });
      const result = template
        ? instantiateTraversalEncounter({
            template,
            plan: traversalPlan,
            previous: prevPlatform,
            platforms,
            exudates,
          })
        : { valid: false, reason: 'unknownTemplate' };
      if (result.valid) {
        traversalEncounters.push(result.encounter);
        traversalEncounterStats.created++;
        traversalEncounterStats.details ||= [];
        traversalEncounterStats.details.push({
          templateId: traversalPlan.templateId,
          logicIndex: traversalPlan.logicIndex,
          protectedChunkClearance: traversalPlan.protectedChunkClearance ?? null,
          ...result.encounter.validation.metrics,
        });
        debugInfo.push({
          index: i,
          logic: chunk,
          primitive: 'traversal-encounter',
          repairs: 0,
          accepted: true,
          recoveryRoots: 0,
          gap: Math.round(result.entry.x - (prevPlatform.x + prevPlatform.w)),
          traversalEncounterId: traversalPlan.templateId,
          encounterInstanceId: traversalPlan.encounterInstanceId,
          exitPlatformId: result.exit.platformId,
          traversalMetrics: result.encounter.validation.metrics,
        });
        prevPlatform = result.exit;
        continue;
      }
      traversalEncounterStats.fallbacks++;
      traversalEncounterStats.reasons[result.reason] = (
        traversalEncounterStats.reasons[result.reason] || 0
      ) + 1;
      traversalEncounterStats.failureReasons ||= [];
      traversalEncounterStats.failureReasons.push({
        templateId: traversalPlan.templateId,
        logicIndex: traversalPlan.logicIndex,
        encounterScreenCount: traversalPlan.encounterScreenCount ?? null,
        reason: result.reason,
        failureReasons: result.validation?.failureReasons || [],
      });
    }
    let validPrims;

    if (chunk.requires.length > 1) {
      // Chunk de combo: exige a primitiva que usa TODAS as habilidades pedidas
      // (senao cairia numa de habilidade unica e o combo nao aconteceria).
      validPrims = primitives.filter(p => chunk.requires.every(r => p.requires.includes(r)));
      if (validPrims.length === 0) {
        validPrims = primitives.filter(p => p.requires.length > 0 && p.requires.every(r => chunk.requires.includes(r)));
      }
    } else if (chunk.requires.length === 1) {
      validPrims = primitives.filter(p => p.requires.length > 0 && p.requires.every(r => chunk.requires.includes(r)));
    } else {
      validPrims = primitives.filter(p => p.requires.length === 0);
    }
    if (validPrims.length === 0) validPrims = primitives.filter(p => p.requires.length === 0);

    let attempts = 0;
    let nextPlatform = null;
    let accepted = false;
    let prim = null;

    // Fecha o trio da FBN: a plataforma seguinte ao alvo tambem e autoral, ou o
    // vao total nao bate com a conta que `nitrogen-root.js` exige.
    if (pendingNitrogenGate && pendingNitrogenGate.chunkIndex === i - 1) {
      const band = verticalPlan ? verticalBandAt(verticalPlan, i) : null;
      const right = buildNitrogenGatePlatform(prevPlatform, pendingNitrogenGate, rnd, i, band, 'right');
      right.nitrogenGate = 'right';
      nextPlatform = right;
      prim = primitives.find(p => p.id === 'running-jump-short') || primitives[0];
      accepted = true;
      const request = routeGates.find(entry => entry.id === pendingNitrogenGate.gateId);
      if (request) request.rightPlatform = right;
      pendingNitrogenGate = null;
    }

    // Portão da rota: geometria autoral. Fica FORA de `stabilizeGeometry` e de
    // `validated` — ver o comentário sobre `buildAscentGatePlatform`.
    // A saída de um encontro de travessia nunca vira hospedeiro: alargá-la
    // mexeria na geometria que o próprio encontro validou.
    const gateRequest = routeGateRequests.get(i);
    if (gateRequest && !chunk.isSkillIntro && !chunk.allyId
      && !prevPlatform.encounterInstanceId && prevPlatform.logicIndex >= 0) {
      // Alarga o hospedeiro ANTES de medir o vão: a inoculação precisa de
      // superfície, e alargar à direita não afeta o salto que chegou até aqui.
      prevPlatform.w = Math.max(prevPlatform.w, ROUTE_GATE_HOST_MIN_WIDTH);
      const band = verticalPlan ? verticalBandAt(verticalPlan, i) : null;
      const gatePlatform = gateRequest.mechanic === 'mycorrhizaBridge'
        ? buildBridgeGatePlatform(prevPlatform, gateRequest, rnd, i, band)
        : gateRequest.mechanic === 'azospirillumAscent'
          ? buildAscentGatePlatform(prevPlatform, gateRequest, rnd, i, band)
          : gateRequest.mechanic === 'nitrogenRootGate'
            ? buildNitrogenGatePlatform(prevPlatform, { ...gateRequest, gateId: `fbn-gate-${i}` }, rnd, i, band, 'target')
            : null;
      if (gatePlatform) {
        // Escada e ponte exigem hospedeiro de raiz sólida: é dele que a
        // estrutura biológica nasce.
        prevPlatform.type = 'root';
        prevPlatform.recovery = false;
        const isBridge = Boolean(gatePlatform.bridgeGate);
        const isNitrogen = gatePlatform.nitrogenGate === 'target';
        const id = gatePlatform.ascentGateId
          || gatePlatform.bridgeGateId
          || gatePlatform.nitrogenGateId;
        if (isNitrogen) {
          // A ESQUERDA e o hospedeiro do nodulo, e a plataforma DEPOIS do alvo
          // fecha o trio. Ela e reservada agora para o chunk seguinte nao
          // negociar o proprio vao e estragar a conta.
          prevPlatform.nitrogenGate = 'host';
          prevPlatform.nitrogenGateId = id;
          pendingNitrogenGate = { ...gateRequest, gateId: id, chunkIndex: i };
        } else if (isBridge) {
          prevPlatform.bridgeGateHost = true;
          prevPlatform.bridgeGateId = id;
        } else {
          prevPlatform.ascentGateHost = true;
          prevPlatform.ascentGateId = id;
        }
        nextPlatform = gatePlatform;
        prim = primitives.find(p => p.id === 'running-jump-short') || primitives[0];
        accepted = true;
        routeGates.push({
          id,
          kind: gateRequest.mechanic,
          chunkIndex: i,
          zoneId: gateRequest.zoneId,
          mechanic: gateRequest.mechanic,
          rise: gatePlatform.ascentGateRise ?? 0,
          gap: Math.round(gatePlatform.x - (prevPlatform.x + prevPlatform.w)),
          host: prevPlatform,
          destination: gatePlatform,
          hostLogicIndex: prevPlatform.logicIndex,
          destinationLogicIndex: i,
        });
      }
    }

    // `accepted` já é true quando o portão foi construído — não repetir a
    // condição com `!nextPlatform`, que é reavaliada a cada volta e encerraria
    // o laço na PRIMEIRA tentativa, matando as 12 repetições.
    while (attempts < 12 && !accepted) {
      prim = validPrims[Math.floor(rnd() * validPrims.length)];
      const plannedBand = verticalPlan ? verticalBandAt(verticalPlan, i) : null;
      nextPlatform = stabilizeGeometry(
        generateGeometry(chunk, prevPlatform, prim, rnd, plannedBand),
        prevPlatform, chunk, prim, i, verticalPlan,
      );
      accepted = validated(nextPlatform, prevPlatform, prim, chunk, i);
      attempts++;
    }

    if (!accepted) {
      const fallback = createSafeFallback(
        prevPlatform, chunk, primitives, rnd, i,
        verticalPlan ? verticalBandAt(verticalPlan, i) : null,
      );
      nextPlatform = fallback.platform;
      prim = fallback.primitive;
      accepted = true;
    }

    // Parede de fosfato: ao contrário dos outros dois, ela não muda a rota —
    // o depósito mineral se ergue SOBRE a plataforma que o chunk acabou de
    // produzir, seja ela normal ou fallback. Por isso é marcada aqui, depois
    // da geometria, e não num ramo próprio. A parede em si nasce em `app.js`,
    // que é quem conhece `createPhosphateDepositAt` e a colônia de Bacillus.
    if (gateRequest?.mechanic === 'phosphateWall' && !chunk.isSkillIntro
      && !chunk.allyId && !chunk.isCheckpoint && !nextPlatform.ascentGate
      && !nextPlatform.bridgeGate) {
      // O depósito ocupa 58 px na borda direita e precisa de pouso à esquerda
      // dele, senão o jogador cai ao aterrissar.
      nextPlatform.w = Math.max(nextPlatform.w, ROUTE_GATE_HOST_MIN_WIDTH);
      nextPlatform.phosphateWallGate = true;
      nextPlatform.phosphateWallGateId = `phos-wall-${i}`;
      routeGates.push({
        id: nextPlatform.phosphateWallGateId,
        kind: 'phosphateWall',
        chunkIndex: i,
        zoneId: gateRequest.zoneId,
        mechanic: 'phosphateWall',
        rise: 0,
        gap: 0,
        // Hospedeiro e destino são a MESMA plataforma: a parede fecha a saída
        // dela, não o vão até a próxima.
        host: nextPlatform,
        destination: nextPlatform,
        hostLogicIndex: i,
        destinationLogicIndex: i,
      });
    }

    if (chunk.isCheckpoint) {
      nextPlatform.w = Math.max(nextPlatform.w, 180);
      checkpoints.push({
        x: nextPlatform.x + nextPlatform.w / 2,
        y: nextPlatform.y - 10,
        logicIndex: i,
        active: false,
      });
    }

    if (chunk.allyId) {
      nextPlatform.w = Math.max(nextPlatform.w, 190);
      let desc = '';
      let name = '';
      if (chunk.allyId === 'azo') {
        name = 'Ari, o Azospirillum';
        desc = 'Azospirillum está associado ao desenvolvimento radicular. No jogo, ele libera o Impulso Radicular: pressione salto novamente no ar.';
      }
      if (chunk.allyId === 'myco') {
        name = 'Mira, a Micorriza';
        desc = 'As hifas ampliam o volume de solo explorado e ajudam a transportar fósforo e água até a raiz. No jogo, pressione Shift para o Impulso de Hifa.';
      }
      if (chunk.allyId === 'phos-power') {
        name = 'Pulso de solubilização';
        desc = 'Selecione Solubilização P, segure E perto da cepa de Bacillus e solte para disparar no depósito.';
      }
      allies.push({
        id: chunk.allyId,
        x: nextPlatform.x + nextPlatform.w / 2,
        y: nextPlatform.y - 40,
        r: 28,
        taken: false,
        name,
        desc,
        logicIndex: i,
      });
    }

    if (chunk.isPathogenDebut && chunk.pathogenType === 'rhizoctonia') {
      nextPlatform.w = Math.max(nextPlatform.w, 150);
    }

    if (chunk.hasEnemy && nextPlatform.w > 130) {
      const ew = 42;
      const eh = 38;
      enemies.push({
        x: nextPlatform.x + nextPlatform.w / 2,
        y: nextPlatform.y - eh - 10,
        w: ew,
        h: eh,
        vx: 45 + rnd() * 20,
        left: nextPlatform.x + 20,
        right: nextPlatform.x + nextPlatform.w - ew - 20,
        alive: true,
        type: chunk.pathogenType,
        logicIndex: i,
        debut: chunk.isPathogenDebut,
      });
    }

    const recoveryRoots = createRecoveryRoots(prevPlatform, nextPlatform, chunk, rnd, i);
    platforms.push(...recoveryRoots, nextPlatform);
    debugInfo.push({
      index: i,
      logic: chunk,
      primitive: prim.id,
      repairs: attempts,
      accepted,
      recoveryRoots: recoveryRoots.length,
      gap: Math.round(nextPlatform.x - (prevPlatform.x + prevPlatform.w)),
    });
    prevPlatform = nextPlatform;
  }

  const finalWidth = prevPlatform.x + prevPlatform.w + 1000;
  const hazardWidth = 500;
  const numHazards = Math.ceil(finalWidth / hazardWidth);
  for (let i = 0; i < numHazards; i++) {
    hazards.push({ x: i * hazardWidth, y: 674, w: hazardWidth, h: 46 });
  }

  const rootSpacing = 70;
  const numRoots = Math.ceil(finalWidth / rootSpacing);
  const roots = Array.from({ length: numRoots }, (_, i) => ({
    x: i * rootSpacing + rnd() * 60,
    y: 140 + rnd() * 500,
    len: 60 + rnd() * 190,
    ang: -.7 + rnd() * 1.4,
    thick: 1 + rnd() * 3,
    layer: rnd(),
  }));

  const numSpores = Math.min(400, Math.ceil(finalWidth / 25));
  const spores = Array.from({ length: numSpores }, () => ({
    x: rnd() * finalWidth,
    y: 90 + rnd() * 570,
    r: .7 + rnd() * 2.2,
    s: .2 + rnd() * .7,
    p: rnd() * TAU,
  }));

  const lastPlat = platforms[platforms.length - 1];
  const endX = lastPlat.x + lastPlat.w + 500;
  // Sem encontros, mantem exatamente a iteracao historica (inclusive o consumo
  // do RNG) para que as fases 0-9 nao mudem. Na fase 10, a rota opcional recebe
  // apenas os dois recursos autorais do encontro.
  const exudatePlatforms = traversalEncounters.length
    ? getPrimaryTraversalPlatforms({ platforms })
    : platforms;
  for (let i = 2; i < exudatePlatforms.length; i++) {
    const plat = exudatePlatforms[i];
    if (plat.recovery || plat.w < 75 || rnd() >= .35) continue;
    const exudate = {
      logicIndex: plat.logicIndex,
      x: plat.x + 30 + rnd() * Math.max(1, plat.w - 60),
      y: plat.y - 25 - rnd() * 15,
      taken: false,
    };
    if (traversalEncounters.length) {
      exudate.platform = plat;
      exudate.platformId = plat.platformId ?? plat.id ?? null;
    }
    exudates.push(exudate);
  }

  return {
    platforms,
    hazards,
    crystals,
    enemies,
    exudates,
    allies,
    checkpoints,
    roots,
    spores,
    particles: [],
    pulses: [],
    debugInfo,
    verticalPlan,
    verticalPlanViolations,
    verticalPlanRequested: Boolean(verticalPlanOption),
    routeGates,
    // Vista filtrada, mantida porque a escada já é lida por nome em `app.js`,
    // nos testes e no painel de debug. Somar sem quebrar o anterior.
    ascentGates: routeGates.filter(gate => gate.kind === 'azospirillumAscent'),
    primitives,
    endX,
    cameraMaxX: Math.max(0, endX - 1000),
    traversalEncounters,
    traversalEncounterStats,
    referenceScreenWorldWidth,
    referenceScreenWorldHeight,
    // A seed viaja com o nivel: sistemas de runtime que precisam de aleatoriedade
    // deterministica (regeneracao de exsudato, por exemplo) derivam dela em vez
    // de usar Math.random().
    seed: seedString,
  };
}

// Rede de seguranca global contra softlock. Roda DEPOIS de toda a geometria
// (inclusive desafios-tema) e garante que nenhuma travessia da rota fique
// impossivel com as habilidades que o jogador realmente tem na fase. Respeita
// os desafios que exigem a mecanica-tema de proposito (signature challenge,
// escada de Azospirillum, ponte de micorriza) e so repara vaos genuinamente
// intransponiveis, inserindo um degrau de recuperacao validado pela fisica.
// Primitivas que o jogador CONSEGUE executar com as habilidades desbloqueadas.
// Uma travessia so e "impossivel" se NENHUMA delas pousa no destino — validar
// com uma unica primitiva de potencia maxima daria falso-negativo por overshoot
// nos vaos pequenos (a combinacao salto duplo + dash passa longe de um degrau
// feito para salto comum).
export function executablePrimitives(level, abilities = {}) {
  const all = level.primitives || [];
  const usable = all.filter(p => (p.requires || []).every(r => abilities[r]));
  return usable.length ? usable : all.filter(p => (p.requires || []).length === 0);
}

function anyPrimitivePasses(from, to, prims) {
  return prims.some(p => validateChunk(from, to, p, 'normal'));
}

// Igual ao anterior, mas com CÓPIAS das plataformas.
//
// `validateChunk` monta um mini-nível com os objetos que recebe e roda o
// simulador de verdade sobre eles — e o simulador mexe em campos das plataformas
// (a saúde radicular afunda a raiz, por exemplo). Passar os objetos reais fazia a
// checagem deslocar o `y` das plataformas auditadas. Numa AUDITORIA isso é
// inaceitável: ela precisa olhar sem tocar.
function anyPrimitivePassesReadOnly(from, to, prims) {
  const copyFrom = { ...from };
  const copyTo = { ...to };
  return prims.some(p => validateChunk({ ...copyFrom }, { ...copyTo }, p, 'normal'));
}

function isThemedCrossing(prev, next) {
  return Boolean(
    next.signatureChallenge
    || next.azospirillumLadderDestination || next.azospirillumLadderHost
    || prev.azospirillumLadderHost || prev.azospirillumLadderDestination
    || next.mycorrhizaStructure || prev.mycorrhizaStructure
    || next.mycorrhizaIntroDestination || prev.mycorrhizaIntroDestination,
  );
}

// O corredor da prova obrigatoria de Azospirillum vai do HOSPEDEIRO ao BLOCO
// ALTO — e pode ter blocos de solo no meio. Olhar so o par imediatamente
// anterior ao alvo nao basta: um degrau de seguranca inserido entre o hospedeiro
// e um solo intermediario cria um caminho alternativo e desmonta a prova, do
// mesmo jeito que a plataforma de recuperacao desmontava a ponte na fase 4.
//
// A supressao vale SO dentro do corredor registrado e SO depois de a travessia
// com a raiz lateral ter sido validada (o desafio so e registrado quando ela
// passa). Fora dele, a rede global anti-softlock continua inteira.
export function isInsideAzospirillumChallengeCorridor(level, previous, next) {
  const challenge = level?.azospirillumChallenge;
  if (!challenge) return false;
  const { corridorStartLogicIndex: start, corridorEndLogicIndex: end } = challenge;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  const inside = platform => (
    Number.isInteger(platform?.logicIndex)
    && platform.logicIndex >= start
    && platform.logicIndex <= end
  );
  return inside(previous) && inside(next);
}

function buildDebugSafetyStep(prev, next, prims, logicIndex) {
  const previousEnd = prev.x + prev.w;
  const gap = next.x - previousEnd;
  const width = clamp(gap * .5, 96, 150);
  const midX = previousEnd + gap / 2;
  const highY = Math.min(prev.y, next.y);
  const lowY = Math.max(prev.y, next.y);
  // Varre alturas intermediarias: o degrau precisa ser alcancavel de prev e, a
  // partir dele, permitir alcancar next. A fisica confirma cada tentativa.
  for (let t = 0; t <= 6; t++) {
    const y = clamp(lowY - (lowY - highY) * (t / 6) - 8, 235, 610);
    const step = {
      x: clamp(midX - width / 2, previousEnd + 6, next.x - width - 6),
      y,
      w: width,
      h: 54,
      type: 'root',
      recovery: true,
      safetyStep: true,
      logicIndex,
    };
    if (anyPrimitivePasses(prev, step, prims) && anyPrimitivePasses(step, next, prims)) {
      return step;
    }
  }
  return null;
}


// Travessia INTENCIONAL: o vão existe porque a mecânica da fase o criou, e a
// própria mecânica o resolve. Reconhecida por METADADOS, nunca por número de fase.
//
// Reconhece:
//   - portão da raiz nitrogenada (fase 2 e onde mais nitrogenRoot aparecer);
//   - corredor obrigatório de Azospirillum;
//   - ponte micorrízica e sua estreia;
//   - desafios-assinatura;
//   - portões de fósforo;
//   - blocos autorais (fase 1, tutoriais das fases 5 e 6);
//   - estruturas que só surgem depois de uma ação biológica.
export function isIntentionalDynamicCrossing(level, previous, next) {
  // Portão de subida da silhueta, PRIMEIRO de todos: o degrau está 240 a 330 px
  // acima do hospedeiro porque a rota PEDIU essa altura. Só a escada de
  // Azospirillum a vence, e é por isso que ele não é falha de travessia.
  //
  // A ordem importa. Depois de a escada nascer, o hospedeiro ganha
  // `azospirillumLadderHost` e `isThemedCrossing` passa a casar antes,
  // devolvendo `themedCrossing` — verdadeiro, mas genérico demais para quem
  // depura a silhueta.
  //
  // `ascentGateLadderValidated` é exigido, e não é mais um metadado.
  // `validateAndRepairAzospirillumGates` é a única coisa que escreve esse campo,
  // e só depois de inspecionar a escada de verdade: host, destino, monotonia dos
  // degraus, espaçamento e alcance do último degrau. Antes bastavam os
  // metadados de portão baterem — e eles batiam mesmo quando o pedido de escada
  // tinha sido descartado em silêncio, o que transformava um softlock em
  // "travessia intencional" no relatório.
  //
  // Portão sem atestado cai adiante: ou vira `themedCrossing`, ou vira falha
  // ordinária. As duas leituras são preferíveis a uma aprovação falsa.
  if (next.ascentGate && previous.ascentGateHost
    && previous.ascentGateId === next.ascentGateId
    && next.ascentGateLadderValidated === true) {
    return {
      mechanic: 'azospirillumAscentGate',
      expectedBlockedUntilDeveloped: true,
      ascentGateId: next.ascentGateId,
      ascentGateRise: next.ascentGateRise,
    };
  }
  // Portão de ponte: o vão de 520 a 610 px é intransponível de propósito, e
  // quem o fecha é a ponte de hifas. Reconhecido por metadado como o de
  // subida — a regra genérica de `mycorrhizaStructuresAvailable`, mais abaixo,
  // só vale quando a fase inteira tem a habilidade, e este vão existe por
  // pedido da rota, não por acaso.
  if (next.bridgeGate && previous.bridgeGateHost
    && previous.bridgeGateId === next.bridgeGateId) {
    return {
      mechanic: 'mycorrhizaBridgeGate',
      expectedBlockedUntilDeveloped: true,
      bridgeGateId: next.bridgeGateId,
      blockedGapWidth: next.bridgeGateGap,
    };
  }
  if (isThemedCrossing(previous, next)) {
    return { mechanic: 'themedCrossing', expectedBlockedUntilDeveloped: false };
  }
  if (isInsideAzospirillumChallengeCorridor(level, previous, next)) {
    return { mechanic: 'azospirillumCorridor', expectedBlockedUntilDeveloped: true };
  }

  // Portão da raiz nitrogenada: a plataforma-alvo foi REMOVIDA de propósito e só
  // a própria raiz, ao se desenvolver com FBN, devolve a passagem. Casa pelos
  // metadados registrados em `level.nitrogenRoots`.
  for (const root of level.nitrogenRoots || []) {
    const gapStart = root.leftPlatform.x + root.leftPlatform.w;
    const gapEnd = root.rightPlatform.x;
    const relacionado = (
      (previous === root.leftPlatform && next === root.rightPlatform)
      || previous === root.targetPlatform || next === root.targetPlatform
      || (previous.x + previous.w <= gapEnd && next.x >= gapStart)
      || previous.logicIndex === root.hostLogicIndex
      || next.logicIndex === root.targetLogicIndex
    );
    if (relacionado) {
      return {
        mechanic: 'nitrogenRoot',
        expectedBlockedUntilDeveloped: true,
        nitrogenRootId: root.id,
        blockedGapWidth: root.blockedGapWidth,
      };
    }
  }

  // Blocos autorais (fase 1 e tutoriais autorais): a saída do bloco é liberada
  // pela própria conclusão do módulo, não por um degrau global.
  for (const block of level.fixedBlocks || []) {
    if (!block.recoveryPlatform) continue;
    if (previous === block.targetPlatform || previous.fixedBlockId === block.id
      || next.fixedBlockId === block.id
      || (block.recoveryPlatform.logicIndex === next.logicIndex - 1
        && previous.logicIndex <= block.recoveryPlatform.logicIndex)) {
      return {
        mechanic: 'fixedBlockExit',
        expectedBlockedUntilDeveloped: true,
        fixedBlockId: block.id,
      };
    }
  }
  if (previous.authored || next.authored
    || previous.authoredPhaseFive || next.authoredPhaseFive
    || previous.authoredPhaseSix || next.authoredPhaseSix
    || previous.fungalChallenge || next.fungalChallenge
    || previous.phosphateGate || next.phosphateGate) {
    return { mechanic: 'authoredGeometry', expectedBlockedUntilDeveloped: false };
  }
  return null;
}

// AUDITORIA da rota. NÃO modifica nada: não cria plataforma, não muda x/y/w/h,
// não toca em checkpoints, recursos ou RNG. Só olha e relata.
//
// Substitui a antiga `enforceTraversableRoute`, que inseria um degrau
// (`safetyStep`) dentro de qualquer vão que a física julgasse impossível — e por
// isso preenchia justamente os portões intencionais, como o da raiz nitrogenada
// subdesenvolvida da fase 2.
/**
 * A micorriza pode ter sido inoculada ANTES deste ponto da rota?
 *
 * Duas condições, e as duas são de chão, não de ficha de habilidades: o
 * organismo tem de ter sido apresentado, e tem de haver exsudato para
 * inoculá-lo. É o mesmo critério que `preventionAvailableFrom` usa para a
 * Ralstonia — reusado em vez de reinventado.
 */
function mycorrhizaPrerequisiteAt(level, logicIndex) {
  const encounter = (level?.microbeEncounters || [])
    .filter(entry => entry.id === 'myco' && Number.isInteger(entry.logicIndex))
    .map(entry => entry.logicIndex)
    .sort((left, right) => left - right)[0];
  if (!Number.isInteger(encounter)) {
    return { ok: false, reason: 'micorriza-nao-apresentada' };
  }
  if (encounter > logicIndex) return { ok: false, reason: 'micorriza-apresentada-depois-do-vao' };
  const exudate = (level?.exudates || [])
    .filter(entry => Number.isInteger(entry.logicIndex) && entry.logicIndex >= encounter)
    .map(entry => entry.logicIndex)
    .sort((left, right) => left - right)[0];
  if (!Number.isInteger(exudate)) return { ok: false, reason: 'sem-exsudato-para-inocular' };
  if (exudate > logicIndex) return { ok: false, reason: 'exsudato-so-depois-do-vao' };
  return { ok: true, reason: null };
}

export function auditTraversableRoute(level, abilities = {}, options = {}) {
  const result = { ordinaryFailures: [], intentionalCrossings: [], warnings: [] };
  const prims = executablePrimitives(level, abilities);
  if (!prims.length) {
    result.warnings.push({ reason: 'noExecutablePrimitives' });
    return result;
  }
  // Habilidades liberadas DURANTE a fase: um vão depois do desbloqueio não é
  // falha. A rotina antiga só recebia os unlocks do início e por isso lia como
  // impossível um trecho que o jogador atravessaria mais tarde.
  const grantedDuring = options.abilitiesUnlockedDuringPhase || {};
  const primsAfterUnlock = Object.keys(grantedDuring).length
    ? executablePrimitives(level, { ...abilities, ...grantedDuring })
    : prims;

  const route = getPrimaryTraversalPlatforms(level);

  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1];
    const next = route[i];
    if (next.x <= previous.x + previous.w) continue;
    if (anyPrimitivePassesReadOnly(previous, next, prims)) continue;

    const base = {
      previousPlatformId: previous.id ?? null,
      nextPlatformId: next.id ?? null,
      previousLogicIndex: previous.logicIndex,
      nextLogicIndex: next.logicIndex,
      gapWidth: Math.round(next.x - (previous.x + previous.w)),
    };

    const intentional = isIntentionalDynamicCrossing(level, previous, next);
    if (intentional) {
      result.intentionalCrossings.push({ ...base, reason: 'intentionalMechanic', ...intentional });
      continue;
    }
    if (primsAfterUnlock !== prims && anyPrimitivePassesReadOnly(previous, next, primsAfterUnlock)) {
      result.intentionalCrossings.push({
        ...base,
        reason: 'passableAfterInPhaseUnlock',
        mechanic: 'inPhaseUnlock',
        expectedBlockedUntilDeveloped: true,
      });
      continue;
    }
    // Capacidades do jogador que o conjunto de primitivas NÃO modela.
    //
    // As primitivas cobrem salto, salto duplo e dash. Mas a partir da fase 4 o
    // jogador constrói PONTES MICORRÍZICAS sobre vãos, e a partir da fase 5 tem a
    // Propulsão da Rizósfera. Um vão pensado para uma dessas duas é lido como
    // impossível por uma checagem que só conhece pulos.
    //
    // Aqui existiam duas linhas que aceitavam QUALQUER vão impossível:
    //
    //     if (options.mycorrhizaStructuresAvailable) { aceitar; }
    //     if (options.jetpackAvailable) { aceitar; }
    //
    // Isso é uma afirmação sobre a FASE, não sobre o vão. Um vão de 900px cuja
    // margem de partida é solo — onde micorriza nenhuma se instala — era
    // "atravessável por ponte" só porque a habilidade existe em algum lugar da
    // fase. E um vão além do tanque da mochila era "atravessável por propulsão"
    // pelo mesmo motivo. Softlock com carimbo de aprovado.
    //
    // A pergunta passa a ser sobre a TRAVESSIA: esta ponte é construível, esta
    // propulsão alcança. As regras vêm dos validadores compartilhados, que são
    // os mesmos que o runtime e a auditoria de seeds usam.
    if (options.mycorrhizaStructuresAvailable) {
      const verdict = evaluateMycorrhizaBridgeCandidate({
        level, source: previous, target: next,
      });
      // Pré-requisito é parte da viabilidade: habilidade destravada no papel e
      // organismo inalcançável no chão não atravessam nada. Sem micorriza
      // apresentada e sem exsudato ANTES do vão, não há ponte a construir.
      const prerequisite = mycorrhizaPrerequisiteAt(level, previous.logicIndex);
      if (verdict.feasible && prerequisite.ok) {
        result.intentionalCrossings.push({
          ...base,
          reason: 'bridge-feasible',
          mechanic: 'mycorrhizaBridge',
          expectedBlockedUntilDeveloped: true,
          gap: verdict.gap,
          verticalDelta: verdict.dy,
        });
        continue;
      }
      result.ordinaryFailures.push({
        ...base,
        reason: verdict.feasible ? 'bridge-prerequisite-missing' : 'bridge-not-feasible',
        mechanic: 'mycorrhizaBridge',
        detail: verdict.feasible ? prerequisite.reason : verdict.reason,
      });
      continue;
    }
    if (options.jetpackAvailable) {
      const verdict = evaluatePropulsionCrossing({
        from: previous, to: next, unlocks: { jetpack: true },
      });
      if (verdict.feasible) {
        result.intentionalCrossings.push({
          ...base,
          reason: 'propulsion-feasible',
          mechanic: 'jetpack',
          expectedBlockedUntilDeveloped: false,
          rise: verdict.rise,
        });
        continue;
      }
      result.ordinaryFailures.push({
        ...base,
        reason: 'propulsion-not-feasible',
        mechanic: 'jetpack',
        detail: verdict.reason,
      });
      continue;
    }
    result.ordinaryFailures.push({ ...base, reason: 'impassableOrdinaryGap', mechanic: null });
  }
  return result;
}

// FERRAMENTA DE DEPURAÇÃO. Insere degraus dentro de vãos impossíveis.
//
// NUNCA é chamada no gameplay normal, no build publicado nem na campanha: era
// exatamente essa inserção pós-desafio que colocava um bloco embaixo da raiz
// nitrogenada subdesenvolvida da fase 2 e neutralizava o portão da FBN. Existe
// só para o Phase Lab, para inspecionar um vão suspeito sem regenerar a fase.
export function insertDebugSafetySteps(level, abilities = {}) {
  const prims = executablePrimitives(level, abilities);
  if (!prims.length) return [];
  const audit = auditTraversableRoute(level, abilities);
  const inserted = [];
  const route = getPrimaryTraversalPlatforms(level);

  for (const failure of audit.ordinaryFailures) {
    const previous = route.find(p => p.logicIndex === failure.previousLogicIndex);
    const next = route.find(p => p.logicIndex === failure.nextLogicIndex);
    if (!previous || !next) continue;
    const step = buildDebugSafetyStep(previous, next, prims, next.logicIndex);
    if (!step) continue;
    level.platforms.push(step);
    inserted.push(step);
  }
  if (inserted.length) {
    level.safetySteps = [...(level.safetySteps || []), ...inserted];
  }
  return inserted;
}
