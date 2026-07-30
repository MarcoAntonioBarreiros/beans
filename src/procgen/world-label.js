// Rotulo do mundo: so texto com glow, sem caixa.
//
// Toda caixa desenhada atras de um texto no canvas vira widget colado sobre a
// cena — moldura, canto arredondado e fundo opaco pertencem a interface, nao ao
// solo. O nome das colonias (\"Bacillus\") sempre foi so texto e sempre foi o que
// menos incomodou, entao e ele o modelo.
//
// A legibilidade vem de tres camadas empilhadas no mesmo lugar: um halo escuro
// largo que apaga o fundo, um contorno escuro fino que segura a forma da letra
// contra qualquer cor, e o texto colorido com brilho proprio. Nenhuma delas tem
// aresta, entao nao existe borda para aparecer.

export function drawWorldLabel(ctx, x, y, text, options = {}) {
  const {
    color = '#effff6',
    font = '800 12px Inter,system-ui',
    align = 'center',
    baseline = 'middle',
    glow = 10,
    alpha = 1,
    maxWidth,
  } = options;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.globalAlpha = alpha;

  // Camada 1: halo escuro largo. Apaga o fundo sem desenhar nenhuma aresta.
  ctx.shadowColor = 'rgba(0,0,0,.92)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = 'rgba(0,0,0,.85)';
  ctx.fillText(text, x, y, maxWidth);
  ctx.fillText(text, x, y, maxWidth);

  // Camada 2: contorno fino. Segura a letra contra fundo claro (a madeira do
  // bloco) sem virar borda de caixa.
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(2,12,16,.9)';
  ctx.strokeText(text, x, y, maxWidth);

  // Camada 3: o texto, com brilho da propria cor.
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y, maxWidth);
  ctx.restore();
}
