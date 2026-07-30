# Beans for a Living Soil

Protótipo funcional de um jogo de plataforma 2D em Canvas sobre microbiologia do solo, interações rizosféricas, agricultura familiar, segurança alimentar e autonomia produtiva.

O projeto foi modularizado preservando os controles, a física, o layout da fase, a aparência, o áudio, a progressão e as mecânicas do protótipo HTML original.

## Jogar

[Jogar a versão procedural pelo GitHub Pages](https://marcoantoniobarreiros.github.io/Miguelito-Game/)

A publicação é reconstruída automaticamente a partir dos módulos em `src/`. A versão autônoma gerada fica em `dist/index.html` e pode ser aberta diretamente no navegador, sem instalação e sem conexão com a internet.

Para executar a versão modular durante o desenvolvimento, inicie um servidor HTTP na raiz do projeto:

```powershell
python -m http.server 8000
```

Depois acesse `http://127.0.0.1:8000`.

## Comandos

O projeto não possui dependências de produção.

```powershell
# Gerar os HTMLs autônomos em dist/
npm run build

# Gerar a build e executar os testes no navegador
npm test

# Executar somente os testes no navegador
npm run test:browser
```

## Estrutura

- `index.html`: entrada da versão modular.
- `src/`: game loop, input, física, jogador, entidades, áudio, HUD, renderização e dados.
- `tests/`: testes de carregamento e das mecânicas principais no navegador.
- `scripts/build.cjs`: geração da distribuição HTML autônoma.
- `dist/`: artefatos autônomos prontos para distribuição.
- `docs/`: design, biologia, mecânicas, linguagem visual e fluxo da fase.
- `AGENTS.md`: diretrizes permanentes para agentes que trabalhem no projeto.

## Controles

- Movimento: `A`/`D` ou setas direcionais.
- Salto: `W`, seta para cima ou `Espaço`.
- Dash: `Shift`.
- Pulso mineral: `E`.

As habilidades adicionais são liberadas durante a progressão da fase.
