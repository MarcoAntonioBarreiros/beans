import { getNitrogenAvailability } from './nitrogen-availability.js';

if (typeof window !== 'undefined') {
  window._activeGauges = window._activeGauges || new Set();
}

function circularGaugeMarkup({ label, symbol, valueText, pct, color }) {
  const dashOffset = 100 - Math.min(100, Math.max(0, pct));
  const isActive = typeof window !== 'undefined' && window._activeGauges && window._activeGauges.has(label);
  return `
    <div class="mobile-gauge-item${isActive ? ' active' : ''}" data-label="${label}">
      <svg class="gauge-circle" viewBox="0 0 36 36">
        <path class="gauge-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="rgba(6,26,32,0.88)" stroke="rgba(255,255,255,0.18)" stroke-width="2.5" />
        <path class="gauge-fill" stroke-dasharray="100, 100" stroke-dashoffset="${dashOffset}" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" />
        <text x="18" y="21.5" text-anchor="middle" fill="#ecfff7" font-size="10.5" font-weight="900">${symbol}</text>
      </svg>
      <div class="gauge-tooltip">${label}: <strong>${valueText}</strong></div>
    </div>
  `;
}

// Painel da Ralstonia: aparece somente quando Miguelito esta sobre/perto de uma
// raiz com foco ou visada por uma disseminacao. Numeros com leitura
// interpretativa ao lado — "Porta aberta" ensina, "0.31" nao.
function pct(value) {
  return `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
}

function ralstoniaBar(label, value, color) {
  return `
      <div class="context-item">
        <span>${label}: <strong>${pct(value)}</strong></span>
        <div class="context-bar"><div class="context-bar-fill" style="width: ${pct(value)}; background: ${color};"></div></div>
      </div>
    `;
}

function ralstoniaContextMarkup(sim, nearbyRoot) {
  const snapshot = sim?.ralstoniaControl?.rootSnapshot?.(nearbyRoot);
  if (!snapshot) return '';

  const critico = snapshot.stage === 'critical';
  const titulo = snapshot.hasFocus ? snapshot.stageLabel : 'raiz visada pela disseminação';
  const papel = snapshot.shortRoleLabel
    ? `<em style="font-style: normal; opacity: .8;"> · ${snapshot.shortRoleLabel}</em>`
    : '';
  let html = `
      <div class="context-item" style="margin-top: 10px; border-top: 1px solid rgba(255,150,110,0.35); padding-top: 6px;">
        <span>Ralstonia: <strong style="color: ${critico ? '#ff8297' : '#ffb896'};">${titulo}</strong>${papel}</span>
      </div>
      <div class="context-item" style="color: ${critico ? '#ff8297' : '#7ed6cd'}; font-size: 10px;">
        ${snapshot.reading || ''}
      </div>
    `;

  const portaCor = snapshot.doorLabel === 'Entrada bloqueada' ? '#8ef0c6'
    : snapshot.doorLabel === 'Porta fechando' ? '#7ed6cd'
    : '#ff966e';
  html += `
      <div class="context-item">
        <span>Porta de entrada: <strong>${pct(snapshot.opening)}</strong>
          <em style="color: ${portaCor}; font-style: normal;">· ${snapshot.doorLabel || '—'}</em></span>
        <div class="context-bar"><div class="context-bar-fill" style="width: ${pct(snapshot.opening)}; background: ${portaCor};"></div></div>
      </div>
    `;

  if (snapshot.hasFocus) {
    html += ralstoniaBar('Carga superficial', snapshot.surfaceLoad, '#e8c27e');
    html += ralstoniaBar('Carga vascular', snapshot.vascularLoad, critico ? '#ff6f91' : '#e8905e');
    html += ralstoniaBar('Transporte vascular', snapshot.transport, '#7ed6cd');
    if (snapshot.azospirillumClosure > .01) html += ralstoniaBar('Fechamento por Azo', snapshot.azospirillumClosure, '#7ed6cd');
    if (snapshot.bacillusControl > .01) html += ralstoniaBar('Barreira Bacillus', snapshot.bacillusControl, '#a8ffe6');
    if (snapshot.pseudomonasControl > .01) html += ralstoniaBar('Supressão Pseudomonas', snapshot.pseudomonasControl, '#f4a261');
    if (snapshot.contained) {
      html += `<div class="context-item" style="color: #6ce7df;">Infecção contida — carga residual permanece</div>`;
    }
  }

  if (Number.isFinite(snapshot.incomingSeconds)) {
    html += `
      <div class="context-item" style="color: #ff8297; font-weight: bold;">
        Disseminação chegando: ${snapshot.incomingSeconds.toFixed(1)} s
      </div>
    `;
    html += ralstoniaBar('Proteção atual', snapshot.incomingProtection, '#8ef0c6');
    html += `<div class="context-item" style="color: ${(snapshot.incomingProtection || 0) >= .5 ? '#8ef0c6' : '#ff8297'}; font-size: 10px;">`
      + `${(snapshot.incomingProtection || 0) >= .5 ? 'Raiz protegida' : 'Raiz vulnerável'}</div>`;
  }

  return html;
}

let lastRootData = { health: 100, status: 'Saudável', color: '#70e5d6' };

export function updateContextPanel(state, nearbyRoot, contextDiv, sim) {
  if (!contextDiv) return;

  contextDiv.classList.add('visible');
  let html = `<div class="context-header">Bioma Local <span>${state?.activeBiomes?.length || 1}</span></div>`;

  let mobileGaugesHtml = '<div class="mobile-gauge-row">';

  if (nearbyRoot) {
    const health = nearbyRoot.rootHealth ? Math.round(nearbyRoot.rootHealth * 100) : 100;
    const rootColor = health < 40 ? '#ff8297' : '#70e5d6';
    const rootStatus = health >= 80 ? 'Saudável' : health >= 40 ? 'Estressada' : 'Crítica';
    lastRootData = { health, status: rootStatus, color: rootColor };

    html += `
      <div class="context-item">
        <span>Raiz: <strong>${rootStatus}</strong> (${health}%)</span>
        <div class="context-bar"><div class="context-bar-fill" style="width: ${health}%; background: ${rootColor};"></div></div>
      </div>
    `;
    if (nearbyRoot.hasPhosphate) {
      html += `<div class="context-item" style="color: #c9a5ff; font-weight: bold; margin-top: 4px;">P Cristalizado Detectado</div>`;
    }
    html += ralstoniaContextMarkup(sim, nearbyRoot);
  } else {
    html += `<div class="context-item"><span>Explorando o solo...</span></div>`;
  }

  // O medidor circular de Raiz (R) permanece continuamente aceso na UI móvel
  mobileGaugesHtml += circularGaugeMarkup({
    label: 'Saúde da Raiz',
    symbol: 'R',
    valueText: `${lastRootData.status} (${lastRootData.health}%)`,
    pct: lastRootData.health,
    color: lastRootData.color
  });

  if (sim && sim.state) {
    const s = sim.state;
    const phase = s.campaign?.phase || 0;

    // Iron
    const ironMax = 1.5;
    const ironRecovered = sim.pseudomonasSiderophores?.ironRecovered || 0;
    const ironPct = Math.min(100, (ironRecovered / ironMax) * 100);
    if (phase >= 5 || ironPct > 0) {
      html += `
        <div class="context-item" style="margin-top: 8px;">
          <span>Ferro (Fe³⁺): <strong>${Math.round(ironPct)}%</strong></span>
          <div class="context-bar"><div class="context-bar-fill" style="width: ${ironPct}%; background: #f4a261;"></div></div>
        </div>
      `;
      mobileGaugesHtml += circularGaugeMarkup({ label: 'Ferro (Fe³⁺)', symbol: 'Fe', valueText: `${Math.round(ironPct)}%`, pct: ironPct, color: '#f4a261' });
    }
    
    // Nitrogen
    const nitrogen = getNitrogenAvailability({
      state: s,
      azospirillumNitrogen: sim.azospirillumNitrogen,
    });
    if (phase >= 2 || nitrogen.totalFraction > 0) {
      const nPct = nitrogen.percent;
      html += `
        <div class="context-item">
          <span>Nitrogênio (N): <strong>${Math.round(nPct)}%</strong></span>
          <div class="context-bar"><div class="context-bar-fill" style="width: ${nPct}%; background: #ffd783;"></div></div>
        </div>
      `;
      mobileGaugesHtml += circularGaugeMarkup({ label: 'Nitrogênio (N)', symbol: 'N', valueText: `${Math.round(nPct)}%`, pct: nPct, color: '#ffd783' });
    }

    // Phosphorus
    const availablePhosphate = sim.phosphateSolubilization?.availablePhosphate || 0;
    if (phase >= 7 || availablePhosphate > 0) {
      const pPct = Math.min(100, availablePhosphate * 100);
      html += `
        <div class="context-item">
          <span>Fósforo (P): <strong>${Math.round(pPct)}%</strong></span>
          <div class="context-bar"><div class="context-bar-fill" style="width: ${pPct}%; background: #c9a5ff;"></div></div>
        </div>
      `;
      mobileGaugesHtml += circularGaugeMarkup({ label: 'Fósforo (P)', symbol: 'P', valueText: `${Math.round(pPct)}%`, pct: pPct, color: '#c9a5ff' });
    }

    // Antibiosis
    const vigor = sim.trichodermaColonies?.vigorAverage || 0;
    if (phase >= 6 || vigor > 0) {
      const aPct = Math.min(100, vigor * 100);
      html += `
        <div class="context-item">
          <span>Antibiose: <strong>${Math.round(aPct)}%</strong></span>
          <div class="context-bar"><div class="context-bar-fill" style="width: ${aPct}%; background: #b9f36f;"></div></div>
        </div>
      `;
      mobileGaugesHtml += circularGaugeMarkup({ label: 'Antibiose', symbol: 'A', valueText: `${Math.round(aPct)}%`, pct: aPct, color: '#b9f36f' });
    }

    // Qualidade Ecologica e o objetivo do ecossistema integrado, que agora e a
    // fase 10 — na fase 9 (Ralstonia) o painel fala de transporte vascular.
    if (phase >= 10) {
      const score = Math.round(Number(s.level?.ecologicalScore || 0) * 100);
      html += `
        <div class="context-item" style="margin-top: 10px; border-top: 1px solid rgba(126,214,205,0.3); padding-top: 6px;">
          <span>Qualidade Ecológica: <strong style="color: ${score >= 100 ? '#82ffbd' : '#ffd783'};">${score}%</strong> / 100%</span>
          <div class="context-bar"><div class="context-bar-fill" style="width: ${Math.min(100, score)}%; background: #82ffbd;"></div></div>
          <div style="font-size: 9px; color: rgba(222,250,245,0.72); margin-top: 4px;">Combine N, P, Fe³⁺, Biocontrole e Saúde Radicular</div>
        </div>
      `;
      mobileGaugesHtml += circularGaugeMarkup({ label: 'Qualidade Ecológica', symbol: 'Q', valueText: `${score}%`, pct: score, color: '#82ffbd' });
    }
  }

  mobileGaugesHtml += '</div>';

  contextDiv.innerHTML = html + mobileGaugesHtml;
}
