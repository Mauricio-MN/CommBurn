# Arquitetura da interface CommBurn

Este guia descreve os limites atuais da interface e como acrescentar ferramentas sem duplicar geometria, unidades ou comportamento.

## TABUS de compatibilidade

**TABU:** nunca remova, rasterize ou reinterprete dados de um projeto editável para fazer uma atualização funcionar. Mudanças no schema exigem nova versão, conversões explícitas por versão e testes com fixtures que comparem modelo e SVG renderizado. Preserve o original; consulte o [contrato do formato](./PROJECT_FORMAT.md).

## Módulos do navegador

- `src/app.js`: composição dos módulos, estado de documento e ligação dos controles.
- `src/ui/plugins.js`: carregador desktop local API v1 para os slots de extensão documentados.
- `src/ui/toolbar.js`: catálogo de ferramentas, atalhos visuais e estado ativo.
- `src/ui/canvas-controller.js`: seleção, conversão de coordenadas SVG/mm e interações de ponteiro.
- `src/ui/selection.js`: operações puras para substituir, alternar e combinar conjuntos selecionados.
- `src/ui/layers-panel.js`: interface delegada de camadas e configurações de operação.
- `src/ui/history.js`: snapshots imutáveis para desfazer/refazer.
- `src/ui/shortcuts.js`: mapeamento global de atalhos; preserva a digitação em controles editáveis.
- `src/ui/tooltips.js`: descrições nativas (`title`) e acessíveis (`aria-description`).
- `src/ui/presentation.js`: documento de demonstração temporário e filtragem das formas aceitas na simulação.
- `src/core/document.js`: normalização, validação, transformações e exportação compartilhadas.
- `src/core/svg-import.js`: conversão controlada de SVG em elementos métricos do núcleo. Caminhos com preenchimento e traço de cores diferentes viram dois objetos (preenchimento e traço) também na camada atual; com "dividir formas", cada subcaminho vira objetos próprios. A operação da camada altera só a aparência e a usinagem, nunca o objeto: `fill` preenche, gravação/corte mostram o contorno com a espessura real do traço; objetos continuam clicáveis por dentro. Importações maiores que a mesa são reduzidas proporcionalmente.

O núcleo não depende de DOM. A interface encaminha as operações ao modelo comum; não converta pixels em medidas por uma implementação paralela.

## Internacionalização

`src/core/i18n.js` resolve os locales suportados (`en`, `pt-BR`), faz fallback e formata mensagens sem depender do DOM. A interface persiste a escolha em `commburn.locale`; o locale não faz parte do documento. `translateDom` traduz elementos marcados e a toolbar, painel de camadas e atalhos recebem o tradutor para conteúdo dinâmico. A cobertura de diálogos, inspetor, máquina e notificações ainda está incompleta. Consulte o [plano e estado da internacionalização](./INTERNATIONALIZATION_PLAN.md).

## Prancheta e régua

A barra de cabeçalho da tela de desenho é seguida por uma área de trabalho alinhada ao topo; não há centralização vertical que deixe a prancheta distante do cabeçalho. A régua X ocupa a mesma coluna CSS que o SVG; a régua Y ocupa a mesma linha. O desenho usa `viewBox` em mm e preserva sua proporção de aspecto. Os rótulos das réguas são gerados da dimensão real atual, e o tamanho da prancheta é recalculado quando a janela, área de visualização ou dimensões mudam. Assim, a régua não usa posições relativas estimadas a partir da tela inteira.

## Objetos e ações

Tipos do modelo atual: `text`, `rect`, `ellipse`, `line`, `path`, `image` e `svg-image`. Caminhos mantêm dados SVG editáveis e são editados em subeditor visual separado, com âncoras e alças cúbicas; arcos e curvas suaves são normalizados para segmentos cúbicos. Paths podem carregar cor individual e modos de preenchimento/borda validados. Na vetorização de imagem, a prévia mantém as cores da imagem; paths aplicados usam sempre a cor dinâmica da camada. A borda é opcional, usa a cor da camada e tem espessura métrica. A edição de imagem usa `@jodit/image-editor` local (MIT); seu CSS injetado é a razão para permitir estilos inline no CSP, enquanto scripts seguem restritos à origem local e os pacotes têm rotas allowlisted. ImageTracerJS roda em Web Worker e converte cada região da imagem em um path fechado, sem gerar camadas. A paleta permite incluir/excluir cores antes de aplicar; o preview limita a entrada a 2 milhões de amostras e a saída a 15.000 paths, substituindo a imagem fonte (Desfazer restaura). A conversão usa a camada atual e exige imagem sem transforms. SVG estático incorporado continua sendo objeto visual, sem vetorizar. Dimensões e coordenadas são milímetros; rotação e distorção são graus. `rotationDeg` gira em torno do centro geométrico (texto: ponto de ancoragem); `skewXDeg` e `skewYDeg` aplicam cisalhamento afim, limitados a menos de 80 graus. “Distorcer/Warp” neste estágio significa cisalhamento, não malha livre ou deformação por nós.

## Importação SVG

Depois que um arquivo é selecionado, o diálogo oferece dois modos de importação vetorial: **uma camada por cor do SVG** ou **somente a camada atual**. O primeiro mantém cada cor em sua camada correspondente; o segundo atribui toda a geometria à camada selecionada e usa sempre a cor dela. `stroke-width` é aceito como propriedade visual, mas não expande o path nem altera a trajetória. O diálogo não oferece importação como referência visual. O parser `svgson` e `svg-pathdata` são locais e MIT; nenhum código é obtido da rede. As dimensões físicas aceitam `mm`, `cm`, `in`, `px`, `pt` ou `pc`; a viewport original é convertida para mm.

Importação vetorial recusa scripts, atributos de evento, referências externas, CSS `@import`, URLs CSS externas e elementos fora da allowlist. Um `DOCTYPE svg` é removido sem buscar DTDs externos. Entidades textuais internas simples são expandidas com limites de tamanho e recursão; entidades externas/de parâmetro e defaults `ATTLIST` não são suportados. Referências XML predefinidas e numéricas são decodificadas. Referências visuais já existentes em projetos continuam preservadas pelo núcleo, mas a interface não oferece modo de importação visual nem cria um objeto de referência para contornar geometrias incompatíveis. A importação ignora `metadata`, `title` e `desc` (conteúdo não gráfico), aplica e compõe transforms `matrix`, `translate`, `scale`, `rotate`, `skewX` e `skewY` em grupos, formas, paths, texto e imagens compatíveis, e converte grupos, `rect`, `circle`, `ellipse`, `line`, `path`, `polygon`, `polyline`, texto plano e imagens raster incorporadas. Formas giradas/distorcidas viram paths editáveis; transforms de texto devem preservar escala uniforme; imagens aceitam transforms com eixos ortogonais e sem reflexão. Recursos que não podem ser representados pelo modelo são recusados em vez de importados parcialmente. A importação vetorial pela API pode restaurar metadados de camadas quando `forceLayerId` não é informado. O limite de arquivo na interface é 10 MB para SVG e projetos; imagens raster aceitam até 25 MB e 20 milhões de pixels, passam pelo editor local e são incorporadas como PNG, dimensionadas inicialmente a 96 dpi e ajustadas em mm. Objetos de imagem não são aceitos diretamente pelo adaptador GRBL.

Na ferramenta Selecionar (`V`), Shift+clique alterna objetos na seleção e arrastar no espaço vazio cria uma caixa de seleção. O conjunto selecionado pode ser movido, redimensionado proporcionalmente em torno do centro do conjunto, duplicado, removido e copiado/colado; `Ctrl+C` copia sem modificar o original e `Ctrl+V` cola com deslocamento de 5 mm na camada ativa, mesmo se os objetos copiados vierem de outra camada. Campos de texto mantêm os atalhos nativos do navegador. Uma operação em objetos de camadas bloqueadas é recusada; colar exige uma camada ativa desbloqueada. Rotação e distorção continuam disponíveis para um objeto por vez. Cada cartão de camada tem ação para duplicar a configuração da camada e todos os seus objetos na mesma posição; a cópia começa desbloqueada.

A sidebar tem altura limitada à área visível no desktop e rolagem vertical própria; em telas estreitas a rolagem é limitada ao painel de ferramentas antes da área de desenho.

Ferramentas e teclas são descritas pelo catálogo de `toolbar.js`. Mover, rotacionar e distorcer podem ser feitos arrastando o objeto; o inspetor permite valores precisos. Alterações passam pela validação de `createDocument`. O histórico guarda snapshots de documento e descarta o ramo de refazer quando surge uma edição nova.

## Camadas e operações

`src/core/layers.js` valida operações, parâmetros métricos, enabled/visible/locked e cores de visualização. Um documento legado recebe uma camada padrão de gravação e seus objetos são associados a ela. Cada objeto tem `layerId`; referências inexistentes e ids duplicados são recusados.

Cada camada define `operation` (`engrave`, `cut` ou `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `fillAlgorithm`, `objectOrder`, `enabled`, `visible` e `locked`. Avanço e espaçamento são mm/min e mm; potência é percentual e passes é inteiro. `fillAlgorithm` aceita horizontal serpentina, vertical serpentina, cruzado e horizontal unidirecional; `objectOrder` aceita ordem do documento, próximo objeto mais próximo ou centro para bordas. Os padrões antigos recebem horizontal serpentina e ordem do documento. Visibilidade afeta a visualização; `enabled` controla se a camada participa do envio à máquina; bloqueio impede transformar/remover objetos nela.

O exportador SVG agrupa objetos em camadas, colore cada grupo e representa preenchimento com formas preenchidas. `planGrblJob` é a fonte comum de G-code e trajetória de prévia; `renderGrblJob` preserva a API textual do núcleo. O adaptador GRBL aceita retângulos e paths sem transformações: gravação/corte percorrem contornos, número de passes e potência/avanço da camada; paths podem definir potência própria por segmento. Curvas são achatadas em segmentos com comprimento estimado máximo de 0,25 mm; preenchimento usa varreduras com espaçamento configurado em retângulos e paths fechados, preservando furos e recusando paths abertos. Saltos entre trajetórias são `G0` com `M5` (laser desligado); o primeiro deslocamento depende da posição real da cabeça e não pode ser previsto sem estado da máquina. A exportação final disponível é G-code GRBL, não formato universal. O formato de edição `.commburn.json` usa `{ "format": "commburn-project", "version": 2, "units": "mm", "document": ... }`. `src/core/project-conversions.js` faz as conversões suportadas antes da validação por `createDocument`; consulte o [contrato do formato](./PROJECT_FORMAT.md) e seus testes obrigatórios de preservação. O adaptador limita a quantidade de linhas e recusa tipos/transformações que não preserva. Não assuma que todas as máquinas usam o mesmo `$30`, material ou parâmetros de laser.

## Ajuda e atalhos

`shortcuts.js` define teclas globais e `tooltips.js` associa descrições às ferramentas e controles. Campos de entrada, área de texto, seletores e diálogos mantêm o comportamento nativo do teclado. A lista de atalhos é produzida a partir do catálogo de ferramentas, evitando cópias de nomes/teclas.

Atalhos:

| Tecla | Ação |
|---|---|
| `V` | Selecionar |
| `M` | Mover |
| `S` | Redimensionar proporcionalmente |
| `E` | Editar |
| `R` | Rotacionar |
| `W` | Distorcer |
| `Ctrl+C` | Copiar seleção |
| `Ctrl+V` | Colar na camada ativa |
| `Delete` | Remover seleção (inclusive múltipla) |
| `Ctrl+D` | Duplicar seleção (inclusive múltipla) |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Ctrl+Shift+Z` | Refazer |
| `Ctrl+S` | Exportar SVG |
| `Ctrl+Enter` | Criar texto |
| `Escape` | Voltar a selecionar e limpar seleção |
| `?` | Abrir ajuda de atalhos |

## Modo de apresentação

O botão **Apresentação** inicia uma demonstração automática em sete etapas. Cada etapa é composta por subetapas que usam os campos e botões reais do editor: digitação nos campos (largura, altura, texto, posição), escolha de fonte e tipo de forma, cliques em **Adicionar forma**, **Adicionar texto** e **Prévia**, e a simulação do percurso. Um ponteiro animado (`mouse-cursor-presentation.svg`) mostra o controle de cada subetapa, e a linha de subetapa descreve a ação atual. A pessoa pode pausar, retomar ou reiniciar. O roteiro usa as rotinas normais do editor em um documento temporário, não envia comandos ao hardware e restaura o documento, os campos, a seleção e a ferramenta anteriores ao sair. O texto usa a mesma geometria de strokes na edição e no plano simulado.

## Extensibilidade de interface

Seções do HTML identificam sua responsabilidade por `data-ui-module` e pontos de composição por `data-extension-slot`. Os slots atuais são `toolbar-tools`, `document-settings`, `coordinate-settings`, `layers`, `object-creation`, `object-inspector`, `canvas-header` e `canvas`.

Esses atributos são pontos de extensão nomeados. O host local de plugins API v1 existe apenas nas versões desktop empacotadas: carrega um `plugin.mjs` por plugin, instalado em `app.getPath("userData")/plugins/<id>/`, e só registra elementos nesses slots. `npm start` não carrega plugins. O módulo executa com o acesso do renderer, sem sandbox; não use plugins remotos e instale somente código local revisado. Desde `0.1.2`, o core é AGPL-3.0-only; plugins independentes podem manter licenças permissivas, como MIT, conforme `LICENSE-PLUGINS`, sem relicenciar o core. Extensões de geometria devem usar `context.document.addElement`, que valida pelo núcleo, e não alterar HTML interno de outra ferramenta para parecer integrada.

## Guia para novas mudanças

1. Defina a geometria e as regras no núcleo sem dependência visual.
2. Acrescente validação explícita e teste os limites métricos e transformações.
3. Faça a UI apenas capturar intenção e exibir/editar os valores do modelo.
4. Registre uma nova ferramenta no catálogo; derive dela rótulos, atalho, tooltip e estado ativo.
5. Integre o módulo em um slot nomeado e documente API, acessibilidade e suporte dos exportadores.
6. Não afirme que CLI, IA, SVG ou máquina suporta um tipo até que o adaptador correspondente preserve corretamente a geometria.
