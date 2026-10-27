# Arquitetura da interface CommBurn

Este guia descreve os limites atuais da interface e como acrescentar ferramentas sem duplicar geometria, unidades ou comportamento.

## Módulos do navegador

- `src/app.js`: composição dos módulos, estado de documento e ligação dos controles.
- `src/ui/toolbar.js`: catálogo de ferramentas, atalhos visuais e estado ativo.
- `src/ui/canvas-controller.js`: seleção, conversão de coordenadas SVG/mm e interações de ponteiro.
- `src/ui/selection.js`: operações puras para substituir, alternar e combinar conjuntos selecionados.
- `src/ui/layers-panel.js`: interface delegada de camadas e configurações de operação.
- `src/ui/history.js`: snapshots imutáveis para desfazer/refazer.
- `src/ui/shortcuts.js`: mapeamento global de atalhos; preserva a digitação em controles editáveis.
- `src/ui/tooltips.js`: descrições nativas (`title`) e acessíveis (`aria-description`).
- `src/core/document.js`: normalização, validação, transformações e exportação compartilhadas.
- `src/core/svg-import.js`: conversão controlada de SVG em elementos métricos do núcleo.

O núcleo não depende de DOM. A interface encaminha as operações ao modelo comum; não converta pixels em medidas por uma implementação paralela.

## Prancheta e régua

A barra de cabeçalho da tela de desenho é seguida por uma área de trabalho alinhada ao topo; não há centralização vertical que deixe a prancheta distante do cabeçalho. A régua X ocupa a mesma coluna CSS que o SVG; a régua Y ocupa a mesma linha. O desenho usa `viewBox` em mm e preserva sua proporção de aspecto. Os rótulos das réguas são gerados da dimensão real atual, e o tamanho da prancheta é recalculado quando a janela, área de visualização ou dimensões mudam. Assim, a régua não usa posições relativas estimadas a partir da tela inteira.

## Objetos e ações

Tipos do modelo atual: `text`, `rect`, `ellipse`, `line`, `path`, `image` e `svg-image`. Caminhos mantêm dados SVG editáveis e são editados em subeditor visual separado, com âncoras e alças cúbicas; arcos e curvas suaves são normalizados para segmentos cúbicos. A edição de imagem usa `@jodit/image-editor` local (MIT); seu CSS injetado é a razão para permitir estilos inline no CSP, enquanto scripts seguem restritos à origem local e os pacotes têm rotas allowlisted. A vetorização de contornos usa ImageTracerJS em Web Worker, sem serviço remoto. Imagens raster incorporadas também podem gerar gravação tonal por riscos serpenteados ou pontilhamento, com potência por path e tolerância RGB. A vetorização trabalha em mm, limita a prévia a 2 milhões de amostras e a saída a 15.000 paths; substitui a imagem fonte (Desfazer restaura). Contornos de cor são distribuídos em camadas de gravação e tons claros abaixo da potência mínima são omitidos. A conversão exige camada de gravação e imagem sem transforms. SVG estático incorporado continua sendo objeto visual, sem vetorizar. Dimensões e coordenadas são milímetros; rotação e distorção são graus. `rotationDeg` gira em torno do centro geométrico (texto: ponto de ancoragem); `skewXDeg` e `skewYDeg` aplicam cisalhamento afim, limitados a menos de 80 graus. “Distorcer/Warp” neste estágio significa cisalhamento, não malha livre ou deformação por nós.

## Importação SVG

O controle oferece dois modos. **Preservar aparência completa** incorpora o SVG estático como um objeto, delegando filtros, gradientes, máscaras, padrões, CSS e demais recursos visuais ao renderizador SVG do navegador. **Converter para vetores editáveis** usa o subconjunto geométrico abaixo. O parser `svgson` e `svg-pathdata` são locais e MIT; nenhum código é obtido da rede. As dimensões físicas aceitam `mm`, `cm`, `in`, `px`, `pt` ou `pc`; a viewport original é convertida para mm.

O modo visual conserva recursos SVG estáticos ou animados mesmo que não sejam editáveis no modelo. Scripts e atributos de evento são removidos; referências externas, CSS `@import` e URLs CSS externas são recusados. Um `DOCTYPE svg` é removido sem buscar DTDs externos. Entidades textuais internas simples são expandidas com limites de tamanho e recursão; entidades externas/de parâmetro e defaults `ATTLIST` não são suportados. Referências XML predefinidas e numéricas são decodificadas. `foreignObject` é preservado após a mesma sanitização de scripts, eventos e referências remotas. O modo vetorial ignora `metadata`, `title` e `desc` (conteúdo não gráfico), aplica e compõe transforms `matrix`, `translate`, `scale`, `rotate`, `skewX` e `skewY` em grupos, formas, paths, texto e imagens compatíveis, e converte grupos, `rect`, `circle`, `ellipse`, `line`, `path`, `polygon`, `polyline`, texto plano e imagens raster incorporadas. Formas giradas/distorcidas viram paths editáveis; transforms de texto devem preservar escala uniforme; imagens aceitam transforms com eixos ortogonais e sem reflexão. A importação da interface atribui todos os objetos vetoriais à camada ativa; a API do núcleo ainda permite preservar camadas incorporadas quando desejado. Recursos que não podem ser representados pelo modelo são recusados em vez de importados parcialmente. O modo visual conserva a aparência do SVG como objeto único, sem criar camadas separadas; a importação vetorial pela API pode restaurar metadados de camadas quando `forceLayerId` não é informado. O limite de arquivo na interface é 10 MB para SVG e projetos; imagens raster aceitam até 25 MB e 20 milhões de pixels, passam pelo editor local e são incorporadas como PNG, dimensionadas inicialmente a 96 dpi e ajustadas em mm. Objetos de imagem não são aceitos diretamente pelo adaptador GRBL.

Na ferramenta Selecionar (`V`), Shift+clique alterna objetos na seleção e arrastar no espaço vazio cria uma caixa de seleção. A ferramenta Seleção múltipla (`Q`) adiciona objetos por clique ou caixa. O conjunto selecionado pode ser movido, redimensionado proporcionalmente em torno do centro do conjunto, duplicado, removido e copiado/colado; `Ctrl+C` copia sem modificar o original e `Ctrl+V` cola com deslocamento de 5 mm na camada ativa, mesmo se os objetos copiados vierem de outra camada. Campos de texto mantêm os atalhos nativos do navegador. Uma operação em objetos de camadas bloqueadas é recusada; colar exige uma camada ativa desbloqueada. Rotação e distorção continuam disponíveis para um objeto por vez. Cada cartão de camada tem ação para duplicar a configuração da camada e todos os seus objetos na mesma posição; a cópia começa desbloqueada.

A sidebar tem altura limitada à área visível no desktop e rolagem vertical própria; em telas estreitas a rolagem é limitada ao painel de ferramentas antes da área de desenho.

Ferramentas e teclas são descritas pelo catálogo de `toolbar.js`. Mover, rotacionar e distorcer podem ser feitos arrastando o objeto; o inspetor permite valores precisos. Alterações passam pela validação de `createDocument`. O histórico guarda snapshots de documento e descarta o ramo de refazer quando surge uma edição nova.

## Camadas e operações

`src/core/layers.js` valida operações, parâmetros métricos, enabled/visible/locked e cores de visualização. Um documento legado recebe uma camada padrão de gravação e seus objetos são associados a ela. Cada objeto tem `layerId`; referências inexistentes e ids duplicados são recusados.

Cada camada define `operation` (`engrave`, `cut` ou `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `fillAlgorithm`, `objectOrder`, `enabled`, `visible` e `locked`. Avanço e espaçamento são mm/min e mm; potência é percentual e passes é inteiro. `fillAlgorithm` aceita horizontal serpentina, vertical serpentina, cruzado e horizontal unidirecional; `objectOrder` aceita ordem do documento, próximo objeto mais próximo ou centro para bordas. Os padrões antigos recebem horizontal serpentina e ordem do documento. Visibilidade afeta a visualização; `enabled` controla se a camada participa do envio à máquina; bloqueio impede transformar/remover objetos nela.

O exportador SVG agrupa objetos em camadas, colore cada grupo e representa preenchimento com formas preenchidas. `planGrblJob` é a fonte comum de G-code e trajetória de prévia; `renderGrblJob` preserva a API textual do núcleo. O adaptador GRBL aceita retângulos e paths sem transformações: gravação/corte percorrem contornos, número de passes e potência/avanço da camada; paths podem definir potência própria por segmento, útil para gravação tonal. Curvas são achatadas em segmentos com comprimento estimado máximo de 0,25 mm; preenchimento ainda opera somente em retângulos. Saltos entre trajetórias são `G0` com `M5` (laser desligado); o primeiro deslocamento depende da posição real da cabeça e não pode ser previsto sem estado da máquina. A exportação final disponível é G-code GRBL, não formato universal. O formato de edição `.commburn.json` usa `{ "format": "commburn-project", "version": 1, "document": ... }` e valida conteúdo através de `createDocument`. O adaptador limita a quantidade de linhas e recusa tipos/transformações que não preserva. Não assuma que todas as máquinas usam o mesmo `$30`, material ou parâmetros de laser.

## Ajuda e atalhos

`shortcuts.js` define teclas globais e `tooltips.js` associa descrições às ferramentas e controles. Campos de entrada, área de texto, seletores e diálogos mantêm o comportamento nativo do teclado. A lista de atalhos é produzida a partir do catálogo de ferramentas, evitando cópias de nomes/teclas.

Atalhos:

| Tecla | Ação |
|---|---|
| `V` | Selecionar |
| `Q` | Seleção múltipla |
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

## Extensibilidade de interface

Seções do HTML identificam sua responsabilidade por `data-ui-module` e pontos de composição por `data-extension-slot`. Os slots atuais são `toolbar-tools`, `document-settings`, `coordinate-settings`, `object-creation`, `object-inspector`, `canvas-header` e `canvas`.

Esses atributos são **pontos de extensão documentados**, não um carregador de plugins. Não use `eval`, imports remotos ou execução automática de código externo. Um futuro registro de plugins deve ser versionado, validado, isolado e seguir a mesma licença MIT do CommBurn. Extensões de geometria devem registrar tipos/operações pelo núcleo e também declarar suporte por exportador; não alterar HTML interno de outra ferramenta para fazer um plugin parecer integrado.

## Guia para novas mudanças

1. Defina a geometria e as regras no núcleo sem dependência visual.
2. Acrescente validação explícita e teste os limites métricos e transformações.
3. Faça a UI apenas capturar intenção e exibir/editar os valores do modelo.
4. Registre uma nova ferramenta no catálogo; derive dela rótulos, atalho, tooltip e estado ativo.
5. Integre o módulo em um slot nomeado e documente API, acessibilidade e suporte dos exportadores.
6. Não afirme que CLI, IA, SVG ou máquina suporta um tipo até que o adaptador correspondente preserve corretamente a geometria.
