# Folhas de sprite do Miguelito

Skin alternativa do jogador. O astronauta desenhado no canvas continua sendo o
padrão e a rede de segurança: se qualquer folha faltar, não carregar ou vier com
medida inválida, o jogo volta a desenhá-lo sozinho, sem erro na tela.

## Como testar

```
?player=miguelito    troca para os sprites
?player=astronaut    volta para o astronauta
```

A escolha fica guardada no navegador, então dá para atravessar várias fases sem
repetir o parâmetro.

## Formato esperado

Uma **tira horizontal** por animação, com todos os quadros da mesma largura e
alinhados na mesma linha de base — o pé do personagem precisa ficar na mesma
altura em todos os quadros, senão a corrida sobe e desce.

- Fundo **transparente** (PNG com alfa). Fundo branco vira um retângulo branco.
- A largura de cada quadro é calculada como `largura da imagem ÷ frames`, então
  a tira não pode ter margem sobrando nas pontas.
- Personagem virado para a **direita**. O jogo espelha sozinho ao andar para a
  esquerda.

## Arquivos

| arquivo | estado | quadros | medida | corpo no quadro |
|---|---|---|---|---|
| `run.png` | corrida | 8 | 2560x400 | 347 de 400px |
| `idle.png` | parado | 8 | 2560x400 | 224 de 400px |

## Escala: por que cada folha declara `contentHeight`

As duas folhas tem o mesmo quadro (320x400), mas o menino foi **desenhado em
tamanhos diferentes**: ocupa 347px na corrida e so 224px no parado. Sem
compensar, ele encolheria 35% ao parar de andar.

Por isso o tamanho e declarado uma vez, como `characterHeight` (altura visivel
em pixels de jogo), e cada folha informa quanto do quadro o corpo ocupa. O
modulo faz a conta para que todas rendam do mesmo tamanho.

**Se as proximas folhas vierem na mesma escala da corrida, e so copiar
`contentHeight: 347`.** Se vierem em outra, e medir uma vez.

## Medidas da folha de corrida (para as proximas baterem)

Medidas pixel a pixel na `run.png` que ja esta aqui:

- **8 quadros de exatamente 320px.** Divisao limpa, sem margem sobrando.
- **Fundo transparente**, com colunas totalmente vazias entre as figuras.
- **Chao na linha 379 de 400** — sobram 20px de vazio abaixo do pe mais baixo.
- **A base varia 18px entre quadros** (361 a 379). No jogo isso vira 1 a 3px de
  balanco, que passa por movimento natural da corrida.
- Personagem visivel no jogo: **~50px de altura por ~28px de largura**, contra
  uma caixa de colisao de 32x48. Encaixe bom: mais alto que a caixa (cabeca e
  mochila passam) e um pouco mais estreito (nao invade os vaos).

**O que manter igual nas proximas folhas:** mesmo quadro de 320x400, mesma
linha de chao (379) e mesma escala do personagem. Se as tres baterem, salto,
dash, dano e comemoracao encaixam sozinhos e nao precisam de ajuste nenhum.
Se a linha de chao mudar, e so ajustar `baseline` daquela folha.

As demais (`idle`, `jump`, `dash`, `hurt`, `celebrate`, `pulse`) já têm linha
pronta e comentada em [`src/render/player-skins.js`](../../src/render/player-skins.js).
Enquanto não existirem, todos os estados caem na corrida pela cadeia de
fallback — o personagem nunca fica sem quadro.

## Se a proporção sair errada

Três números em `player-skins.js`, e nenhum deles mexe na física:

- `heightScale` — altura da arte em relação à caixa de colisão de 32×48.
  Está em `1.32` porque cabeça e mochila passam do corpo físico.
- `offsetX` / `offsetY` — deslocamento fino para o pé assentar na plataforma.

A caixa de colisão **não muda com a skin**. Toda a física — alturas de salto,
alcances, os desafios-assinatura validados por `validateChunk` — está medida em
cima de 32×48; uma arte que mudasse isso invalidaria as travessias já
verificadas.
