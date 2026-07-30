// Manifesto de áudio: IDs, caminhos e presença dos arquivos
// ========================================================
//
// Este arquivo é a rede que impede o manifesto de apontar para um arquivo que
// não existe — o erro mais silencioso da integração de áudio, porque o jogo
// continua rodando e só falta som.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUDIO_DEFAULTS,
  AUDIO_STORAGE_KEY,
  AUDIO_TRACKS,
  AMBIENCE_LAYERS,
  BIOLOGICAL_AUDIO_GROUPS,
  BIOLOGICAL_BUS_SCALE,
  BIOLOGICAL_TRACKS,
  EXUDATE_PICKUP_TRACKS,
  INTERACTION_TRACKS,
  DROP_TRACK_IDS,
  PHASE_MUSIC,
  PHASE_VICTORY_TOAST_SECONDS,
  PHASE_VICTORY_TRANSITION_SECONDS,
  VICTORY_AUDIO_FALLBACK_SECONDS,
  musicTrackForPhase,
} from '../src/audio-manifest.js';
import { campaignManifest } from '../src/procgen/campaign-manifest.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const faixas = Object.values(AUDIO_TRACKS);

test('os IDs são únicos e batem com a chave do manifesto', () => {
  const ids = faixas.map(track => track.id);
  assert.equal(new Set(ids).size, ids.length, 'nenhum ID repetido');
  for (const [chave, track] of Object.entries(AUDIO_TRACKS)) {
    assert.equal(chave, track.id, `a chave ${chave} precisa bater com o id`);
  }
});

test('todo caminho começa em assets/audio/ e usa barra normal', () => {
  for (const track of faixas) {
    assert.ok(
      track.src.startsWith('assets/audio/'),
      `${track.id}: caminho fora de assets/audio/ (${track.src})`,
    );
    assert.equal(
      track.src.includes('\\'), false,
      `${track.id}: barra invertida do Windows quebraria a URL`,
    );
  }
});

test('nenhum WAV e nenhuma versão _full entram no runtime', () => {
  for (const track of faixas) {
    assert.ok(track.src.endsWith('.ogg'), `${track.id}: só OGG no runtime`);
    assert.equal(
      /_full\.ogg$/.test(track.src), false,
      `${track.id}: as versões _full ficam no ZIP como fonte, não no build`,
    );
  }
});

// Duas convenções de nome convivem, e é de propósito:
//
//   música e ambiente  `<nome>_loop.ogg`   (Pacotes 01 e 02)
//   processos (kind 'loop') `loop_<nome>.ogg` (Pacote 04)
//
// O teste antigo exigia o SUFIXO para toda faixa com `loop: true` e por isso
// reprovava o Pacote 04 inteiro. A regra correta é por categoria.
test('faixas em loop usam o arquivo de loop da sua categoria', () => {
  for (const track of faixas) {
    if (!track.loop) continue;
    const nome = track.src.split('/').pop();
    if (track.kind === 'loop') {
      assert.ok(
        nome.startsWith('loop_'),
        `${track.id}: processo em loop precisa apontar para um arquivo loop_*`,
      );
    } else {
      assert.ok(
        track.src.endsWith('_loop.ogg'),
        `${track.id}: faixa em loop precisa apontar para o arquivo _loop`,
      );
    }
  }
});

test('as oito gotas estão declaradas', () => {
  assert.equal(DROP_TRACK_IDS.length, 8);
  for (const id of DROP_TRACK_IDS) {
    assert.ok(AUDIO_TRACKS[id], `gota ausente: ${id}`);
    assert.equal(AUDIO_TRACKS[id].kind, 'drop');
  }
});

test('as cinco camadas de ambiente estão declaradas', () => {
  assert.equal(AMBIENCE_LAYERS.length, 5);
  for (const id of AMBIENCE_LAYERS) {
    assert.ok(AUDIO_TRACKS[id], `camada ausente: ${id}`);
    assert.equal(AUDIO_TRACKS[id].loop, true, `${id}: ambiente precisa de loop`);
  }
});

test('os efeitos obrigatórios existem', () => {
  for (const id of ['playerJump', 'playerDamage', 'healthLost', 'gameOver', 'phaseVictory', 'campaignVictory']) {
    assert.ok(AUDIO_TRACKS[id], `FX obrigatório ausente: ${id}`);
  }
  // O alternativo de dano fica disponível, mas não é o padrão.
  assert.equal(AUDIO_TRACKS.playerDamage.src.includes('arcade'), true);
  assert.ok(AUDIO_TRACKS.playerDamageAlt, 'o alternativo continua declarado para comparação');
});

test('toda fase da campanha tem música mapeada', () => {
  for (const fase of campaignManifest) {
    const id = musicTrackForPhase(fase.phase);
    assert.ok(AUDIO_TRACKS[id], `fase ${fase.phase}: música ${id} não existe no manifesto`);
    assert.equal(AUDIO_TRACKS[id].kind, 'music');
  }
  // Prólogo também.
  assert.ok(AUDIO_TRACKS[musicTrackForPhase(0)]);
  // O mapeamento biológico do Pacote 01.
  assert.equal(PHASE_MUSIC[2], 'musicRhizobium', 'a fase do Rhizobium usa o tema do Rhizobium');
  assert.equal(PHASE_MUSIC[3], 'musicAzospirillum', 'a fase do Azospirillum usa o tema dele');
  // E nenhuma outra fase usa esses dois temas específicos.
  for (const [fase, id] of Object.entries(PHASE_MUSIC)) {
    if (fase === '2' || fase === '3') continue;
    assert.equal(
      id === 'musicRhizobium' || id === 'musicAzospirillum', false,
      `fase ${fase}: tema de organismo em fase que não é dele`,
    );
  }
});

test('os volumes-padrão e a chave de persistência estão declarados', () => {
  // v2: a chave mudou junto com a nova mixagem, para os valores antigos gravados
  // no navegador passarem pela migração em vez de sobrescrever os novos padrões.
  assert.equal(AUDIO_STORAGE_KEY, 'miguelito:audio:v2');
  for (const chave of ['master', 'music', 'ambience', 'drops', 'fx', 'stinger']) {
    assert.ok(Number.isFinite(AUDIO_DEFAULTS[chave]), `volume ${chave} ausente`);
    assert.ok(AUDIO_DEFAULTS[chave] >= 0 && AUDIO_DEFAULTS[chave] <= 1);
  }
});

test('a mixagem mantém a hierarquia: música > ambiente > gotas', () => {
  assert.ok(AUDIO_DEFAULTS.music > AUDIO_DEFAULTS.ambience);
  assert.ok(AUDIO_DEFAULTS.ambience > AUDIO_DEFAULTS.drops);
});

test('a espera fixa é só fallback; a rede de segurança cobre os 10,24 s', () => {
  // Com áudio, quem decide o momento da troca é o evento `ended`. A espera fixa
  // vale quando não há som nenhum, e o prazo de segurança precisa ser maior que
  // a duração do arquivo para não cortá-lo.
  assert.ok(PHASE_VICTORY_TOAST_SECONDS <= PHASE_VICTORY_TRANSITION_SECONDS);
  assert.ok(
    VICTORY_AUDIO_FALLBACK_SECONDS > 10.24,
    `o prazo de segurança (${VICTORY_AUDIO_FALLBACK_SECONDS}s) cortaria o stinger de 10,24 s`,
  );
});

test('as fases 4 a 9 têm música própria e a 10 mantém o fallback', () => {
  const esperado = {
    4: 'musicMycorrhiza',
    5: 'musicPseudomonas',
    6: 'musicBacillus',
    7: 'musicRhizoctonia',
    8: 'musicMeloidogyne',
    9: 'musicRalstonia',
  };
  for (const [fase, id] of Object.entries(esperado)) {
    assert.equal(PHASE_MUSIC[fase], id, `fase ${fase}`);
    assert.notEqual(PHASE_MUSIC[fase], 'musicTitle', `fase ${fase} não usa mais o tema geral`);
    assert.ok(AUDIO_TRACKS[id], `faixa ausente: ${id}`);
    assert.equal(AUDIO_TRACKS[id].kind, 'music');
    assert.equal(AUDIO_TRACKS[id].loop, true);
    assert.equal(AUDIO_TRACKS[id].defaultGain, 1);
    assert.equal(AUDIO_TRACKS[id].preload, 'metadata');
    assert.ok(AUDIO_TRACKS[id].src.startsWith('assets/audio/music/'));
    assert.ok(AUDIO_TRACKS[id].src.endsWith('_loop.ogg'));
  }
  // A fase 10 (ecossistema integrado) ainda não tem tema próprio.
  assert.equal(PHASE_MUSIC[10], 'musicTitle');
});

test('cada fase tem uma faixa distinta, exceto o fallback compartilhado', () => {
  const usados = Object.entries(PHASE_MUSIC).filter(([, id]) => id !== 'musicTitle');
  const ids = usados.map(([, id]) => id);
  assert.equal(new Set(ids).size, ids.length, 'nenhum tema de organismo se repete entre fases');
  assert.equal(ids.length, 8, 'oito fases com tema próprio');
});

test('todos os arquivos declarados existem no disco', () => {
  const faltando = faixas
    .filter(track => !fs.existsSync(path.join(raiz, track.src)))
    .map(track => track.src);
  assert.deepEqual(
    faltando, [],
    'arquivos ausentes — extraia o Pacote 01 para assets/audio/:\n  ' + faltando.join('\n  '),
  );
});

// ===========================================================================
// PACOTE 04 — PROCESSOS BIOLÓGICOS BENÉFICOS
// ===========================================================================

const biologicas = Object.values(BIOLOGICAL_TRACKS);

test('o Pacote 04 declara exatamente 40 faixas', () => {
  assert.equal(biologicas.length, 40);
});

test('os 40 IDs do Pacote 04 são únicos e não colidem com o núcleo', () => {
  const ids = biologicas.map(track => track.id);
  assert.equal(new Set(ids).size, 40);
  // Cada ID sobreviveu ao merge em AUDIO_TRACKS — uma colisão com uma faixa do
  // Pacote 01/02 apagaria silenciosamente uma das duas.
  for (const track of biologicas) {
    assert.equal(AUDIO_TRACKS[track.id], track, `${track.id}: sobrescrito no merge`);
  }
});

test('o Pacote 04 tem 28 efeitos pontuais e 12 loops', () => {
  assert.equal(biologicas.filter(track => track.kind === 'fx').length, 28);
  assert.equal(biologicas.filter(track => track.kind === 'loop').length, 12);
});

test('todo arquivo loop_* é kind loop com loop true', () => {
  for (const track of biologicas) {
    const nome = track.src.split('/').pop();
    if (!nome.startsWith('loop_')) continue;
    assert.equal(track.kind, 'loop', `${track.id}: arquivo loop_* precisa ser kind loop`);
    assert.equal(track.loop, true, `${track.id}: arquivo loop_* precisa ter loop true`);
  }
});

test('todo arquivo fx_* do Pacote 04 é pontual', () => {
  for (const track of biologicas) {
    const nome = track.src.split('/').pop();
    if (!nome.startsWith('fx_')) continue;
    assert.equal(track.kind, 'fx', `${track.id}: arquivo fx_* precisa ser kind fx`);
    assert.notEqual(track.loop, true, `${track.id}: arquivo fx_* não pode ser loop`);
  }
});

test('todos os caminhos do Pacote 04 apontam para assets/audio/fx/', () => {
  for (const track of biologicas) {
    assert.ok(
      track.src.startsWith('assets/audio/fx/'),
      `${track.id}: caminho fora de assets/audio/fx/ (${track.src})`,
    );
  }
});

test('nenhum WAV entra no runtime', () => {
  for (const track of Object.values(AUDIO_TRACKS)) {
    assert.equal(/\.wav$/i.test(track.src), false, `${track.id}: WAV não vai para o runtime`);
  }
});

test('nada do Pacote 05 entrou nesta tarefa', () => {
  // O Pacote 05 é de patógenos. Se um som de Rhizoctonia, Meloidogyne ou
  // Ralstonia aparecer aqui, o escopo vazou.
  const proibidos = ['rhizoctonia', 'meloidogyne', 'ralstonia', 'pathogen', 'patogeno'];
  for (const track of biologicas) {
    for (const proibido of proibidos) {
      assert.equal(
        track.src.toLowerCase().includes(proibido), false,
        `${track.id}: ${proibido} pertence ao Pacote 05`,
      );
    }
  }
});

test('todo defaultGain do Pacote 04 é finito e está entre 0 e 1', () => {
  for (const track of biologicas) {
    assert.ok(Number.isFinite(track.defaultGain), `${track.id}: defaultGain não finito`);
    assert.ok(
      track.defaultGain > 0 && track.defaultGain <= 1,
      `${track.id}: defaultGain fora de (0, 1] — ${track.defaultGain}`,
    );
  }
});

test('os 40 arquivos do Pacote 04 existem no disco', () => {
  for (const track of biologicas) {
    const caminho = path.join(raiz, track.src);
    assert.ok(fs.existsSync(caminho), `${track.id}: arquivo ausente em ${track.src}`);
  }
});

test('nenhuma faixa do Pacote 04 é pré-carregada no primeiro quadro', () => {
  // `preloadShortFx()` (chamado no init) só busca preload === 'auto'. Se uma
  // faixa daqui escapasse com 'auto', a abertura da página carregaria 1,8 MB.
  for (const track of biologicas) {
    assert.notEqual(track.preload, 'auto', `${track.id}: não pode ser preload auto`);
  }
});

test('os grupos de preload cobrem as 40 faixas, sem sobra nem repetição', () => {
  const agrupadas = Object.values(BIOLOGICAL_AUDIO_GROUPS).flat();
  assert.equal(agrupadas.length, 40);
  assert.equal(new Set(agrupadas).size, 40);
  for (const id of agrupadas) {
    assert.ok(BIOLOGICAL_TRACKS[id], `${id}: grupo aponta para faixa inexistente`);
  }
  assert.deepEqual(
    Object.keys(BIOLOGICAL_AUDIO_GROUPS).sort(),
    ['azospirillum', 'bacillus', 'mycorrhiza', 'phosphate', 'pseudomonas', 'rhizobium', 'trichoderma'],
  );
});

// ===========================================================================
// PACOTE 03 — INTERAÇÕES
// ===========================================================================

const interacoes = Object.values(INTERACTION_TRACKS);

test('o Pacote 03 declara exatamente 10 faixas, com IDs únicos', () => {
  assert.equal(interacoes.length, 10);
  const ids = interacoes.map(track => track.id);
  assert.equal(new Set(ids).size, 10);
  for (const track of interacoes) {
    assert.equal(AUDIO_TRACKS[track.id], track, `${track.id}: sobrescrito no merge`);
  }
});

test('todas as faixas do Pacote 03 são efeitos curtos, sem loop', () => {
  for (const track of interacoes) {
    assert.equal(track.kind, 'fx', `${track.id}: precisa ser kind fx`);
    assert.equal(track.loop, false, `${track.id}: não pode ter loop`);
  }
});

test('todas as faixas do Pacote 03 usam preload auto', () => {
  // São dez arquivos curtos que podem acontecer no primeiro segundo da fase.
  for (const track of interacoes) {
    assert.equal(track.preload, 'auto', `${track.id}: precisa ser preload auto`);
  }
});

test('os caminhos do Pacote 03 apontam para assets/audio/fx/ e são OGG', () => {
  for (const track of interacoes) {
    assert.ok(track.src.startsWith('assets/audio/fx/'), `${track.id}: ${track.src}`);
    assert.ok(track.src.endsWith('.ogg'), `${track.id}: só OGG no runtime`);
    assert.equal(/\.wav$/i.test(track.src), false, `${track.id}: WAV não entra`);
  }
});

test('todo defaultGain do Pacote 03 é finito e está entre 0 e 1', () => {
  for (const track of interacoes) {
    assert.ok(Number.isFinite(track.defaultGain), `${track.id}: não finito`);
    assert.ok(
      track.defaultGain > 0 && track.defaultGain <= 1,
      `${track.id}: fora de (0, 1] — ${track.defaultGain}`,
    );
  }
});

test('os 10 arquivos do Pacote 03 existem no disco', () => {
  for (const track of interacoes) {
    assert.ok(fs.existsSync(path.join(raiz, track.src)), `${track.id}: ausente em ${track.src}`);
  }
});

test('a rotação de coleta tem as três variações, na ordem', () => {
  assert.deepEqual([...EXUDATE_PICKUP_TRACKS], ['exudatePickup01', 'exudatePickup02', 'exudatePickup03']);
  for (const id of EXUDATE_PICKUP_TRACKS) assert.ok(INTERACTION_TRACKS[id], `${id} ausente`);
});

test('o Pacote 04 não foi alterado pelo Pacote 03', () => {
  // Contagem, tipos e ganhos das 40 faixas continuam como estavam.
  assert.equal(Object.keys(BIOLOGICAL_TRACKS).length, 40);
  assert.equal(biologicas.filter(track => track.kind === 'fx').length, 28);
  assert.equal(biologicas.filter(track => track.kind === 'loop').length, 12);
  for (const track of biologicas) {
    assert.equal(track.preload, 'group', `${track.id}: preload do Pacote 04 mudou`);
  }
  // Nenhum ID do Pacote 03 invadiu os grupos de preload biológico.
  const agrupadas = new Set(Object.values(BIOLOGICAL_AUDIO_GROUPS).flat());
  for (const track of interacoes) {
    assert.equal(agrupadas.has(track.id), false, `${track.id}: não pertence ao Pacote 04`);
  }
});

test('BIOLOGICAL_BUS_SCALE foi preservado', () => {
  // O Pacote 03 vai pelo barramento geral de FX justamente para não depender
  // deste valor. Mexer nele aqui mudaria o equilíbrio do Pacote 04.
  assert.equal(BIOLOGICAL_BUS_SCALE, 0.9);
});

test('AUDIO_DEFAULTS.fx não foi alterado para acomodar o Pacote 03', () => {
  assert.equal(AUDIO_DEFAULTS.fx, 0.35);
});
