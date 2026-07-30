# Geração procedural de fases

## 1. Propósito

A geração procedural deve produzir fases variadas, reproduzíveis por seed e compatíveis
com a física real do jogador, sem comprometer:

- progressão das habilidades;
- clareza visual;
- precisão temática;
- ritmo de plataforma;
- acessibilidade das rotas obrigatórias;
- ausência de softlocks;
- momentos narrativos e educativos.

A meta não é gerar ruído aleatório. A meta é gerar uma sequência intencional de desafios
a partir de regras explícitas e validáveis.

---

## 2. Estratégia recomendada

Usar uma arquitetura híbrida e orientada pelo caminho:

1. gerar o grafo lógico da fase;
2. definir quais habilidades estão disponíveis em cada trecho;
3. selecionar primitivas de movimento produzidas pela física canônica;
4. converter o caminho lógico em geometria;
5. validar a geometria com agentes simulados;
6. reparar ou rejeitar trechos inválidos;
7. aplicar decoração, ecossistemas e eventos biológicos;
8. manter a fase reproduzível pela mesma seed.

Não começar pela geração de cavernas ou pela distribuição aleatória de plataformas.

---

## 3. Campanha e modo infinito

### Campanha principal

A campanha deve ser semiprocedural.

Elementos controlados:

- ordem dos organismos;
- progressão das habilidades;
- acontecimentos narrativos;
- demonstrações das funções biológicas;
- checkpoints importantes;
- clímax e saída da fase.

Elementos variáveis:

- curvas locais das raízes;
- posições dentro de faixas seguras;
- rotas opcionais;
- distribuição de recursos;
- desafios secundários;
- decoração e composição ambiental;
- variantes aprovadas de um mesmo encontro.

### Modo “Rizosfera Infinita”

Pode usar geração contínua em trechos, inspirada na cadência de endless runners.

Exemplos de objetivos:

- ativar colônias resistentes;
- transportar fósforo;
- proteger regiões lesionadas;
- capturar ferro;
- atravessar determinada distância;
- manter indicadores ecológicos acima de um limite.

A geração infinita não deve substituir a campanha educativa.

---

## 4. Grafo lógico e causalidade

O gerador deve montar a progressão antes da geometria.

Progressão canônica atual:

```text
entrada
→ salto simples
→ Azospirillum
→ salto duplo
→ Micorriza
→ dash
→ Bacillus/checkpoint
→ PGPB solubilizadora
→ pulso mineral
→ Pseudomonas/campo sideróforo
→ saída
```

Regras:

- uma habilidade deve ser obtida antes de qualquer gargalo obrigatório que dependa dela;
- a habilidade recém-adquirida deve ser apresentada em desafio simples antes de ser combinada;
- obstáculos opcionais podem exigir domínio avançado, mas não podem bloquear a rota principal;
- quando houver retorno obrigatório, o grafo deve garantir o caminho de volta;
- atalhos podem conectar o final de uma região a uma rota já visitada;
- o gerador deve registrar dependências de cada nó e cada aresta.

Estrutura conceitual:

```js
{
  id: "challenge-double-jump-01",
  type: "movementChallenge",
  requires: ["doubleJump"],
  grants: [],
  mandatory: true,
  difficultyTarget: "comfortable"
}
```

---

## 5. Física canônica

O gerador, o validador e o personagem jogável devem usar a mesma implementação de:

- timestep fixo;
- gravidade;
- aceleração e desaceleração;
- velocidade máxima;
- controle aéreo;
- salto variável;
- coyote time;
- jump buffer;
- salto duplo;
- dash;
- colisão;
- dimensões do personagem;
- resposta em bordas e plataformas.

É proibido criar uma física paralela simplificada para o gerador.

Equações balísticas podem ser usadas para estimativa inicial, mas não são suficientes para
aprovar uma transição.

---

## 6. Biblioteca de primitivas de movimento

Gerar as primitivas executando a física real sem renderização.

Primitivas iniciais:

- salto parado curto;
- salto parado longo;
- salto correndo curto;
- salto correndo longo;
- salto duplo precoce;
- salto duplo intermediário;
- salto duplo tardio;
- dash no solo;
- dash no ar;
- salto seguido de dash;
- dash seguido de salto duplo;
- salto duplo seguido de dash;
- queda controlada;
- descida para plataforma inferior;
- retorno para plataforma anterior.

Registrar para cada amostra:

```js
{
  id: "running-double-jump-late",
  requires: ["doubleJump"],
  startVelocity: { x: 0, y: 0 },
  displacement: { x: 248, y: -96 },
  duration: 0.92,
  landingVelocity: { x: 214, y: 182 },
  recommendedLandingWidth: 64,
  timingToleranceMs: 115,
  classification: "comfortable"
}
```

Não registrar apenas os alcances máximos. O gerador precisa conhecer faixas e tolerâncias.

---

## 7. Classificação de dificuldade

### Confortável

- grande margem de aterrissagem;
- aceita variação de timing;
- não exige velocidade perfeita;
- apropriada para rota principal;
- adequada logo após a aquisição de uma habilidade.

### Difícil

- margem menor;
- exige combinação ou timing mais preciso;
- pode aparecer ocasionalmente na rota principal depois de treinamento;
- apropriada para bônus e rotas opcionais.

### Limite físico

- depende de execução quase perfeita;
- margem mínima;
- sensível a pequenas diferenças de entrada ou frame;
- proibida em caminhos obrigatórios;
- permitida apenas em desafios opcionais explicitamente marcados.

Meta inicial:

- maioria confortável;
- no máximo 10% de transições difíceis na rota principal;
- zero transições no limite físico na rota principal.

---

## 8. Geração geométrica

O gerador deve criar o caminho principal primeiro.

Fluxo sugerido:

```text
nó lógico
→ escolha de primitiva válida
→ plataforma de origem
→ posição alvo prevista
→ largura de aterrissagem
→ margem de segurança
→ validação
```

As plataformas podem ser representadas como:

- segmentos;
- retângulos temporários durante desenvolvimento;
- curvas/splines de raízes na apresentação final;
- superfícies derivadas da mesma curva usada para renderização.

A colisão e a imagem da raiz devem compartilhar a mesma fonte geométrica.

Parâmetros úteis:

- largura mínima;
- faixa de altura;
- inclinação máxima;
- espaço de aceleração antes do salto;
- espaço de frenagem após a aterrissagem;
- clearance vertical;
- distância de perigos;
- margem para erro de timing;
- visibilidade da próxima plataforma.

---

## 9. Geração em trechos

Para geração contínua, dividir o mundo em trechos reproduzíveis.

Exemplo:

```text
2 trechos mantidos atrás
1 trecho atual
4 trechos preparados à frente
```

Tipos de trecho:

- respiro;
- tutorial de habilidade;
- exploração;
- salto vertical;
- travessia horizontal;
- dash;
- combinação;
- organismo;
- checkpoint;
- ameaça;
- recompensa;
- transição de bioma;
- clímax.

Gramática de ritmo:

- habilidade nova → demonstração segura → teste simples → combinação;
- desafio difícil → respiro ou checkpoint;
- evitar três ameaças intensas consecutivas;
- evitar repetição excessiva da mesma primitiva;
- inserir pistas visuais antes de mudanças bruscas;
- não colocar checkpoint imediatamente antes de um trecho trivial.

---

## 10. Validação por agentes

Depois da geração, simular a fase pronta.

Agentes mínimos:

### Conservador

- evita velocidade máxima;
- salta com antecedência;
- prefere centro das plataformas;
- usa habilidades apenas quando claramente necessárias.

### Normal

- timing médio;
- combina habilidades de forma consistente;
- representa a rota principal esperada.

### Habilidoso

- usa aceleração máxima;
- aceita margens menores;
- verifica rotas opcionais e atalhos.

### Agentes com erro

Executar variantes com pequenas perturbações:

- salto alguns milissegundos cedo ou tarde;
- velocidade ligeiramente menor;
- salto duplo precoce ou tardio;
- dash com pequeno desvio;
- aterrissagem fora do centro.

Uma transição obrigatória não deve ser aceita apenas porque um agente perfeito a completou.

---

## 11. Critérios de aceitação

Para o primeiro protótipo:

- gerar 100 trechos consecutivos;
- mesma seed gera o mesmo resultado;
- zero plataformas obrigatórias inalcançáveis;
- zero dependências prematuras de habilidades;
- zero softlocks;
- zero transições no limite físico na rota principal;
- no máximo 10% de transições difíceis obrigatórias;
- margem de aterrissagem registrada;
- testes automatizados da geração;
- teste automatizado de reprodutibilidade;
- demonstração jogável no navegador;
- tela de depuração disponível.

Dados de depuração:

- seed;
- número do trecho;
- nó lógico;
- habilidade necessária;
- primitiva escolhida;
- deslocamento previsto;
- classificação;
- margem de aterrissagem;
- agente que validou;
- número de tentativas de reparo;
- resultado final.

---

## 12. Reparação e rejeição

Quando uma transição falhar, tentar nesta ordem:

1. aumentar a largura da plataforma de destino;
2. reduzir a distância horizontal;
3. reduzir a diferença vertical;
4. adicionar espaço de aceleração;
5. trocar por uma primitiva mais confortável;
6. inserir uma plataforma intermediária;
7. criar rota alternativa;
8. rejeitar e regenerar o trecho.

Definir limite de tentativas para evitar loops infinitos.

O gerador deve registrar o motivo do reparo ou rejeição.

---

## 13. Autômatos celulares e ruído

Podem ser usados para:

- textura do solo;
- poros;
- rochas secundárias;
- matéria orgânica;
- cavidades decorativas;
- fundos;
- distribuição visual de partículas.

Não devem definir sozinhos a rota principal.

Se utilizados para gerar massa de terreno, o caminho validado deve ser protegido e preservado.

---

## 14. Performance

A geração não deve ocorrer de forma pesada no mesmo quadro da jogabilidade.

Opções:

- gerar a fase antes do início;
- gerar alguns trechos à frente em lotes;
- distribuir trabalho entre vários frames;
- usar Web Worker quando o custo justificar;
- manter cache por seed;
- separar geração lógica de criação de recursos gráficos.

Medir antes de implementar otimizações complexas.

---

## 15. Reprodutibilidade

Toda aleatoriedade deve vir de um gerador pseudoaleatório com seed explícita.

Evitar `Math.random()` dentro do gerador de fases.

Registrar:

```js
{
  seed: "solo-vivo-2026-001",
  generatorVersion: "0.1.0",
  physicsVersion: "0.3.0",
  levelConfigVersion: "0.1.0"
}
```

Uma mudança na física pode invalidar fases antigas. Por isso, a versão da física deve acompanhar
a seed nos relatórios e testes.

---

## 16. Escopo do primeiro experimento

O primeiro experimento deve ser separado da fase principal.

Incluir apenas:

- jogador;
- plataformas;
- física canônica;
- geração;
- agentes validadores;
- interface de depuração;
- seleção e cópia de seed.

Não incluir inicialmente:

- inimigos;
- áudio;
- narrativa;
- microrganismos renderizados;
- partículas decorativas;
- biomas;
- sistema completo de campanha.

O objetivo é provar conectividade, acessibilidade, dificuldade e reprodutibilidade.

---

## 17. Fora do escopo inicial

- substituição da campanha existente;
- geração infinita definitiva;
- editor visual completo;
- integração com Tiled;
- ECS completo;
- otimizações prematuras de renderização;
- geração procedural de narrativa;
- balanceamento final;
- multiplayer.

---

## 18. Resultado esperado da implementação

A implementação deve entregar:

1. módulo de PRNG com seed;
2. biblioteca de primitivas derivada da física canônica;
3. grafo lógico linear inicial;
4. gerador de plataformas;
5. classificação de dificuldade;
6. agentes validadores;
7. reparação/rejeição;
8. testes;
9. tela de depuração;
10. relatório de limitações.

A fase principal atual permanece intacta até aprovação explícita.
