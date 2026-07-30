# Beans for a Living Soil

Este repositório contém o protótipo jogável 2D em Canvas de **Beans for a Living Soil**.

## Diretrizes para agentes

- Preserve comportamento, controles, física, layout da fase, aparência, áudio, progressão e mecânicas quando fizer refatorações.
- Trate `index.html` como a entrada de desenvolvimento e `dist/index.html` como artefato gerado por build.
- Use `npm run build` ou `node scripts/build.cjs` para gerar o HTML autônomo em `dist/`.
- Use `npm test` ou `node scripts/build.cjs` seguido de `node tests/browser-smoke.cjs` para validar o protótipo.
- Não faça melhorias visuais em tarefas de manutenção, exceto quando o pedido for explicitamente de design.
- Mantenha dados da fase em `src/data/level.js` e regras de microbioma em `src/data/microbes.js`.
- Atualize `docs/` quando alterar mecânicas, linguagem visual, regras biológicas ou fluxo da fase.

## Mapa dos módulos

- `src/main.js`: bootstrap, botões, modo de teste e composição dos sistemas.
- `src/game-loop.js`: loop principal e step manual para testes.
- `src/input.js`: teclado, toque e API de input dos testes.
- `src/physics.js`: movimento, colisões, coleta, checkpoint, pulso e conclusão.
- `src/player.js`: estado inicial e reset do jogador.
- `src/entities.js`: partículas, descoberta de microrganismos, reset e respawn.
- `src/render/renderer.js`: renderização do mundo, jogador e telas de fundo.
- `src/render/microbes.js`: renderização procedural dos microrganismos.
- `src/audio.js`: síntese procedural e progressão de camadas.
- `src/hud.js`: HUD, telas, toast, prompt e medidores.
- `src/data/level.js`: plataformas, hazards, cristais, aliados, inimigos e elementos de fundo.
- `src/data/microbes.js`: catálogo, encontros e arte procedural microbiana.
