export function generateGeometry(logicChunk, prevPlatform, primitive, rnd, verticalBand = null) {
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
  //
  // ESTA e a origem da silhueta senoidal da fase. Nao e aleatoriedade: e uma
  // onda determinística de periodo fixo. Ela serve bem quando ninguem tem plano
  // para o percurso, mas quando existe um plano vertical ela COMPETE com ele —
  // o plano puxa para a linha-alvo e a onda puxa de volta para o proprio ciclo.
  // Por isso, com plano, a onda sai e o alvo entra no lugar dela.
  const chunkIndex = logicChunk.index || 0;
  const wave = Math.sin(chunkIndex * 0.31) * 120 + Math.sin(chunkIndex * 0.13 + 1.7) * 70;
  const localVariation = (rnd() - 0.5) * 130;
  const plannedDy = verticalBand
    ? (verticalBand.target - prevPlatform.y)
    : null;

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
  } else if (plannedDy !== null) {
    // Com plano: o terreno comum acompanha a LINHA-ALVO, e o ruído local
    // continua existindo para o relevo não virar rampa lisa.
    targetDy = plannedDy + localVariation * 0.45;
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

  // Teto e piso verticais. Sem plano continuam sendo os de sempre (220..560);
  // com plano, quem manda é o envelope dele.
  //
  // Este clamp estava escondido aqui e é ABSOLUTO — não relativo à plataforma
  // anterior. Era ele que apagava qualquer tentativa de dar mais altura à fase
  // pelo `stabilizeGeometry`: a plataforma já nascia presa nesta faixa, antes
  // de o plano vertical ter chance de opinar.
  const floorLimit = verticalBand ? verticalBand.floorLimit : 220;
  const ceilingLimit = verticalBand ? verticalBand.ceilingLimit : 560;
  if (newPlat.y < floorLimit) {
    newPlat.y = floorLimit + rnd() * 60;
  } else if (newPlat.y > ceilingLimit) {
    newPlat.y = ceilingLimit - rnd() * 60;
  }

  return newPlat;
}
