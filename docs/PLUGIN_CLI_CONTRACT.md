# Contrato inicial de CLI, IA e plugins

Este contrato é uma base pequena para automação reproduzível; a API de plugins ainda não executa código de terceiros.

## Controle experimental por GRBL

- Inicie o servidor local com `npm start`; ele se vincula somente a `127.0.0.1`.
- Acesse `http://127.0.0.1:4173`, selecione a porta e a taxa serial corretas e confirme a checklist antes de enviar.
- O adaptador emite exclusivamente `G21`, `G90`, `G94`, movimentos XY `G0/G1`, `M4`, `M5` e consultas realtime de estado. Não envia desbloqueio, homing, alterações de parâmetros, comandos de spindle genéricos ou movimento Z.
- Apenas contornos retangulares dentro da área do documento são aceitos. Elementos de texto e geometria fora da área são rejeitados.
- Retângulos e paths vetoriais sem rotação/distorção são aceitos pelo GRBL. Paths SVG são achatados para segmentos lineares; gravação e corte percorrem contornos e podem definir potência percentual própria no path. Preenchimento ainda aceita apenas retângulos. O número de passes, avanço (mm/min), potência (%) e o espaçamento/padrão do preenchimento são definidos por camada. Camadas desativadas não são enviadas.
- `planGrblJob` gera o G-code e uma lista compartilhada de trajetórias para a prévia; `renderGrblJob` continua retornando o G-code como texto. `G0` entre trajetórias é sempre precedido por `M5`. O primeiro deslocamento depende da posição real da cabeça, que não é inferida por sensores.
- `$30` (escala de potência) e `$32` (modo laser dinâmico) dependem da máquina; o usuário deve conferir sua configuração. O adaptador não ajusta valores `$`.
- Cada comando aguarda `ok`; erros/alarmes interrompem o envio. A aplicação consulta o estado até confirmação de `Idle`; a ação de pausa envia feed hold `!` e não substitui parada de emergência.
- Não prometa compatibilidade com máquinas sem protocolo GRBL confirmado. Teste primeiro sem material e com o laser desativado.

## Referências e licenças de controlador

- [CNCjs](https://github.com/cncjs/cncjs) é um projeto MIT de interface/sender com suporte declarado a Grbl, Marlin, Smoothieware e TinyG. É referência de ecossistema; o CommBurn não incorpora seu código.
- [node-serialport](https://github.com/serialport/node-serialport) é a dependência MIT usada para acesso serial local.
- O firmware [Grbl](https://github.com/gnea/grbl) é GPLv3, não uma dependência nem código incorporado pelo CommBurn. O adaptador implementa comunicação serial com um controlador configurado pelo usuário; não redistribui firmware.

## CLI e ferramentas de IA

O comando `node cli/commburn.mjs entrada.json saida.svg` lê UTF-8 JSON com este formato:

```json
{
  "widthMm": 180,
  "heightMm": 120,
  "origin": {
    "corner": "top-left",
    "flipX": false,
    "flipY": false
  },
  "elements": [
    {
      "id": "label-1",
      "type": "text",
      "xMm": 10,
      "yMm": 20,
      "text": "Exemplo",
      "fontSizeMm": 8,
      "fontFamily": "sans-serif"
    }
  ]
}
```

`origin.corner` aceita `top-left`, `top-right`, `bottom-left` ou `bottom-right`. A origem e as inversões são informadas pelo usuário; não há leitura de sensores. Medidas e coordenadas são milímetros. A CLI retorna erro não-zero e mensagem clara para JSON ou documentos inválidos.

`layers` é opcional; se omitido, o núcleo cria uma camada de gravação padrão e associa a ela os elementos sem `layerId`. Cada camada pode declarar `id`, `name`, `operation` (`engrave`, `cut`, `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `fillAlgorithm`, `objectOrder`, `enabled`, `visible`, `locked` e `color`. `fillAlgorithm` aceita `horizontal-serpentine`, `vertical-serpentine`, `crosshatch` ou `horizontal-unidirectional`; `objectOrder` aceita `document`, `nearest` (vizinho mais próximo, iniciando na origem configurada) ou `center-out`. Omitir `layerId` num elemento o associa à primeira camada. Use o mesmo modelo para o editor, CLI e integrações.

O formato de projeto editável da interface é JSON UTF-8 no envelope `{ "format": "commburn-project", "version": 1, "document": ... }`. `src/core/project.js` exporta `serializeProject` e `parseProject`; ambos validam pelo núcleo de documentos e rejeitam versões desconhecidas. A interface limita projetos a 50 MB. A exportação de produção é G-code GRBL para o subconjunto aceito, não um formato universal de máquina.

## Núcleo compartilhado

Adaptadores devem chamar `src/core/document.js`. Tipos atuais: `text`, `rect`, `ellipse`, `line`, `path`, `image` e `svg-image`; caminhos usam `pathData` SVG validado e podem definir `powerPercent`, raster usa `imageDataUri` PNG/JPEG/WebP, e SVG visual usa `svgDataUri` sanitizado. Imagens exigem largura e altura em mm; raster pode declarar `preserveAspectRatio`. Transformações opcionais são `rotationDeg`, `skewXDeg` e `skewYDeg`; dimensões/posições são mm e ângulos são graus. A exportação SVG preserva esses elementos e transforms. GRBL aceita retângulos e paths lineares sem rotação/distorção; paths curvos são achatados no núcleo e imagem raster original/SVG visual continuam recusados. A interface edita fontes raster com `@jodit/image-editor` local, converte imagens em PNG incorporado e oferece riscos/pontilhamento tonal ou contornos ImageTracerJS em paths editáveis. A conversão aceita até 2 milhões de amostras e 15.000 paths por saída.

`src/core/svg-import.js` oferece preservação visual do SVG e conversão de um subconjunto em objetos editáveis. O modo visual incorpora filtros, gradientes, máscaras, padrões, CSS, animações e recursos reconhecidos pelo renderizador SVG; o modo editável converte grupos, formas básicas, caminhos, texto plano e imagens raster incorporadas, aplicando transforms `matrix`, `translate`, `scale`, `rotate`, `skewX` e `skewY` compostos em grupos/elementos. Formas giradas ou distorcidas são convertidas em paths; transforms de texto devem preservar escala uniforme e imagens aceitam eixos ortogonais sem reflexão. A importação raster avulsa também incorpora o arquivo e usa escala inicial de 96 dpi, ajustada à prancheta métrica. SVGs exportados pelo CommBurn recuperam cores e configurações das camadas; elementos genéricos com cores simples são organizados em camadas. `DOCTYPE svg` é removido sem buscar DTDs externos; entidades internas textuais simples são expandidas sob limites de tamanho/recursão, mas entidades externas/de parâmetro e defaults `ATTLIST` não são suportados. Referências XML predefinidas e numéricas são decodificadas. Scripts e atributos de evento são removidos; `foreignObject` é preservado com sua árvore sanitizada; CSS `@import`, URLs externas e imagens remotas não são preservados/carregados. A operação de máquina continua explícita na camada, não deduzida da imagem ou de sensores.

## Plugins e licenciamento

- O sistema de carregamento/execução de plugins ainda não está implementado.
- Plugin distribuído como parte do ecossistema CommBurn deve usar a mesma licença MIT deste repositório, sem licença alternativa ou exceção específica.
- Antes de executar extensões externas, definir manifesto versionado, permissões explícitas, limites de acesso a arquivos/rede/hardware e uma estratégia de validação.
- Adaptadores de máquina não devem presumir sensores; qualquer dependência de hardware deve ser opt-in e visível ao usuário.
