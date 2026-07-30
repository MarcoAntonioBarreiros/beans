export function generateGeometry(logicChunk, prevPlatform, primitive, rnd) {
  // Use primitive displacement to calculate target platform position
  let dx = primitive.displacement.x;
  let dy = primitive.displacement.y;
  
  const requiresDouble = primitive.requires.includes('doubleJump');
  const requiresDash = primitive.requires.includes('dash');
  const isCombo = requiresDouble && requiresDash;
  const isHard = logicChunk.difficultyTarget === 'hard';

  // Stretch factor: faixa mais ampla que antes, para distribuir os vaos com mais
  // variedade. Combo e dash cobrem mais distancia horizontal.
  let stretch;
  if (isCombo) {
    stretch = 0.85 + rnd() * 0.12;
  } else if (isHard) {
    stretch = 0.80 + rnd() * 0.15;
  } else {
    stretch = 0.55 + rnd() * 0.35;
  }

  // Calculate horizontal gap
  dx = Math.abs(dx) * stretch;
  if (requiresDash) dx *= 1.15; // o dash estende o alcance
  // Ensure minimum gap so platforms don't overlap
  dx = Math.max(dx, 60);

  // Variacao vertical: terreno em ondas. Duas senoides de frequencias diferentes
  // quebram a periodicidade do padrao unico, e o ruido local e mais amplo.
  const chunkIndex = logicChunk.index || 0;
  const wave = Math.sin(chunkIndex * 0.31) * 120 + Math.sin(chunkIndex * 0.13 + 1.7) * 70;
  const localVariation = (rnd() - 0.5) * 130;

  let targetDy;
  if (logicChunk.isSkillIntro || logicChunk.allyId) {
    targetDy = (rnd() - 0.5) * 40; // variacao suave nos momentos de aprendizado
  } else if (isCombo) {
    // Combo: sobe alto; o dash estende o alcance na sequencia.
    targetDy = -55 - rnd() * 60;
  } else if (requiresDouble) {
    // Salto duplo: sobe, mas com magnitude variada (as vezes moderado).
    targetDy = -30 - rnd() * 90;
  } else if (requiresDash) {
    // Dash: leve variacao de altura, nao mais plano fixo.
    targetDy = (rnd() - 0.5) * 70;
  } else {
    // Terreno comum acompanha a onda, agora com peso maior e ruido mais amplo.
    targetDy = wave * 0.5 + localVariation;
  }

  // Platform width variation
  let platW;
  if (logicChunk.isSkillIntro || logicChunk.allyId || logicChunk.isCheckpoint) {
    platW = 150 + rnd() * 80; // plataformas largas e seguras nos momentos-chave
  } else if (isCombo) {
    platW = 70 + rnd() * 45; // destino do combo nao tao estreito
  } else if (isHard) {
    platW = 60 + rnd() * 45; // estreita para desafio
  } else {
    platW = 78 + rnd() * 115; // mais variedade
  }

  let platH = 40 + rnd() * 60;

  let newPlat = {
    x: prevPlatform.x + prevPlatform.w + dx,
    y: prevPlatform.y + targetDy,
    w: platW,
    h: platH,
    type: rnd() > 0.3 ? 'root' : 'soil'
  };

  // Clamp Y to keep within visible play area (200 to 580)
  // But use soft clamping — nudge rather than snap
  if (newPlat.y < 220) {
    newPlat.y = 220 + rnd() * 60;
  } else if (newPlat.y > 560) {
    newPlat.y = 560 - rnd() * 60;
  }

  return newPlat;
}
