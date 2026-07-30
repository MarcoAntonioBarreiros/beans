# Phase Lab

O Phase Lab e um modo de desenvolvimento opt-in para ajustar uma fase usando o mesmo runtime da campanha. Ele nao possui um gerador alternativo nem um editor grafico de plataformas.

## Acesso

Abra o jogo com `?phaseLab=1` no fim da URL. Exemplos:

- desenvolvimento: `index.html?phaseLab=1`
- build standalone: `dist/index.html?phaseLab=1`

Sem esse parametro, o jogo usa exclusivamente o manifesto normal e nao monta o painel.

## Controles

O painel permite alterar:

- fase, seed, titulo, tema e missao;
- quantidade de chunks e segmentos completos em JSON;
- organismos vagantes e patogenos permitidos;
- quantidades deterministicas de exsudatos, cristais e checkpoints;
- objetivo e condicoes da prova final.

`Aplicar e reiniciar`, `R` e `Ctrl+Enter` reiniciam rapidamente a configuracao atual. `Nova seed` mantem os demais parametros e troca apenas a seed. A configuracao e preservada no armazenamento local do navegador, separada do progresso normal da campanha.

## Exportacao

`Exportar manifesto` baixa uma entrada completa de fase no mesmo formato de `campaign-manifest.js`. O bloco adicional `phaseLab` registra seed, filtros de organismos e quantidades de recursos usadas no ensaio. Esse bloco pode ser removido ao incorporar os ajustes definitivamente ao manifesto da campanha.

O override e validado antes do reinicio. Intervalos de segmentos, apresentacoes, desbloqueios e condicoes finais invalidos sao recusados com diagnostico no painel.

## Limite intencional desta versao

O Phase Lab nao permite arrastar, redimensionar ou desenhar plataformas. A geometria continua sendo produzida pelo gerador e pelos blocos fixos reais; o ajuste visual de plataformas fica para uma etapa futura separada.
