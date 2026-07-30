// Manifesto de áudio — Pacote 01
// ==============================
//
// Só dados: caminhos, categorias e volumes. O controlador
// (`src/game-audio.js`) lê daqui, então trocar uma faixa por outra editada
// depois é mudar uma linha, sem tocar em lógica.
//
// O bundler do projeto aceita apenas `export const` / `export function` e
// `import { A, B }` — nada de default export, `export { X }`, `import { X as Y }`
// nem import de JSON. Por isso o manifesto é um módulo JS comum.
//
// Todos os caminhos são relativos à raiz publicada e usam barra normal: o build
// copia `assets/` inteiro para `dist/assets/`, e barra invertida do Windows
// quebraria a URL no navegador.

export const AUDIO_STORAGE_KEY = 'miguelito:audio:v2';
export const AUDIO_STORAGE_VERSION = 2;
// Chave da versão anterior, lida uma vez para migrar quem já abriu o jogo.
export const AUDIO_STORAGE_KEY_V1 = 'miguelito:audio:v1';

// Volumes por barramento. `master` multiplica todos.
//
// A primeira mixagem deixava a caverna quase inaudível e as gotas na frente de
// tudo. O ambiente subiu, as gotas caíram bastante, e o stinger ganhou barramento
// próprio para a vitória não depender do volume dos efeitos comuns.
export const AUDIO_DEFAULTS = Object.freeze({
  master: 1,
  music: 0.35,
  ambience: 0.28,
  drops: 0.055,
  fx: 0.35,
  stinger: 0.55,
});

// Valores da v1, usados só para reconhecer quem NUNCA personalizou o volume.
// Quem mexeu no slider (quando existir) mantém a própria escolha.
export const AUDIO_DEFAULTS_V1 = Object.freeze({
  master: 1,
  music: 0.35,
  ambience: 0.20,
  drops: 0.15,
  fx: 0.35,
});

// Ganhos RELATIVOS das camadas de ambiente. Elas tocam juntas o tempo todo, e
// somar quatro loops em ganho 1.0 vira ruído: a caverna é a base, o resto entra
// como detalhe. `internalRootFlow` é dinâmico (sobe quando Miguelito está sobre
// uma raiz), por isso nasce baixo.
export const AMBIENCE_LAYER_GAINS = Object.freeze({
  caveBase: 0.85,
  caveActivity: 0.35,
  rhizosphereBase: 0.65,
  rhizosphereDetail: 0.28,
  internalRootFlow: 0.035,
});

// Alvos do fluxo interno da raiz.
export const INTERNAL_ROOT_FLOW = Object.freeze({
  onRoot: 0.10,
  offRoot: 0.035,
  phaseNineBonus: 0.03,
  maximum: 0.12,
  rampSeconds: 0.5,
});

// Janela entre gotas e variações permitidas. A variação é estética e usa um RNG
// próprio do controlador — nunca o RNG da campanha, que decide geometria.
export const DROP_SCHEDULE = Object.freeze({
  minimumSeconds: 7,
  maximumSeconds: 20,
  // A primeira gota espera: cair logo no primeiro segundo, junto com o fade-in
  // da música, soava como um erro de reprodução.
  firstDelaySeconds: 5,
  gainMinimum: 0.65,
  gainMaximum: 0.85,
  panMinimum: -0.40,
  panMaximum: 0.40,
  rateMinimum: 0.97,
  rateMaximum: 1.03,
});

export const MUSIC_CROSSFADE_SECONDS = 1.5;
export const MUSIC_FIRST_FADE_SECONDS = 0.8;
// Redução aplicada a música e ambiente quando um cartão de tutorial está aberto,
// durante o respawn e no encerramento.
export const DUCK_LEVELS = Object.freeze({
  tutorial: 0.65,
  respawning: 0.45,
  end: 0.35,
  // Durante a vitória o ambiente fica discreto, mas não some: o silêncio total
  // faria a transição parecer um travamento.
  victoryAmbience: 0.60,
});

// Fade da supressão da música quando a fase termina.
export const MUSIC_SUPPRESSION_SECONDS = 0.5;
// Fade do stinger ao entrar na próxima fase.
export const STINGER_FADE_SECONDS = 0.5;

// Espera entre concluir a fase e carregar a próxima.
//
// Eram 3,4 s — e o stinger de vitória tem 10,24 s, então ele era cortado logo no
// começo. 7,5 s deixa a frase musical respirar sem parar o jogo por muito tempo.
// O arquivo NÃO foi editado; só a espera mudou.
// Espera usada quando NÃO existe áudio de vitória (mudo, OGG que falhou,
// AudioContext indisponível). Com áudio, quem decide o momento é o evento
// `ended` do stinger — o arquivo tem 10,24 s e não deve ser cortado.
export const PHASE_VICTORY_TRANSITION_SECONDS = 3.4;
export const PHASE_VICTORY_TOAST_SECONDS = 3.2;
// Rede de segurança: se o `ended` nunca chegar (mídia travada), a fase avança
// assim mesmo. Não corta a reprodução normal de 10,24 s.
export const VICTORY_AUDIO_FALLBACK_SECONDS = 12;

const MUSIC = 'assets/audio/music/';
const AMBIENCE = 'assets/audio/ambience/';
const DROPS = 'assets/audio/ambience/drops/';
const FX = 'assets/audio/fx/';

// Faixas do Pacote 01.
//
// Só as versões `_loop` entram no runtime: as `_full` ficam guardadas no ZIP
// como fonte de edição e não são publicadas nesta etapa. Nenhum WAV entra.
const CORE_TRACKS = Object.freeze({
  // ---- Música (streaming, uma por vez, com crossfade) ---------------------
  musicTitle: Object.freeze({
    id: 'musicTitle',
    src: `${MUSIC}music_title_menino_da_rizosfera_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicRhizobium: Object.freeze({
    id: 'musicRhizobium',
    src: `${MUSIC}music_rhizobium_symbiosis_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicAzospirillum: Object.freeze({
    id: 'musicAzospirillum',
    src: `${MUSIC}music_azospirillum_growth_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicMycorrhiza: Object.freeze({
    id: 'musicMycorrhiza',
    src: `${MUSIC}music_mycorrhiza_network_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicPseudomonas: Object.freeze({
    id: 'musicPseudomonas',
    src: `${MUSIC}music_pseudomonas_iron_competition_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicBacillus: Object.freeze({
    id: 'musicBacillus',
    src: `${MUSIC}music_bacillus_biofilm_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicRhizoctonia: Object.freeze({
    id: 'musicRhizoctonia',
    src: `${MUSIC}music_rhizoctonia_threat_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicMeloidogyne: Object.freeze({
    id: 'musicMeloidogyne',
    src: `${MUSIC}music_meloidogyne_infestation_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),
  musicRalstonia: Object.freeze({
    id: 'musicRalstonia',
    src: `${MUSIC}music_ralstonia_vascular_wilt_loop.ogg`,
    kind: 'music',
    loop: true,
    defaultGain: 1,
    preload: 'metadata',
  }),

  // ---- Ambiente (camadas contínuas, nunca reiniciadas por fase) -----------
  ambienceCaveBase: Object.freeze({
    id: 'ambienceCaveBase',
    src: `${AMBIENCE}ambience_cave_base_loop.ogg`,
    kind: 'ambience',
    loop: true,
    defaultGain: AMBIENCE_LAYER_GAINS.caveBase,
    preload: 'auto',
  }),
  ambienceCaveActivity: Object.freeze({
    id: 'ambienceCaveActivity',
    src: `${AMBIENCE}ambience_cave_activity_loop.ogg`,
    kind: 'ambience',
    loop: true,
    defaultGain: AMBIENCE_LAYER_GAINS.caveActivity,
    preload: 'auto',
  }),
  ambienceRhizosphereBase: Object.freeze({
    id: 'ambienceRhizosphereBase',
    src: `${AMBIENCE}ambience_rhizosphere_base_loop.ogg`,
    kind: 'ambience',
    loop: true,
    defaultGain: AMBIENCE_LAYER_GAINS.rhizosphereBase,
    preload: 'auto',
  }),
  ambienceRhizosphereDetail: Object.freeze({
    id: 'ambienceRhizosphereDetail',
    src: `${AMBIENCE}ambience_rhizosphere_detail_loop.ogg`,
    kind: 'ambience',
    loop: true,
    defaultGain: AMBIENCE_LAYER_GAINS.rhizosphereDetail,
    preload: 'auto',
  }),
  ambienceInternalRootFlow: Object.freeze({
    id: 'ambienceInternalRootFlow',
    src: `${AMBIENCE}ambience_internal_root_flow_loop.ogg`,
    kind: 'ambience',
    loop: true,
    defaultGain: AMBIENCE_LAYER_GAINS.internalRootFlow,
    preload: 'auto',
  }),

  // ---- Gotas com eco (uma por vez, sorteadas) ----------------------------
  dropEco01: Object.freeze({ id: 'dropEco01', src: `${DROPS}gota_eco_01.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco02: Object.freeze({ id: 'dropEco02', src: `${DROPS}gota_eco_02.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco03: Object.freeze({ id: 'dropEco03', src: `${DROPS}gota_eco_03.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco04: Object.freeze({ id: 'dropEco04', src: `${DROPS}gota_eco_04.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco05: Object.freeze({ id: 'dropEco05', src: `${DROPS}gota_eco_05.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco06: Object.freeze({ id: 'dropEco06', src: `${DROPS}gota_eco_06.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco07: Object.freeze({ id: 'dropEco07', src: `${DROPS}gota_eco_07.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),
  dropEco08: Object.freeze({ id: 'dropEco08', src: `${DROPS}gota_eco_08.ogg`, kind: 'drop', loop: false, defaultGain: 1, preload: 'auto' }),

  // ---- Efeitos curtos (AudioBuffer, decodificados uma vez) ---------------
  playerJump: Object.freeze({
    id: 'playerJump',
    src: `${FX}fx_player_jump.ogg`,
    kind: 'fx',
    loop: false,
    // ~7 dB abaixo do original. O salto é a ação mais repetida do jogo: em
    // ganho 1 ele cansava depois de poucos minutos. O arquivo não foi tocado.
    defaultGain: 0.45,
    preload: 'auto',
  }),
  playerDamage: Object.freeze({
    id: 'playerDamage',
    src: `${FX}fx_player_damage_arcade.ogg`,
    kind: 'fx',
    loop: false,
    defaultGain: 1,
    preload: 'auto',
  }),
  // Alternativo de 6s: fica disponível para comparação no Phase Lab, mas NÃO é
  // tocado junto com o arcade. Empilhar os dois a cada contato vira ruído.
  playerDamageAlt: Object.freeze({
    id: 'playerDamageAlt',
    src: `${FX}fx_player_damage_alt.ogg`,
    kind: 'stinger',
    loop: false,
    defaultGain: 1,
    preload: 'none',
  }),
  healthLost: Object.freeze({
    id: 'healthLost',
    src: `${FX}fx_health_lost.ogg`,
    kind: 'fx',
    loop: false,
    defaultGain: 1,
    preload: 'auto',
  }),
  gameOver: Object.freeze({
    id: 'gameOver',
    src: `${FX}fx_game_over.ogg`,
    kind: 'fx',
    loop: false,
    defaultGain: 1,
    preload: 'auto',
  }),

  // ---- Stingers longos (mídia, não AudioBuffer) --------------------------
  // 10,24 s e 35,84 s: decodificar isso como buffer curto desperdiça memória no
  // celular sem ganho nenhum de latência.
  phaseVictory: Object.freeze({
    id: 'phaseVictory',
    src: `${FX}fx_phase_victory_short.ogg`,
    kind: 'stinger',
    loop: false,
    defaultGain: 1,
    preload: 'metadata',
  }),
  campaignVictory: Object.freeze({
    id: 'campaignVictory',
    src: `${FX}fx_results_victory_long.ogg`,
    kind: 'stinger',
    loop: false,
    defaultGain: 1,
    preload: 'none',
  }),
});

// ===========================================================================
// PACOTE 04 — PROCESSOS BIOLÓGICOS BENÉFICOS
// ===========================================================================
//
// 40 arquivos: 28 efeitos pontuais (`fx_*`) e 12 loops (`loop_*`). Todos vivem
// em `assets/audio/fx/`.
//
// `preload: 'group'` é o que impede estes 40 arquivos de atrasarem a abertura da
// página: `preloadShortFx()` (chamado no `init`) só carrega `preload === 'auto'`,
// então nada daqui é buscado no primeiro quadro. Quem decide o momento é
// `preloadBiologicalGroup(groupId)`, chamado por fase, mais lazy-load defensivo
// no primeiro uso.
//
// `group` é a chave de PRELOAD (por organismo). O limite de vozes usa outra
// chave, mais fina (`BIOLOGICAL_LOOP_LIMITS`), porque um mesmo organismo tem
// processos que competem de forma diferente — biofilme e antibiose, por exemplo.

// Classe de ENTREGA de cada efeito pontual.
//
//   'critical'   transição única que não pode sumir. Se o buffer ainda estiver
//                a caminho, o pedido entra numa fila e toca quando chegar (até
//                1,5 s). É o que impede o primeiro efeito de uma fase de
//                desaparecer só porque o arquivo demorou.
//   'transient'  pode ser descartado se chegar tarde: são os repetitivos, que
//                já têm cooldown e cuja ausência isolada não apaga informação.
//
// Loops não usam isto: eles têm o próprio ciclo de pendência por instância.
const CRITICAL_DELIVERY = new Set([
  'rhizobiumRecognition', 'rhizobiumRootHairCurl', 'rhizobiumPrimordium',
  'rhizobiumYoungNodule', 'rhizobiumMatureNodule', 'nitrogenRootComplete',
  'azospirillumRootGrowthStart', 'azospirillumLadderComplete',
  'mycorrhizaGermination', 'mycorrhizaRootContact', 'mycorrhizaArbusculeComplete',
  'mycorrhizaBridgeStart', 'mycorrhizaBridgeComplete',
  'bacillusAdhesion', 'bacillusBiofilmComplete', 'bacillusSporulation', 'bacillusGermination',
  'pseudomonasIronBind', 'pseudomonasIronDelivery',
  'trichodermaTargetContact', 'trichodermaControlComplete', 'trichodermaReactivation',
  'phosphatePulseRelease', 'phosphateDepositComplete', 'phosphateRootDeliveryComplete',

  // Pacote 03. Seleção e coleta ficam de fora: são repetíveis, e uma coleta sem
  // som isolada não apaga informação nenhuma. Estes seis são transições únicas —
  // uma inoculação ou um checkpoint não pode ficar mudo porque o buffer atrasou.
  'exudateRelease', 'microbeDiscovery', 'microbeRecruitment',
  'inoculationPlace', 'colonyEstablished', 'checkpointActivation',
]);

// Quanto tempo um pedido crítico espera pelo próprio buffer.
export const CRITICAL_FX_QUEUE_SECONDS = 1.5;

export function fxDeliveryClass(trackId) {
  return CRITICAL_DELIVERY.has(trackId) ? 'critical' : 'transient';
}

const BIOLOGICAL_TRACK_DEFS = [
  // ---- Rhizobium, nodulação e nitrogênio ----------------------------------
  ['rhizobiumRecognition', 'fx_rhizobium_recognition', 'fx', 0.42, 'rhizobium'],
  ['rhizobiumRootHairCurl', 'fx_rhizobium_root_hair_curl', 'fx', 0.42, 'rhizobium'],
  ['rhizobiumInfectionThread', 'loop_rhizobium_infection_thread', 'loop', 0.18, 'rhizobium'],
  ['rhizobiumPrimordium', 'fx_rhizobium_primordium', 'fx', 0.36, 'rhizobium'],
  ['rhizobiumYoungNodule', 'fx_rhizobium_young_nodule', 'fx', 0.40, 'rhizobium'],
  ['rhizobiumMatureNodule', 'fx_rhizobium_mature_nodule_complete', 'fx', 0.62, 'rhizobium'],
  ['nitrogenFixationActive', 'loop_nitrogen_fixation_active', 'loop', 0.11, 'rhizobium'],
  ['nitrogenRootGrowth', 'loop_nitrogen_root_growth', 'loop', 0.20, 'rhizobium'],
  ['nitrogenRootComplete', 'fx_nitrogen_root_complete', 'fx', 0.58, 'rhizobium'],

  // ---- Azospirillum e raízes laterais -------------------------------------
  ['azospirillumRootGrowthStart', 'fx_azospirillum_root_growth_start', 'fx', 0.42, 'azospirillum'],
  ['azospirillumRootGrowth', 'loop_azospirillum_root_growth', 'loop', 0.16, 'azospirillum'],
  ['azospirillumStepMature', 'fx_azospirillum_step_mature', 'fx', 0.32, 'azospirillum'],
  ['azospirillumLadderComplete', 'fx_azospirillum_ladder_complete', 'fx', 0.56, 'azospirillum'],

  // ---- Micorriza: germinação, hifas, arbúsculos e ponte -------------------
  ['mycorrhizaGermination', 'fx_mycorrhiza_germination', 'fx', 0.40, 'mycorrhiza'],
  ['mycorrhizaHyphaGrowth', 'loop_mycorrhiza_hypha_growth', 'loop', 0.14, 'mycorrhiza'],
  ['mycorrhizaRootContact', 'fx_mycorrhiza_root_contact', 'fx', 0.38, 'mycorrhiza'],
  ['mycorrhizaArbusculeComplete', 'fx_mycorrhiza_arbuscule_complete', 'fx', 0.46, 'mycorrhiza'],
  ['mycorrhizaBridgeStart', 'fx_mycorrhiza_bridge_start', 'fx', 0.42, 'mycorrhiza'],
  ['mycorrhizaBridgeGrowth', 'loop_mycorrhiza_bridge_growth', 'loop', 0.16, 'mycorrhiza'],
  ['mycorrhizaBridgeComplete', 'fx_mycorrhiza_bridge_complete', 'fx', 0.58, 'mycorrhiza'],

  // ---- Bacillus e biofilme ------------------------------------------------
  ['bacillusAdhesion', 'fx_bacillus_adhesion', 'fx', 0.42, 'bacillus'],
  ['bacillusBiofilmGrowth', 'loop_bacillus_biofilm_growth', 'loop', 0.17, 'bacillus'],
  ['bacillusBiofilmComplete', 'fx_bacillus_biofilm_complete', 'fx', 0.58, 'bacillus'],
  ['bacillusAntibiosis', 'loop_bacillus_antibiosis', 'loop', 0.09, 'bacillus'],
  ['bacillusSporulation', 'fx_bacillus_sporulation', 'fx', 0.43, 'bacillus'],
  ['bacillusGermination', 'fx_bacillus_germination', 'fx', 0.44, 'bacillus'],

  // ---- Pseudomonas e sideróforos ------------------------------------------
  ['pseudomonasSiderophoreLaunch', 'fx_pseudomonas_siderophore_launch', 'fx', 0.30, 'pseudomonas'],
  ['pseudomonasIronBind', 'fx_pseudomonas_iron_bind', 'fx', 0.42, 'pseudomonas'],
  ['pseudomonasIronDelivery', 'fx_pseudomonas_iron_delivery', 'fx', 0.44, 'pseudomonas'],
  ['pseudomonasSuppression', 'loop_pseudomonas_suppression', 'loop', 0.08, 'pseudomonas'],

  // ---- Trichoderma ---------------------------------------------------------
  ['trichodermaHyphalAttack', 'loop_trichoderma_hyphal_attack', 'loop', 0.13, 'trichoderma'],
  ['trichodermaTargetContact', 'fx_trichoderma_target_contact', 'fx', 0.36, 'trichoderma'],
  ['trichodermaControlComplete', 'fx_trichoderma_control_complete', 'fx', 0.52, 'trichoderma'],
  ['trichodermaReactivation', 'fx_trichoderma_reactivation', 'fx', 0.44, 'trichoderma'],

  // ---- Solubilização e transporte de fósforo -------------------------------
  ['phosphateCharge', 'loop_phosphate_charge', 'loop', 0.16, 'phosphate'],
  ['phosphatePulseRelease', 'fx_phosphate_pulse_release', 'fx', 0.58, 'phosphate'],
  ['phosphateDissolvePartial', 'fx_phosphate_dissolve_partial', 'fx', 0.34, 'phosphate'],
  ['phosphateDepositComplete', 'fx_phosphate_deposit_complete', 'fx', 0.56, 'phosphate'],
  ['phosphateTransport', 'loop_phosphate_transport', 'loop', 0.14, 'phosphate'],
  ['phosphateRootDeliveryComplete', 'fx_phosphate_root_delivery_complete', 'fx', 0.52, 'phosphate'],
];

export const BIOLOGICAL_TRACKS = Object.freeze(Object.fromEntries(
  BIOLOGICAL_TRACK_DEFS.map(([id, file, kind, defaultGain, group]) => [id, Object.freeze({
    id,
    src: `${FX}${file}.ogg`,
    kind,
    loop: kind === 'loop',
    defaultGain,
    group,
    // Nunca 'auto': o Pacote 04 não pode atrasar o primeiro quadro.
    preload: 'group',
  })]),
));

// ===========================================================================
// PACOTE 03 — INTERAÇÕES
// ===========================================================================
//
// Dez efeitos pontuais, nenhum loop. Vão pelo barramento GERAL de efeitos
// (`fxGain`), não pelo biológico: seleção é interface, coleta e inoculação são
// ações diretas do jogador e checkpoint é feedback de gameplay. Nenhum deles
// pode subir ou descer junto com `BIOLOGICAL_BUS_SCALE`, que existe para
// equilibrar a camada de processos do Pacote 04.
//
// `preload: 'auto'` em todos: são dez arquivos curtos (117 KB somados) que podem
// acontecer no primeiro segundo da fase. Adiar isso para um preload por
// organismo só criaria o defeito que o Pacote 04 já teve — o primeiro som
// sumindo por buffer atrasado.
const INTERACTION_TRACK_DEFS = [
  ['uiSelectionCycle', 'fx_ui_selection_cycle', 0.70],
  ['exudatePickup01', 'fx_exudate_pickup_01', 0.90],
  ['exudatePickup02', 'fx_exudate_pickup_02', 0.90],
  ['exudatePickup03', 'fx_exudate_pickup_03', 0.90],
  ['exudateRelease', 'fx_exudate_release', 1.00],
  ['microbeDiscovery', 'fx_microbe_discovery', 1.00],
  ['microbeRecruitment', 'fx_microbe_recruitment', 0.95],
  ['inoculationPlace', 'fx_inoculation_place', 1.00],
  ['colonyEstablished', 'fx_colony_established', 0.95],
  ['checkpointActivation', 'fx_checkpoint_activation', 1.00],
];

export const INTERACTION_TRACKS = Object.freeze(Object.fromEntries(
  INTERACTION_TRACK_DEFS.map(([id, file, defaultGain]) => [id, Object.freeze({
    id,
    src: `${FX}${file}.ogg`,
    kind: 'fx',
    loop: false,
    defaultGain,
    preload: 'auto',
  })]),
));

// As três variações de coleta, na ordem da rotação 01 → 02 → 03 → 01.
export const EXUDATE_PICKUP_TRACKS = Object.freeze([
  'exudatePickup01', 'exudatePickup02', 'exudatePickup03',
]);

// Só estes contam como descoberta de organismo. Fitohormônios (power-jump,
// power-dash, power-pulse) e o solubilizador de fosfato (`phos`) passam pelo
// mesmo `discoverMicrobe`, mas não são micróbios que o jogador "encontra".
export const DISCOVERABLE_MICROBE_IDS = Object.freeze([
  'rhizobium', 'azospirillum', 'bacillus', 'pseudomonas', 'myco',
  'trichoderma', 'oportunista', 'rhizoctonia', 'meloidogyne', 'ralstonia',
]);

// Limiar de ADERÊNCIA da colônia — não de função. Fica bem abaixo dos limiares
// funcionais do Pacote 04 (.65 / .68 / .72 / 1) de propósito: `colonyEstablished`
// diz "pegou e vai ficar", enquanto nódulo, biofilme maduro e ponte dizem "a
// função biológica começou". Confundir os dois faria dois sons no mesmo instante.
export const COLONY_ESTABLISHMENT_GROWTH = 0.30;

export const AUDIO_TRACKS = Object.freeze({
  ...CORE_TRACKS,
  ...BIOLOGICAL_TRACKS,
  ...INTERACTION_TRACKS,
});

// Grupos de PRELOAD, por organismo.
export const BIOLOGICAL_AUDIO_GROUPS = Object.freeze(
  BIOLOGICAL_TRACK_DEFS.reduce((groups, [id, , , , group]) => {
    (groups[group] = groups[group] || []).push(id);
    return groups;
  }, {}),
);

// Barramento próprio, escalado pelo volume de efeitos. Não é um slider novo: os
// processos são efeitos, e o jogador que abaixar FX abaixa a rizosfera junto.
export const BIOLOGICAL_BUS_SCALE = 1.25;
// Cartão de tutorial aberto: os processos recuam, mas não somem (§16 — não
// destruir loops, só abaixar).
export const BIOLOGICAL_TUTORIAL_DUCK = 0.30;

export const BIOLOGICAL_SPATIAL = Object.freeze({
  // Alcance padrão de um processo do mundo, em pixels de mundo. A tela tem
  // 1280 px, então 760 cobre a área visível relevante e um pouco além.
  defaultRange: 760,
  // Denominador do pan, como fração da largura da tela.
  panWidthFactor: 0.55,
  panLimit: 0.80,
  // Um loop que fica inaudível por mais que isto tem o source encerrado; o
  // processo continua vivo e o loop volta se a câmera voltar.
  inaudibleGraceSeconds: 2,
  // Expoente da atenuação por distância.
  //
  // Era 2 (quadrática). Combinado com ganhos-base de 0,08 a 0,20, isso apagava
  // os processos discretos bem antes da borda da tela: a 300 px de um alcance de
  // 620, um loop de 0,08 caía para 0,027 — abaixo do piso de audibilidade, e o
  // som simplesmente não existia numa distância em que o jogador VÊ o processo
  // acontecendo. 1,4 mantém a queda perceptível sem apagar a camada.
  attenuationExponent: 1.4,
  // Piso de audibilidade. Baixado junto: com o expoente novo, 0,02 ainda
  // recortaria os loops mais discretos (antibiose 0,09, supressão 0,08).
  minimumAudibleGain: 0.006,
});

export const BIOLOGICAL_FADES = Object.freeze({
  start: 0.22,
  stop: 0.26,
  pause: 0.12,
  resume: 0.18,
});

// Teto global e por grupo de vozes. O grupo aqui é o PROCESSO, mais fino que o
// grupo de preload: biofilme e antibiose são do mesmo organismo e competem
// separadamente.
export const BIOLOGICAL_LOOP_LIMIT = 8;
export const BIOLOGICAL_LOOP_LIMITS = Object.freeze({
  'rhizobium-thread': 2,
  'nitrogen-fixation': 1,
  'nitrogen-root-growth': 1,
  'azospirillum-growth': 2,
  'mycorrhiza-hypha': 2,
  'mycorrhiza-bridge': 1,
  'bacillus-biofilm': 2,
  'bacillus-antibiosis': 1,
  'pseudomonas-suppression': 1,
  'trichoderma-attack': 2,
  'phosphate-charge': 1,
  'phosphate-transport': 2,
});

// Quem sobrevive quando o teto global é atingido. Maior vence.
export const BIOLOGICAL_LOOP_PRIORITY = Object.freeze({
  'phosphate-charge': 8,
  'mycorrhiza-bridge': 7,
  'nitrogen-root-growth': 7,
  'azospirillum-growth': 6,
  'trichoderma-attack': 6,
  'phosphate-transport': 5,
  'rhizobium-thread': 4,
  'bacillus-biofilm': 4,
  'mycorrhiza-hypha': 3,
  'bacillus-antibiosis': 2,
  'pseudomonas-suppression': 2,
  'nitrogen-fixation': 1,
});

// Cooldowns dos efeitos PONTUAIS. `perInstance` é por objeto (colônia, rede,
// depósito); `global` é para o jogo inteiro. Conclusões únicas não entram aqui:
// elas já são protegidas por uma marca de transição e não podem ser engolidas.
export const BIOLOGICAL_COOLDOWNS = Object.freeze({
  pseudomonasSiderophoreLaunch: Object.freeze({ perInstance: 0.40, global: 0.12 }),
  mycorrhizaRootContact: Object.freeze({ perInstance: 0.18, global: 0 }),
  azospirillumStepMature: Object.freeze({ perInstance: 0.10, global: 0 }),
  phosphateDissolvePartial: Object.freeze({ perInstance: 0.18, global: 0 }),
  pseudomonasIronBind: Object.freeze({ perInstance: 0, global: 0.12 }),
  pseudomonasIronDelivery: Object.freeze({ perInstance: 0, global: 0.12 }),
});

// Quais grupos uma fase precisa. Recebe o manifesto da fase e os desbloqueios já
// conquistados — NUNCA o nome da música: a fase 5 toca o tema da Pseudomonas e
// mesmo assim usa micorriza, Bacillus e fósforo.
export function biologicalGroupsForPhaseManifest(manifest, unlocks = {}) {
  const groups = new Set();
  if (!manifest) return [];
  const phase = Number.isFinite(manifest.phase) ? manifest.phase : 0;

  // Rhizobium/FBN e a raiz nitrogenada estreiam na fase 2 e seguem disponíveis.
  if (phase >= 2 || manifest.nitrogenRoot?.enabled) groups.add('rhizobium');
  // Bacillus está em TODAS as fases jogáveis, e não por causa de uma estreia: os
  // checkpoints são biofilmes, e a formação ecológica (nuvem de exsudato + três
  // bacilos) pode acontecer em qualquer plataforma. Derivar isto só das
  // apresentações deixaria a adesão e o crescimento da matriz mudos fora das
  // fases 1 e 7.
  if (phase >= 1) groups.add('bacillus');
  // Azospirillum: a escada exige o desbloqueio, mas o manifesto da fase de
  // estreia declara o evento antes de o jogador coletá-lo.
  if (unlocks.azospirillumRoots || manifest.azospirillumRootLadder
    || (manifest.unlockEvents || []).some(event => event.feature === 'azospirillumRoots')) {
    groups.add('azospirillum');
  }
  if (unlocks.mycorrhizaStructures || manifest.mycorrhizaBridge
    || (manifest.unlockEvents || []).some(event => event.feature === 'mycorrhizaStructures')) {
    groups.add('mycorrhiza');
  }
  if (unlocks.phosphateSolubilization || manifest.phosphateSolubilization
    || (manifest.unlockEvents || []).some(event => event.feature === 'phosphateSolubilization')) {
    groups.add('phosphate');
  }
  // Organismos que aparecem como encontro/apresentação da fase.
  const organisms = new Set();
  for (const presentation of manifest.presentations || []) {
    if (presentation.roamingType) organisms.add(presentation.roamingType);
    for (const type of presentation.roamingTypes || []) organisms.add(type);
    if (typeof presentation.cardId === 'string') organisms.add(presentation.cardId);
  }
  const has = needle => [...organisms].some(name => String(name).includes(needle));
  if (has('bacillus')) groups.add('bacillus');
  if (has('pseudomonas')) groups.add('pseudomonas');
  if (has('trichoderma')) groups.add('trichoderma');
  if (has('myco')) groups.add('mycorrhiza');
  if (has('azospirillum') || has('azo')) groups.add('azospirillum');
  if (has('rhizobium')) groups.add('rhizobium');
  // Onde há patógeno, o Trichoderma é a resposta: o áudio dele precisa estar
  // pronto antes do primeiro ataque.
  if ((manifest.pathogenDebuts || []).length) groups.add('trichoderma');
  // Bacillus é também o solubilizador que alimenta a carga de fósforo.
  if (groups.has('phosphate')) groups.add('bacillus');

  return [...groups].filter(group => BIOLOGICAL_AUDIO_GROUPS[group]);
}

// Tipos de organismo, como aparecem no seletor de inóculo, mapeados para grupo.
const ORGANISM_GROUP = Object.freeze({
  rhizobium: 'rhizobium',
  azospirillum: 'azospirillum',
  azo: 'azospirillum',
  myco: 'mycorrhiza',
  mycorrhiza: 'mycorrhiza',
  bacillus: 'bacillus',
  pseudomonas: 'pseudomonas',
  trichoderma: 'trichoderma',
  phos: 'phosphate',
  'phosphate-solubilization': 'phosphate',
});

// Conjunto REAL de grupos que a partida pode precisar agora.
//
// Derivar isto só do manifesto da fase atual era o defeito: um organismo
// persistente (Pseudomonas, Trichoderma) continua no seletor por muitas fases
// depois de estrear, e não volta a aparecer em nenhum cartão de apresentação —
// então o áudio dele nunca era pré-carregado de novo, e o primeiro uso saía
// mudo ou atrasado.
//
// A conta passa a ser a união de:
//   1. todas as fases já ALCANÇADAS (o que estreou continua disponível);
//   2. os desbloqueios permanentes;
//   3. o que está de fato carregado no seletor de inóculo agora;
//   4. os patógenos da fase (onde há patógeno, Trichoderma pode atacar).
export function biologicalGroupsForProgress({
  manifests = [],
  phase = 0,
  unlocks = {},
  availableOrganisms = [],
} = {}) {
  const groups = new Set();

  for (const manifest of manifests) {
    if (!Number.isFinite(manifest?.phase) || manifest.phase > phase) continue;
    for (const group of biologicalGroupsForPhaseManifest(manifest, unlocks)) groups.add(group);
  }

  for (const organism of availableOrganisms) {
    const group = ORGANISM_GROUP[String(organism || '').toLowerCase()];
    if (group) groups.add(group);
  }

  return [...groups].filter(group => BIOLOGICAL_AUDIO_GROUPS[group]);
}

// Camadas ambientais que tocam continuamente após o desbloqueio, na ordem em que
// entram. `ambienceInternalRootFlow` está aqui, mas seu ganho é dirigido pelo
// contexto (sobre raiz ou não).
export const AMBIENCE_LAYERS = Object.freeze([
  'ambienceCaveBase',
  'ambienceCaveActivity',
  'ambienceRhizosphereBase',
  'ambienceRhizosphereDetail',
  'ambienceInternalRootFlow',
]);

export const DROP_TRACK_IDS = Object.freeze([
  'dropEco01', 'dropEco02', 'dropEco03', 'dropEco04',
  'dropEco05', 'dropEco06', 'dropEco07', 'dropEco08',
]);

// Mapeamento de música por fase.
//
// Cada fase usa o tema do organismo que ela ensina: Rhizobium na 2, Azospirillum
// na 3, micorriza na 4, competição por ferro da Pseudomonas na 5, biofilme de
// Bacillus na 6, ameaça de Rhizoctonia na 7, infestação de Meloidogyne na 8 e
// murcha vascular por Ralstonia na 9.
//
// A fase 10 (ecossistema integrado) ainda não tem tema próprio e volta ao tema
// geral — é o único fallback provisório que resta.
export const PHASE_MUSIC = Object.freeze({
  0: 'musicTitle',
  1: 'musicTitle',
  2: 'musicRhizobium',
  3: 'musicAzospirillum',
  4: 'musicMycorrhiza',
  5: 'musicPseudomonas',
  6: 'musicBacillus',
  7: 'musicRhizoctonia',
  8: 'musicMeloidogyne',
  9: 'musicRalstonia',
  10: 'musicTitle',
});

export const FALLBACK_MUSIC_ID = 'musicTitle';

export function musicTrackForPhase(phase) {
  const key = Number.isFinite(phase) ? phase : 0;
  return PHASE_MUSIC[key] || FALLBACK_MUSIC_ID;
}

// Migração v1 → v2.
//
// Sem isso, quem já abriu o jogo continuaria com `ambience: 0.20` e
// `drops: 0.15` gravados no localStorage, e os novos padrões não teriam efeito
// nenhum. A regra é conservadora: só sobe o que estava EXATAMENTE no default
// antigo — um valor personalizado é escolha do jogador e permanece.
export function migrateAudioSettings(stored) {
  if (!stored || typeof stored !== 'object') return { ...AUDIO_DEFAULTS, muted: false, version: AUDIO_STORAGE_VERSION };
  if (stored.version === AUDIO_STORAGE_VERSION) {
    return { ...AUDIO_DEFAULTS, ...stored, version: AUDIO_STORAGE_VERSION };
  }

  const numero = (valor, padrao) => (Number.isFinite(valor) ? valor : padrao);
  const noPadraoAntigo = (valor, antigo) => (
    Number.isFinite(valor) && Math.abs(valor - antigo) < 1e-9
  );

  return {
    version: AUDIO_STORAGE_VERSION,
    muted: Boolean(stored.muted),
    master: numero(stored.master, AUDIO_DEFAULTS.master),
    music: numero(stored.music, AUDIO_DEFAULTS.music),
    fx: numero(stored.fx, AUDIO_DEFAULTS.fx),
    ambience: noPadraoAntigo(stored.ambience, AUDIO_DEFAULTS_V1.ambience)
      ? AUDIO_DEFAULTS.ambience
      : numero(stored.ambience, AUDIO_DEFAULTS.ambience),
    drops: noPadraoAntigo(stored.drops, AUDIO_DEFAULTS_V1.drops)
      ? AUDIO_DEFAULTS.drops
      : numero(stored.drops, AUDIO_DEFAULTS.drops),
    stinger: numero(stored.stinger, AUDIO_DEFAULTS.stinger),
  };
}

export function audioTracksOfKind(kind) {
  return Object.values(AUDIO_TRACKS).filter(track => track.kind === kind);
}
