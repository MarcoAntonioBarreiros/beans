# Manifesto da campanha didática — especificação revisada

Este documento acompanha `src/procgen/campaign-manifest.js` e consolida progressão, tutorial, pools, patógenos, desbloqueios, segmentos e provas finais.

## Princípio pedagógico irrenunciável

Um organismo novo deve ser explicado **no primeiro encontro por proximidade**. Criar ou desenhar o organismo distante, inclusive fora da câmera, não constitui encontro:

```text
primeira entrada no raio de detecção
→ cartão obrigatório imediatamente
```

Depois que Miguelito entra nesse raio, cooldown e pacing nunca podem silenciar o cartão obrigatório. Uma estreia fora da zona planejada abre o cartão e registra diagnóstico com fase, chunk, tipo, posição e pool.

## Campanha híbrida

```text
módulo fixo de introdução
→ prática procedural
→ segundo módulo fixo, quando necessário
→ desafio procedural ampliado
→ prova final
```

Somente primeiro encontro, demonstrações difíceis, desbloqueios e provas são autorais. O restante permanece procedural.

## Proteções complementares

### 1. Pool por fase e chunk

Usar `getProceduralPoolAt(phase, chunkIndex)`. Um organismo vagante só entra no procedural após `poolFromChunk`.

### 2. Tethering na estreia

O organismo vagante da estreia permanece perto da cena até o cartão ser visto. Evitar dependência circular: injetar `hasSeenCard` ou usar estado compartilhado simples.

### 3. Apresentações agrupadas e progressivas

Agrupamento é permitido somente para cadeias do mesmo organismo ou processo, como Bacillus→biofilme, Rhizobium→nódulo→FBN, Pseudomonas→sideróforo→ferro e micorriza→arbúsculo→absorção.

`pageUnlocks` define quais páginas cada gatilho libera. Em uma cadeia obrigatória, o primeiro encontro libera somente a página 0. Estruturas e processos posteriores atualizam a mesma entrada do GUIA. Com `suppressIndividualCards`, somente `autoOpenTrigger` abre o painel; os gatilhos derivados usam `derivedTriggerBehavior: 'guide-only'`.

Organismos diferentes nunca compartilham apresentação inicial. Fungos oportunistas e Trichoderma têm cartões próprios; micoparasitismo é uma apresentação posterior, condicionada a ambos já terem sido apresentados.

### 4. Tutorial por segmento

- `guided`: cartões e sequência autoral permitidos;
- `silent`: registra no GUIA, mas não pausa;
- `disabled`: não registra nem apresenta automaticamente.

Organismo novo encontrado por proximidade e ainda não explicado tem precedência sobre `silent`.

### 5. Supressão espacial como segurança

Depois de apresentação não obrigatória, aguardar aproximadamente 90% da largura visível ou 60 segundos:

```js
visibleWorldWidth = canvas.width / cameraZoom
minimumDistance = Math.max(600, visibleWorldWidth * 0.90)
```

Não aplicar depois do primeiro encontro por proximidade com organismo novo, nem a salto duplo, Dash ou Pulso. A distância controla principalmente o espaçamento entre zonas de estreia.

## Zonas de estreia

Cada organismo obrigatório declara um `debutZoneId`. Uma zona pode introduzir somente um tipo ainda não explicado. Outros organismos presentes nela precisam pertencer a apresentações já concluídas. A validação rejeita duas estreias obrigatórias com a mesma zona; testes de geração posteriores também devem verificar os raios reais das entidades autorais.

## Contrato do PR 1

O manifesto, seus helpers e o validador são adicionados sem importação pelo runtime. Este PR formaliza os contratos e falha cedo para referências, intervalos ou cadeias inválidas, mas não altera progressão, geração ou tutorial existentes.

## Integração de progressão e gating

O runtime passa a ler do manifesto somente o perfil das fases, títulos, missões, eventos de desbloqueio e disponibilidade de habilidades por chunk. A geometria consulta essa disponibilidade antes de selecionar requisitos de salto duplo, Dash ou Pulso; cristais registram o chunk e o poder exigido. Pontes micorrízicas e raízes laterais continuam sistemas de runtime, mas não são atualizadas antes de seus respectivos desbloqueios reais.

Os poderes persistem em `sessionStorage` apenas quando foram efetivamente obtidos. Morte, checkpoint, reinicialização da fase e recarga da página reidratam essas flags sem conceder automaticamente poderes esperados para a fase.

O prólogo permanece definido como fase 0 no manifesto, porém a campanha jogável continua iniciando na fase 1. Ativá-lo exige um PR próprio para mudar a fase inicial e implementar seus blocos fixos de introdução, prova final e transição; antecipar somente a mudança do número inicial produziria uma fase procedural sem a sequência autoral especificada.

## Integração do fluxo dos cartões

O runtime resolve cada gatilho pela apresentação correspondente no manifesto. A entrada real no raio de proximidade de um organismo ainda não explicado abre seu cartão obrigatório mesmo em trecho `silent` e mesmo quando a trava espacial está ativa. Geração distante, organismos já conhecidos, estruturas e processos derivados não recebem esse bypass.

Cadeias do mesmo organismo atualizam progressivamente uma única entrada do GUIA. O primeiro encontro libera apenas as páginas declaradas para o organismo; estruturas e processos posteriores liberam as demais páginas sem abrir um novo painel fora dos módulos guiados. Organismos diferentes mantêm cartões separados e apresentações com pré-requisitos, como micoparasitismo, só são registradas depois das apresentações exigidas.

A fila automática geral foi removida. Se um encontro obrigatório ocorrer enquanto outro painel estiver aberto, o gerenciador conserva no máximo um cartão obrigatório pendente de segurança. Um segundo organismo inédito simultâneo emite `miguelito:tutorial-simultaneous-first-encounters`; estreias fora da fase ou módulo esperado emitem o diagnóstico definido por `tutorialPacing.diagnosticEventName`.

Apresentações secundárias respeitam `guided`, `silent` e `disabled`, além do intervalo de aproximadamente 90% da largura visível ou 60 segundos. O modo silencioso registra a descoberta e suas páginas no GUIA sem pausar o jogo. Desbloqueios de poder ignoram somente a trava espacial, não o modo silencioso.

## Poderes e geometria

Poder planejado para a fase não equivale a poder disponível no início. O gerador consulta `getAvailableUnlocksAt(phase, chunkIndex)`. O unlock do chunk N só pode ser exigido a partir de N+1.

Garantias:

- cristal somente em chunk com `pulse`;
- `pulse` somente depois do unlock;
- vão obrigatório de Dash somente depois do Dash;
- geometria obrigatória de salto duplo somente depois do salto duplo;
- ponte procedural somente depois de `mycorrhizaStructures`;
- raiz lateral procedural somente depois de `azospirillumRoots`.

## Organização da campanha

1. Prólogo — movimento e pulo.
2. Fase 1 — exsudato, recrutamento, Bacillus e biofilme.
3. Fase 2 — Rhizobium, nódulo e FBN.
4. Fase 3 — Azospirillum, raiz lateral e salto duplo.
5. Fase 4 — micorriza, arbúsculo, ponte e Dash.
6. Fase 5 — Pseudomonas, ferro, oportunista, Trichoderma e micoparasitismo.
7. Fase 6 — Rhizoctonia, Trichoderma e micoparasitismo.
8. Fase 7 — fósforo: Bacillus solubilizador, depósito de P, micorriza e estoque radicular.
9. Fase 8 — Meloidogyne: J2, galha, fêmea, massa de ovos e sequela.
10. Fase 9 — integração dos sistemas aprendidos.
9. Fase 8 — síntese sem novos cartões automáticos.

Ralstonia fica para expansão pós-piloto.

## Integração da ordem curricular

As comunidades vagantes são geradas por `generateCampaignEncounters` a partir do manifesto. Bacillus, Rhizobium, Azospirillum, Pseudomonas, fungo oportunista e Trichoderma recebem uma única zona de estreia no `debutChunk` declarado. Essa comunidade permanece tethered à zona enquanto o respectivo cartão ainda não foi visto.

`poolFromChunk` é apenas o limite espacial mínimo da recorrência. As zonas procedurais do organismo estreante permanecem dormentes até o primeiro encontro por proximidade concluir a apresentação; portanto, alcançar ou recarregar um trecho posterior não antecipa curricularmente o organismo. Organismos de fases anteriores continuam recorrendo normalmente.

Micorriza e Bacillus solubilizador são estreias fixas e não entram no pool das comunidades vagantes. Na Fase 7, a cepa madura fornece metabólitos para o disparo direcional; o P liberado permanece local e só chega à raiz por uma rede micorrízica funcional. Rhizoctonia e Meloidogyne são controlados por agendas próprias: Rhizoctonia permanece na Fase 6 e Meloidogyne passa à Fase 8, sem alteração de suas mecânicas.

Os testes multi-seed verificam a sequência Bacillus → Rhizobium → Azospirillum → micorriza → Pseudomonas → oportunista → Trichoderma → micoparasitismo → Rhizoctonia → Meloidogyne, a separação física das estreias, a ativação pós-cartão e a posição inicial dos dois subsistemas patogênicos.

## Ordem de Meloidogyne

```text
J2 → busca → penetração → migração → galha → fêmea → massa de ovos → eclosão
```

## Provas finais

As provas verificam estado real, não apenas cartão visto. Criar avaliador central de `{ type, key, operator, value }` e mapear as chaves abstratas ao estado real.

## Implementação por PRs

1. Manifesto, validador e testes, sem mudar comportamento.
2. Progressão e gating de habilidades.
3. Tutorial agrupado, modos e primeira aparição obrigatória.
4. Pool por chunk e tethering.
5. Fase 1 como corte vertical.
6. Uma fase por PR após playtest.

## Corte vertical da Fase 1

A Fase 1 implementa o ciclo completo `introdução fixa → encontro por proximidade → ação guiada → desafio procedural → prova final → raiz de conclusão`.

Os blocos `p1-intro` e `p1-final` declaram template, objetivo, condições de conclusão e portão de saída no manifesto. A geometria autoral preserva conexões atravessáveis com os trechos procedurais. A introdução só libera a saída depois de um exsudato real e de um biofilme funcional na raiz de treinamento. A prova final usa o avaliador central e aceita somente um biofilme funcional associado à raiz marcada como `p1-exit-root`; cartão visto ou biofilme em outra raiz não conclui a fase.

O workflow de Pages executa o build e publica o HTML standalone validado, reduzindo divergências de cache entre os módulos-fonte e o jogo implantado.
