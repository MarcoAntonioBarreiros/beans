// Núcleo puro da murcha vascular (Ralstonia)
// ==========================================
//
// Tudo aqui é função pura: sem DOM, sem canvas, sem estado global. O runtime
// (ralstonia-vascular-wilt.js) usa estas funções e cuida do resto. A separação
// existe para o comportamento da doença ser testável sem montar um nível.
//
// A lição da fase está codificada nos limiares: abaixo de `vascularEntryThreshold`
// o foco ainda está do lado de fora e PODE ser neutralizado; a partir dele a
// bactéria está no xilema e não existe cura — só contenção. Nenhuma função aqui
// devolve um foco vascular ao estado "neutralizado".

// O bundler do projeto e simples: traduz `import { A, B }` para uma
// desestruturacao. Nada de `import { X as Y }` (viraria `const { X as Y }`, que
// nao e sintaxe valida) nem de `export { X }`. Por isso o import e direto e os
// limiares continuam morando no manifesto — quem precisa deles importa de la.
import { RALSTONIA_DEFAULTS } from './campaign-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export const RALSTONIA_STATES = Object.freeze([
  'surface', 'entering', 'vascular', 'obstructed', 'critical', 'contained', 'neutralized',
]);

export const RALSTONIA_STATE_LABELS = Object.freeze({
  surface: 'contaminação superficial',
  entering: 'entrando no tecido',
  vascular: 'colonização vascular',
  obstructed: 'obstrução do xilema',
  critical: 'murcha vascular crítica',
  contained: 'infecção contida',
  neutralized: 'foco neutralizado',
});

// Estado derivado das cargas. `contained` e `neutralized` NÃO são deriváveis
// sozinhos — eles exigem tempo de controle sustentado, então entram como flags
// persistentes decididas pelo runtime e apenas respeitadas aqui.
export function ralstoniaStageForLoads({
  surfaceLoad = 0,
  vascularLoad = 0,
  contained = false,
  neutralized = false,
  config = RALSTONIA_DEFAULTS,
} = {}) {
  if (neutralized) return 'neutralized';
  const vascular = clamp(finite(vascularLoad), 0, 1);
  // Crítico vence a contenção: uma murcha crítica precisa ser lida como crítica
  // mesmo que o jogador tenha contido antes e deixado escapar.
  if (vascular >= config.criticalThreshold) return 'critical';
  if (contained) return 'contained';
  if (vascular >= config.obstructionThreshold) return 'obstructed';
  if (vascular >= config.vascularColonizationThreshold) return 'vascular';
  if (vascular >= config.vascularEntryThreshold) return 'entering';
  return 'surface';
}

// Um foco que já entrou no xilema nunca conta como prevenção.
export function ralstoniaEnteredVascular(focus, config = RALSTONIA_DEFAULTS) {
  return clamp(finite(focus?.vascularLoad), 0, 1) >= config.vascularEntryThreshold
    || Boolean(focus?.everEnteredVascular);
}

// Pressão de ENTRADA: o quanto aquela raiz está aberta para a bactéria. Raiz
// íntegra resiste; ferimento é porta. Some as fontes de lesão do jogo — inclusive
// as de outros patógenos, que é o que torna a fase 10 integrada mais dura.
export function ralstoniaWoundPressure(root) {
  if (!root) return 0;
  const basal = clamp(finite(root.rootGameplayDamage) || (1 - clamp(finite(root.rootHealth, 1), 0, 1)), 0, 1);
  const nematode = clamp(finite(root.meloidogyneBurden), 0, 1);
  const rhizoctonia = clamp(
    Math.max(finite(root.rhizoctoniaColonization), finite(root.rhizoctoniaPressure)),
    0, 1,
  );
  // Só lesão REAL, lida agora. A versão anterior fazia
  // `Math.max(root.ralstoniaEntryWound, ...)` com um marcador autoral de .45
  // gravado na raiz: a porta ficava permanentemente aberta e nem Azospirillum,
  // nem recuperação da saúde, nem controlar Rhizoctonia/Meloidogyne conseguiam
  // fechá-la. O valor inicial da estreia agora vive no FOCO (`woundOpening`) e
  // cicatriza; aqui fica apenas o que a raiz sustenta de fato.
  return clamp(basal * .62 + nematode * .5 + rhizoctonia * .5, 0, 1);
}

// Piso de lesão da raiz: para onde a porta tende enquanto a causa não é
// controlada. É o mesmo número de `ralstoniaWoundPressure`, nomeado pelo papel
// que exerce na dinâmica da porta.
export function ralstoniaLesionFloor(root) {
  return ralstoniaWoundPressure(root);
}

// Fechamento pelo Azospirillum. Ele NÃO ataca a bactéria: promove crescimento
// radicular e cicatrização, então entra como taxa de fechamento da porta.
// Colônia dormente, imatura ou sem vigor não fecha nada.
export function ralstoniaAzospirillumClosure({ colonies = [], lateralRoots = [], root = null } = {}) {
  if (!root) return 0;
  let best = 0;
  for (const colony of colonies) {
    if (!colony || colony.type !== 'azospirillum') continue;
    if (colony.platform !== root) continue;
    if (colony.dormant === true) continue;
    const growth = clamp(finite(colony.growth), 0, 1);
    const vigor = clamp(finite(colony.vigor), 0, 1);
    if (growth < .68 || vigor < .25) continue;
    best = Math.max(best, clamp(vigor * (.55 + growth * .45), 0, 1));
  }
  for (const ladder of lateralRoots) {
    if (!ladder || ladder.host !== root) continue;
    const progress = ladder.developed === true ? 1 : clamp(finite(ladder.visibleProgress), 0, 1);
    if (progress < .35) continue;
    best = Math.max(best, clamp(.4 + progress * .5, 0, 1));
  }
  return best;
}

// Dinâmica da porta de entrada. Puro: recebe o estado, devolve o próximo valor
// e as duas pressões, para o HUD poder explicar o que está acontecendo.
export function ralstoniaWoundDynamics({
  currentOpening = 0,
  rootHealth = 1,
  rootDamage = null,
  meloidogynePressure = 0,
  rhizoctoniaPressure = 0,
  azospirillumClosure = 0,
  dt = 0,
  config = RALSTONIA_DEFAULTS,
} = {}) {
  const opening = clamp(finite(currentOpening), 0, 1);
  const health = clamp(finite(rootHealth, 1), 0, 1);
  const damage = clamp(
    Number.isFinite(rootDamage) ? rootDamage : 1 - health,
    0, 1,
  );
  const nematode = clamp(finite(meloidogynePressure), 0, 1);
  const rhizoctonia = clamp(finite(rhizoctoniaPressure), 0, 1);
  const azo = clamp(finite(azospirillumClosure), 0, 1);

  // Lesão sustentada AGORA. Controlar a causa (Trichoderma sobre Rhizoctonia,
  // controle de Meloidogyne, recuperação da saúde) derruba este piso, e é assim
  // que a porta pode finalmente cicatrizar.
  const lesionFloor = clamp(damage * .62 + nematode * .5 + rhizoctonia * .5, 0, 1);

  // Abre só enquanto a porta está abaixo do que a lesão sustenta.
  const openingPressure = Math.max(0, lesionFloor - opening) * config.woundOpeningRate;
  // Fecha por cicatrização natural + Azospirillum + saúde acima de .55. Uma
  // lesão ativa atrapalha o fechamento, mas nunca o proíbe por completo.
  const closurePressure = (
    config.woundBaseClosureRate
    + azo * config.woundAzospirillumClosureRate
    + Math.max(0, health - .55) * config.woundHealthClosureRate
  ) * (1 - lesionFloor);

  return {
    nextOpening: clamp(opening + finite(dt) * (openingPressure - closurePressure), 0, 1),
    openingPressure,
    closurePressure,
    lesionFloor,
  };
}

// Força de controle combinada. A sinergia é um BÔNUS complementar (soma), nunca
// multiplicação exponencial, e pesa mais antes da entrada — depois que a bactéria
// está no vaso, nenhuma dupla de organismos faz milagre.
export function ralstoniaControlStrength({ bacillus = 0, pseudomonas = 0, stage = 'surface' } = {}) {
  const b = clamp(finite(bacillus), 0, 1);
  const p = clamp(finite(pseudomonas), 0, 1);
  const beforeEntry = stage === 'surface' || stage === 'entering';
  if (beforeEntry) {
    // Bacillus domina a prevenção: a barreira física fica sobre o ferimento.
    return clamp(b * .75 + p * .45 + Math.min(b, p) * .15, 0, 1.25);
  }
  // Depois da entrada a Pseudomonas pesa mais (supressão) e a sinergia encolhe.
  return clamp(b * .38 + p * .62 + Math.min(b, p) * .06, 0, 1.1);
}

// Crescimento LÍQUIDO por segundo, separado em superfície e xilema.
//
// Nenhum controle empurra a carga vascular para baixo de
// `minimumVascularFloorAfterEntry`: conter é segurar, não curar. A superfície,
// essa sim, pode ser zerada — é toda a diferença entre prevenir e remediar.
export function ralstoniaNetGrowth({
  surfaceLoad = 0,
  vascularLoad = 0,
  // `woundOpening` é a porta dinâmica do foco. `woundPressure` continua aceito
  // como alias para não quebrar chamadores/testes anteriores.
  woundOpening = null,
  woundPressure = 0,
  bacillusControl = 0,
  pseudomonasControl = 0,
  config = RALSTONIA_DEFAULTS,
} = {}) {
  const surface = clamp(finite(surfaceLoad), 0, 1);
  const vascular = clamp(finite(vascularLoad), 0, 1);
  const opening = clamp(
    Number.isFinite(woundOpening) ? woundOpening : finite(woundPressure),
    0, 1,
  );
  const stage = ralstoniaStageForLoads({ surfaceLoad: surface, vascularLoad: vascular, config });
  const control = ralstoniaControlStrength({
    bacillus: bacillusControl, pseudomonas: pseudomonasControl, stage,
  });

  // Superfície: a população só prospera sobre uma porta aberta. Quando a porta
  // fecha ela PERDE ADERÊNCIA por conta própria — é isso que permite prevenir
  // com Azospirillum/recuperação, sem exigir Bacillus ou Pseudomonas.
  const surfaceGrowth = config.baseSurfaceGrowth * opening * (1 - surface * .35);
  const naturalSurfaceLoss = config.baseSurfaceLoss * (1 - opening) * (surface + .12);
  const directSurfaceSuppression = control * .085;
  const surfaceRate = surfaceGrowth - naturalSurfaceLoss - directSurfaceSuppression;

  // Entrada no xilema: exige população superficial E porta aberta. Porta
  // praticamente cicatrizada zera a entrada, por mais bactéria que haja fora.
  const entryPressure = surface * opening;
  const sealed = opening <= config.woundSealThreshold;
  const entryRate = (vascular < config.vascularEntryThreshold && !sealed)
    ? Math.max(0, entryPressure * .030 - control * .075)
    : 0;

  // Dentro do vaso a multiplicação é própria: não depende mais da porta.
  const vascularGrowth = vascular >= config.vascularEntryThreshold
    ? vascular * .038 + .006
    : 0;
  // Coeficiente calibrado para dar um GRADIENTE em vez de um ponto sem volta:
  // um organismo forte sozinho segura uma colonização inicial, a obstrução já
  // pede os dois, e a murcha crítica só recua com Bacillus E Pseudomonas bem
  // estabelecidos. Com .062 nem controle quase perfeito vencia o crescimento no
  // estágio crítico — o foco virava irreversível e a fase, injogável.
  const vascularSuppression = vascular >= config.vascularEntryThreshold
    ? control * .075
    : 0;
  const vascularRate = entryRate + vascularGrowth - vascularSuppression;

  return {
    stage,
    control,
    opening,
    sealed,
    surfaceGrowth,
    naturalSurfaceLoss,
    directSurfaceSuppression,
    entryRate,
    surfaceRate,
    vascularRate,
    // O jogador "está segurando" quando o avanço no xilema parou de subir.
    holdingVascular: vascular >= config.vascularEntryThreshold && vascularRate <= 0,
    // E "está prevenindo" quando a superfície está encolhendo antes da entrada.
    holdingSurface: vascular < config.vascularEntryThreshold && surfaceRate < 0,
  };
}

// Transporte remanescente do xilema. É o número que liga a doença a tudo o mais:
// FBN, recuperação, transporte micorrízico e — indiretamente, via saúde da raiz —
// o teto de recarga da Propulsão da Rizósfera.
export function ralstoniaVascularEfficiency({ surfaceLoad = 0, vascularLoad = 0 } = {}) {
  return clamp(
    1 - clamp(finite(vascularLoad), 0, 1) * 0.86 - clamp(finite(surfaceLoad), 0, 1) * 0.08,
    0.08,
    1,
  );
}

// Raiz que pode receber um foco. A raiz FINAL nunca entra: contaminar a chegada
// transformaria a fase num beco sem saída.
export function isRalstoniaRootEligible(root) {
  return Boolean(
    root
    && root.type === 'root'
    && !root.final
    && !root.recovery
    && !root.safetyStep
    && !root.mycorrhizaStructure
    && !root.azospirillumStructure
    && !root.azospirillumLadderStep
    && !root.temporary
    && (root.routeScope !== 'optional' || root.allowOptionalRoutePopulation)
    && Number.isInteger(root.logicIndex)
    && root.w >= 120,
  );
}

// Alvo da disseminação. Determinístico: recebe o `random` de fora, nunca chama
// Math.random. Só raiz FERIDA é contaminável — raiz íntegra resiste mesmo perto.
export function selectRalstoniaSpreadTarget({
  source,
  roots = [],
  config = RALSTONIA_DEFAULTS,
  random = () => 0.5,
  occupied = new Set(),
} = {}) {
  if (!source?.root) return null;
  const origin = source.root.x + source.root.w / 2;
  const candidates = roots.filter(root => {
    if (!isRalstoniaRootEligible(root)) return false;
    if (root === source.root || occupied.has(root)) return false;
    const distance = Math.abs((root.x + root.w / 2) - origin);
    if (distance < config.minimumSpreadDistance || distance > config.maximumSpreadDistance) return false;
    // Sem ferimento não há entrada: a bactéria chega e não coloniza.
    return ralstoniaWoundPressure(root) > 0.12;
  });
  if (!candidates.length) return null;

  // Prefere adiante na rota (o jogador ainda vai passar por lá e pode defender).
  const ordered = candidates.sort((a, b) => {
    const aheadA = a.x > source.root.x ? 0 : 1;
    const aheadB = b.x > source.root.x ? 0 : 1;
    if (aheadA !== aheadB) return aheadA - aheadB;
    return ralstoniaWoundPressure(b) - ralstoniaWoundPressure(a);
  });
  // Sorteio determinístico entre os dois melhores, para não ser sempre o mesmo.
  const pool = ordered.slice(0, Math.min(2, ordered.length));
  return pool[Math.min(pool.length - 1, Math.floor(clamp(random(), 0, .999) * pool.length))];
}

// Proteção da raiz-alvo no momento da chegada. Acima de 0.5 o evento é bloqueado.
export function ralstoniaTargetProtection({ bacillus = 0, pseudomonas = 0 } = {}) {
  return clamp(finite(bacillus) * .7 + finite(pseudomonas) * .5, 0, 1);
}
