# Plano de testes — Campanha didática v2

## Manifesto

- fases e IDs ordenados/únicos;
- segmentos cobrem todos os chunks sem lacunas ou sobreposição;
- no máximo dois grupos e um comando por fase;
- IDs, tipos, patógenos e unlocks reais;
- nenhuma mecânica antes do unlock.
- cada `cardId` e `triggerId` existe no registro real;
- `debutChunk`, `moduleId`, `poolFromChunk` e pré-requisitos são válidos;
- Ralstonia não possui estreia no MVP.

## Primeira aparição

- criação distante ou fora da câmera não abre cartão;
- primeira entrada no raio de proximidade abre o cartão obrigatório;
- depois dessa entrada, pacing e cooldown não podem bloquear o cartão;
- encontro inesperado ignora pacing e emite diagnóstico;
- duas espécies ainda não ensinadas no mesmo raio fazem o teste falhar.

## Agrupamento

Testar:

- Bacillus/biofilme;
- Rhizobium/nódulo/FBN;
- micorriza/arbúsculo/ponte;
- Pseudomonas/sideróforo;
- Rhizoctonia/saúde/recuperação;
- J2/galha;
- fêmea/massa de ovos.

Gatilhos derivados desbloqueiam páginas progressivamente e não abrem cartões individuais fora de módulos guiados. O primeiro encontro de uma cadeia obrigatória libera somente a página inicial.

Fungo oportunista e Trichoderma devem possuir apresentações iniciais separadas. Micoparasitismo só pode ser apresentado depois de ambas.

## Pacing

- 0,9 viewport ou 60 s para apresentações espaçadas;
- organismo novo e poder ignoram a trava;
- GUIA não altera o estado de pacing.

## Modos

- guided pausa;
- silent registra sem pausar;
- disabled não registra automaticamente.

## Gating de habilidades

Para muitas seeds:

- nenhum cristal antes do Pulso;
- nenhum requisito de Pulso antes do unlock;
- nenhum vão de Dash antes do Dash;
- nenhum requisito de salto duplo antes do unlock;
- nenhuma ponte antes da micorriza;
- nenhuma raiz lateral antes do Azospirillum.

## Persistência

Testar morte, checkpoint, reload, avanço de fase e restauração de unlocks realmente obtidos.

## Patógenos

- Rhizoctonia só na Fase 6/chunk de estreia;
- Meloidogyne só na Fase 8/chunk de estreia;
- ordem J2→galha→fêmea→massa;
- Ralstonia ausente do MVP.

## Provas

Cartão visto sem ação realizada deve falhar.

## Playtest pedagógico

Observar ritmo, clareza, necessidade de reler, sobrecarga nas fases 5–7, duração, abandono e pontos de bloqueio.

## Escopo automatizado do PR 1

Neste PR, os testes cobrem o manifesto, seus helpers, referências reais, progressão de páginas e a função pura que rejeita múltiplos organismos inexplicados no mesmo raio. Testes de geração por seed, runtime, persistência e playtest entram nos PRs de integração correspondentes.
