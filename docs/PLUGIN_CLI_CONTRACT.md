# Contrato inicial de CLI, IA e plugins

Este contrato é uma base pequena para automação reproduzível; a API de plugins ainda não executa código de terceiros.

## Controle experimental por GRBL

- Inicie o servidor local com `npm start`; ele se vincula somente a `127.0.0.1`.
- Acesse `http://127.0.0.1:4173`, selecione a porta e a taxa serial corretas e confirme a checklist antes de enviar.
- O adaptador emite exclusivamente `G21`, `G90`, `G94`, movimentos XY `G0/G1`, `M4`, `M5` e consultas realtime de estado. Não envia desbloqueio, homing, alterações de parâmetros, comandos de spindle genéricos ou movimento Z.
- Apenas contornos retangulares dentro da área do documento são aceitos. Elementos de texto e geometria fora da área são rejeitados.
- Apenas retângulos sem rotação/distorção são aceitos pelo GRBL. Gravação e corte percorrem contorno; o número de passes, avanço (mm/min), potência (%) e o espaçamento do preenchimento raster (mm) são definidos por camada. Camadas desativadas não são enviadas.
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

`layers` é opcional; se omitido, o núcleo cria uma camada de gravação padrão e associa a ela os elementos sem `layerId`. Cada camada pode declarar `id`, `name`, `operation` (`engrave`, `cut`, `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `enabled`, `visible`, `locked` e `color`. Omitir `layerId` num elemento o associa à primeira camada. Use o mesmo modelo para o editor, CLI e integrações.

## Núcleo compartilhado

Adaptadores devem chamar `src/core/document.js`. Tipos geométricos atuais: `text`, `rect`, `ellipse`, `line` e `path`; caminhos usam `pathData` SVG validado e largura/altura em mm. Transformações opcionais são `rotationDeg`, `skewXDeg` e `skewYDeg`; dimensões/posições são mm e ângulos são graus. A exportação SVG preserva esses elementos e transforms. GRBL aceita somente retângulos sem rotação/distorção; paths importados ainda não são compatíveis com esse adaptador.

`src/core/svg-import.js` converte árvores SVG analisadas para o modelo do núcleo. A interface usa `svgson` 5.3.1 e `svg-pathdata` 6.0.3, ambos MIT, servidos localmente pelo servidor; sem rede ou execução de conteúdo importado. O primeiro subconjunto inclui grupos simples, retângulos, círculos, elipses, linhas, paths, polígonos, polylines e texto plano. Texto aceita transforms afins equivalentes a escala uniforme, rotação e translação; transforms de grupos/formas, escala não uniforme, reflexão e distorção de texto são recusados. Scripts, CSS, referências externas, imagens, handlers de evento e DTD/entidades também são recusados; conteúdo não suportado resulta em erro integral, nunca importação parcial silenciosa. A apresentação/cor do SVG não define a operação de máquina: a camada ativa controla gravação, corte ou preenchimento.

## Plugins e licenciamento

- O sistema de carregamento/execução de plugins ainda não está implementado.
- Plugin distribuído como parte do ecossistema CommBurn deve usar a mesma licença MIT deste repositório, sem licença alternativa ou exceção específica.
- Antes de executar extensões externas, definir manifesto versionado, permissões explícitas, limites de acesso a arquivos/rede/hardware e uma estratégia de validação.
- Adaptadores de máquina não devem presumir sensores; qualquer dependência de hardware deve ser opt-in e visível ao usuário.
