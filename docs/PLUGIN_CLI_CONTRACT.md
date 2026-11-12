# Contrato inicial de CLI, IA e plugins

Este contrato define automação reproduzível e o host de plugins locais da versão desktop empacotada. O editor web e `npm start` não executam plugins externos.

## TABUS de compatibilidade

**TABU:** nunca descartar, reinterpretar ou rasterizar conteúdo de um projeto editável para contornar incompatibilidade. Toda mudança persistida exige versão, conversões explícitas e fixtures que comparem modelo e renderização; consulte o [contrato do formato](./PROJECT_FORMAT.md).

## Controle experimental por GRBL

- Inicie o servidor local com `npm start`; ele se vincula somente a `127.0.0.1`.
- Acesse `http://127.0.0.1:4173`, selecione a porta e a taxa serial corretas e confirme a checklist antes de enviar.
- O adaptador emite exclusivamente `G21`, `G90`, `G94`, movimentos XY `G0/G1`, `M4`, `M5` e consultas realtime de estado. Não envia desbloqueio, homing, alterações de parâmetros, comandos de spindle genéricos ou movimento Z.
- Texto, retângulos e paths vetoriais editáveis sem transformação, dentro da área do documento, são aceitos pelo GRBL. Texto usa contornos das fontes OpenType DejaVu incorporadas e os mesmos arquivos de fonte são usados no SVG do editor/exportado. `sans-serif`, `serif` e `monospace` selecionam as faces sem serifa, serifada e monoespaçada; caracteres fora da cobertura incorporada geram erro explícito, nunca são omitidos. A operação da camada controla texto: `fill` usa o algoritmo e o espaçamento configurados; `engrave` e `cut` percorrem contornos de glifos. SVG visual e imagem raster são preservados como referências e não são aceitos diretamente pelo GRBL. Imagem raster pode ser vetorizada localmente; SVG visual deve ser reimportado em modo editável para criar trajetórias nativas. A importação vetorial pode separar camadas por cor ou direcionar geometria compatível à camada ativa, que define sua cor. Elipses, linhas e formas transformadas são rejeitadas como geometria de máquina. A licença das fontes está em `src/core/fonts/LICENSE`.
- Paths SVG são achatados para segmentos lineares; gravação e corte percorrem contornos e podem definir potência percentual própria no path. Preenchimento aceita retângulos e paths fechados por linhas de varredura; furos são preservados e paths abertos são rejeitados. O número de passes, avanço (mm/min), potência (%) e o espaçamento/padrão do preenchimento são definidos por camada. Camadas desativadas não são enviadas.
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

### Idioma da CLI

`--locale en` ou `--locale pt-BR` pode ser informado após os caminhos. A resolução segue esta ordem: opção `--locale`, `COMMBURN_LOCALE`, `LANG` e fallback `pt-BR`. Aliases `en-*` são aceitos como inglês; `pt` e `pt-*` são aceitos como português brasileiro. Locale explícito inválido retorna código de saída `2`. Falhas de leitura, JSON inválido, validação do documento e gravação do SVG retornam código `1` com mensagem localizada em `stderr`.

```sh
node cli/commburn.mjs job.json job.svg --locale en
COMMBURN_LOCALE=pt-BR node cli/commburn.mjs job.json job.svg
```

O SVG gerado e o formato JSON de entrada não dependem do idioma selecionado.

`layers` é opcional; se omitido, o núcleo cria uma camada de gravação padrão e associa a ela os elementos sem `layerId`. Cada camada pode declarar `id`, `name`, `operation` (`engrave`, `cut`, `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `fillAlgorithm`, `objectOrder`, `enabled`, `visible`, `locked` e `color`. `fillAlgorithm` aceita `horizontal-serpentine`, `vertical-serpentine`, `crosshatch`, `horizontal-unidirectional`, `vertical-unidirectional`, `diagonal-serpentine` ou `diagonal-crosshatch`; `objectOrder` aceita `document`, `nearest` (vizinho mais próximo, iniciando na origem configurada) ou `center-out`. Omitir `layerId` num elemento o associa à primeira camada. Use o mesmo modelo para o editor, CLI e integrações.

O formato de projeto editável da interface é JSON UTF-8 no envelope `{ "format": "commburn-project", "version": 2, "units": "mm", "document": ... }`. `src/core/project.js` exporta `serializeProject` e `parseProject`; `src/core/project-conversions.js` migra versões suportadas antes de validar pelo núcleo e recusa versões desconhecidas. **TABU:** não mudar o schema sem incrementar a versão e testar conversões de todas as fixtures antigas com preservação do modelo e da renderização. Consulte o [contrato de formato e conversões](./PROJECT_FORMAT.md). A interface limita projetos a 50 MB. A exportação de produção é G-code GRBL para o subconjunto aceito, não um formato universal de máquina.

## Núcleo compartilhado

Adaptadores devem chamar `src/core/document.js`. Tipos atuais: `text`, `rect`, `ellipse`, `line`, `path`, `image` e `svg-image`; caminhos usam `pathData` SVG validado e podem definir `color`, `powerPercent`, `fillColorMode` (`image`, `layer`, `none`), `strokeColorMode` (`image`, `layer`, `none`) e `strokeWidthMm`, raster usa `imageDataUri` PNG/JPEG/WebP, e SVG visual usa `svgDataUri` sanitizado. Imagens exigem largura e altura em mm; raster pode declarar `preserveAspectRatio`. Transformações opcionais são `rotationDeg`, `skewXDeg` e `skewYDeg`; dimensões/posições são mm e ângulos são graus. A exportação SVG preserva esses elementos e transforms. GRBL aceita retângulos e paths lineares sem rotação/distorção; paths curvos são achatados no núcleo e imagem raster original/SVG visual continuam recusados. A interface edita fontes raster com `@jodit/image-editor` local e converte imagens em PNG incorporado; ImageTracerJS cria paths sólidos independentes por região/cor, todos na camada atual, com seleção de cores antes da aplicação. A conversão aceita até 2 milhões de amostras e 15.000 paths por saída.

`src/core/svg-import.js` oferece preservação visual do SVG e conversão de um subconjunto em objetos editáveis. O modo visual incorpora filtros, gradientes, máscaras, padrões, CSS, animações e recursos reconhecidos pelo renderizador SVG; o modo editável converte grupos, formas básicas, caminhos, texto plano e imagens raster incorporadas, aplicando transforms `matrix`, `translate`, `scale`, `rotate`, `skewX` e `skewY` compostos em grupos/elementos. Formas giradas ou distorcidas são convertidas em paths; transforms de texto devem preservar escala uniforme e imagens aceitam eixos ortogonais sem reflexão. A importação raster avulsa também incorpora o arquivo e usa escala inicial de 96 dpi, ajustada à prancheta métrica. SVGs exportados pelo CommBurn recuperam cores e configurações das camadas; elementos genéricos com cores simples são organizados em camadas. `DOCTYPE svg` é removido sem buscar DTDs externos; entidades internas textuais simples são expandidas sob limites de tamanho/recursão, mas entidades externas/de parâmetro e defaults `ATTLIST` não são suportados. Referências XML predefinidas e numéricas são decodificadas. Scripts e atributos de evento são removidos; `foreignObject` é preservado com sua árvore sanitizada; CSS `@import`, URLs externas e imagens remotas não são preservados/carregados. A operação de máquina continua explícita na camada, não deduzida da imagem ou de sensores.

## Plugins e licenciamento

- A partir de `0.1.2`, o núcleo do CommBurn é GNU AGPL-3.0-only. Versões até `0.1.1` permanecem MIT conforme publicadas. Plugins independentes podem manter uma licença permissiva; `LICENSE-PLUGINS` disponibiliza o texto MIT como referência para autores de plugins. A licença de um plugin não relicencia o núcleo, e a licença aplicável a uma distribuição combinada depende da relação entre os componentes.
- A versão desktop empacotada carrega plugins locais em `app.getPath("userData")/plugins/<id>/`. Crie `manifest.json` e `plugin.mjs` em cada subdiretório e reinicie o CommBurn. O módulo precisa exportar `activate(context)`; o manifesto é:

```json
{
  "id": "marcador-demo",
  "name": "Marcador de demonstração",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "plugin.mjs",
  "locales": {
    "en": "locales/en.json",
    "pt-BR": "locales/pt-BR.json"
  }
}
```

Crie os dois catálogos dentro de `locales/`:

```json
{"button":{"label":"Say hello"},"notification":"Hello from the plugin."}
```

```json
{"button":{"label":"Dizer olá"},"notification":"Olá do plugin."}
```

Crie `plugin.mjs` no mesmo diretório. Este exemplo atualiza o botão quando o usuário troca o idioma e cancela ambos os listeners ao desativar:

```js
export function activate(context) {
  const button = document.createElement("button");
  button.type = "button";
  const updateLabel = () => { button.textContent = context.i18n.t("button.label"); };
  updateLabel();
  const unsubscribe = context.i18n.onLocaleChange(updateLabel);
  button.addEventListener("click", () => context.notify(context.i18n.t("notification")));
  const unregister = context.registerExtension("toolbar-tools", button);
  return () => { unsubscribe(); unregister(); };
}
```

- API v1 expõe `context.plugin`, `context.document.get()`, `context.document.addElement(element)`, `context.registerExtension(slot, htmlElement)` e `context.notify(message)`. `addElement` usa o núcleo compartilhado para validar e salvar a geometria; a camada ativa desbloqueada é usada quando `layerId` não é informado. O registro de UI aceita os slots documentados em [UI_ARCHITECTURE.md](./UI_ARCHITECTURE.md) e monta no primeiro slot correspondente.
- **Localização disponível:** o manifesto pode mapear `locales.en` e `locales.pt-BR` aos caminhos exatos `locales/en.json` e `locales/pt-BR.json`. O host rejeita symlinks, arquivos não declarados e catálogos acima de 256 KiB; plugins sem catálogos continuam válidos. `context.i18n` oferece `locale`, `t(key, values)`, `formatError(error)` e `onLocaleChange(handler)`. O idioma acompanha o seletor da interface. Consulte o [plano de internacionalização](./INTERNATIONALIZATION_PLAN.md) para lacunas restantes de cobertura.
- Cada plugin é um módulo local autocontido `plugin.mjs`; imports remotos e submódulos externos não são servidos pelo host. Plugins têm acesso ao DOM e à origem local do aplicativo, incluindo a API serial. Eles executam no contexto do renderer e **não são sandboxed**: instale somente código que você revisou e confia. Remova a pasta do plugin e reinicie o app para desativá-lo.
- O servidor iniciado por `npm start` não recebe diretório de plugins e retorna uma lista vazia. Plugins não são carregados de URLs remotas nem incluídos automaticamente no instalador.
- Adaptadores de máquina não devem presumir sensores; qualquer dependência de hardware deve ser opt-in e visível ao usuário.
