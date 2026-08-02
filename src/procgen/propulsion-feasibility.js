import { JETPACK_CONFIG } from '../player-jetpack.js';

// VIABILIDADE DE TRAVESSIA POR PROPULSÃO
// ======================================
//
// Mesmo defeito da ponte, outro sistema. A auditoria dizia:
//
//     if (options.jetpackAvailable) { aceitar qualquer falha; }
//
// Ter a mochila não é o mesmo que alcançar o outro lado. O tanque dura pouco
// mais de um segundo, o empuxo tem teto de velocidade e a gravidade continua
// puxando — existe distância que a propulsão simplesmente não cobre, e a regra
// antiga aprovava todas elas.
//
// Os números vêm de `JETPACK_CONFIG` e da gravidade real do jogo. Nada é
// recalibrado aqui: se uma rota não passa, o conserto é na rota, não na física.

/** Gravidade aplicada em `physics.js`. Importada por valor porque o módulo de
 *  física é acoplado ao loop; o número é o mesmo, e este comentário é o vínculo. */
export const GAME_GRAVITY = 1180;

/**
 * Alcance da propulsão a partir de um ponto, com o tanque que o jogador tem.
 *
 * Horizontal: velocidade de cruzeiro × tempo de voo. O tempo de voo é o tanque
 * mais a queda livre que ainda dá para aproveitar depois de o empuxo acabar.
 *
 * Vertical: a mochila acelera a `thrustAcceleration` contra a gravidade, com
 * teto em `maximumJetpackAscentSpeed`. A altura ganha é a distância percorrida
 * nessa subida durante o tempo de tanque.
 */
export function propulsionEnvelope({ energy = 1, fallHeight = 0 } = {}) {
  const tank = Math.max(0, Math.min(1, energy)) * JETPACK_CONFIG.maximumContinuousSeconds;
  const netAcceleration = JETPACK_CONFIG.thrustAcceleration - GAME_GRAVITY;
  const timeToTopSpeed = netAcceleration > 0
    ? JETPACK_CONFIG.maximumJetpackAscentSpeed / netAcceleration
    : Infinity;
  // Fase acelerada mais fase de velocidade constante, dentro do tanque.
  const accelerating = Math.min(tank, timeToTopSpeed);
  const cruising = Math.max(0, tank - accelerating);
  const maximumRise = 0.5 * netAcceleration * accelerating * accelerating
    + JETPACK_CONFIG.maximumJetpackAscentSpeed * cruising;

  // Depois do tanque, ainda dá para planar caindo — e cair é aceitável quando o
  // destino está mais baixo. `fallHeight` é o quanto se pode perder de altura.
  const glide = fallHeight > 0 ? Math.sqrt((2 * fallHeight) / GAME_GRAVITY) : 0;
  const flightSeconds = tank + glide;
  const maximumHorizontal = JETPACK_CONFIG.maximumHorizontalSpeed * flightSeconds;

  return { tank, maximumRise, maximumHorizontal, flightSeconds };
}

/**
 * Esta travessia é possível com a propulsão?
 *
 * Devolve veredito com motivo, como o validador da ponte, e pelo mesmo motivo:
 * o agregado por motivo é o que aponta o gerador a consertar.
 */
export function evaluatePropulsionCrossing({
  from,
  to,
  unlocks = {},
  energy = 1,
} = {}) {
  const fail = (reason, extra = {}) => ({ feasible: false, reason, ...extra });
  if (!unlocks.jetpack) return fail('propulsao-nao-desbloqueada');
  if (!from || !to) return fail('geometria-ausente');

  const gap = to.x - (from.x + from.w);
  const rise = from.y - to.y;
  const drop = Math.max(0, -rise);
  // Partida do topo da plataforma anterior; pouso em qualquer ponto do topo da
  // seguinte, então a largura do destino conta a favor.
  const horizontalNeeded = gap;
  const envelope = propulsionEnvelope({ energy, fallHeight: drop });

  if (horizontalNeeded > envelope.maximumHorizontal) {
    return fail('alem-do-alcance-horizontal', {
      needed: Math.round(horizontalNeeded),
      available: Math.round(envelope.maximumHorizontal),
      rise: Math.round(rise),
    });
  }
  if (rise > envelope.maximumRise) {
    return fail('alem-do-alcance-vertical', {
      needed: Math.round(rise),
      available: Math.round(envelope.maximumRise),
      rise: Math.round(rise),
    });
  }
  // Subir E avançar ao mesmo tempo consome o mesmo tanque. Sem esta conta, um
  // vão que passa em cada eixo isolado passaria também na diagonal, e não passa.
  if (rise > 0) {
    const secondsClimbing = rise / Math.max(1, JETPACK_CONFIG.maximumJetpackAscentSpeed);
    const secondsAdvancing = horizontalNeeded / Math.max(1, JETPACK_CONFIG.maximumHorizontalSpeed);
    if (secondsClimbing + secondsAdvancing > envelope.flightSeconds * 1.15) {
      return fail('tanque-insuficiente-para-subir-e-avancar', {
        needed: Number((secondsClimbing + secondsAdvancing).toFixed(2)),
        available: Number(envelope.flightSeconds.toFixed(2)),
        rise: Math.round(rise),
      });
    }
  }
  return {
    feasible: true,
    reason: null,
    gap: Math.round(gap),
    rise: Math.round(rise),
    envelope,
  };
}
