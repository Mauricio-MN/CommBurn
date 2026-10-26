# Arquitetura da interface CommBurn

Este guia descreve os limites atuais da interface e como acrescentar ferramentas sem duplicar geometria, unidades ou comportamento.

## Módulos do navegador

- `src/app.js`: composição dos módulos, estado de documento e ligação dos controles.
- `src/ui/toolbar.js`: catálogo de ferramentas, atalhos visuais e estado ativo.
- `src/ui/canvas-controller.js`: seleção, conversão de coordenadas SVG/mm e interações de ponteiro.
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

Tipos do modelo atual: `text`, `rect`, `ellipse`, `line` e `path`. Caminhos mantêm dados SVG editáveis e dimensões/posições em milímetros; a exportação geral os preserva, mas o adaptador GRBL ainda os recusa. Dimensões e coordenadas são milímetros; rotação e distorção são graus. `rotationDeg` gira em torno do centro geométrico (texto: ponto de ancoragem); `skewXDeg` e `skewYDeg` aplicam cisalhamento afim, limitados a menos de 80 graus. “Distorcer/Warp” neste estágio significa cisalhamento, não malha livre ou deformação por nós.

## Importação SVG

O controle de importação usa o `svgson` local (MIT) para ler a estrutura e `svg-pathdata` (MIT) para normalizar caminhos; nenhum código é obtido da rede. O núcleo recebe a árvore já analisada e importa `svg`, grupos simples, `rect`, `circle`, `ellipse`, `line`, `path`, `polygon`, `polyline` e texto sem marcação aninhada. As dimensões físicas aceitam `mm`, `cm`, `in`, `px`, `pt` ou `pc`; geometrias seguem o `viewBox` e seu alinhamento `preserveAspectRatio`, e o tamanho final é convertido para mm.

Scripts, referências externas, imagens, CSS (`style`), atributos de evento e transforms SVG de formas/grupos são recusados com erro explícito. Texto aceita transforms afins que resultem em escala uniforme, rotação e translação; escala não uniforme, reflexão e distorção de texto são recusadas, pois o modelo não as preserva fielmente. Formatação de apresentação simples pode ser descartada, pois cor/operação vêm da camada ativa. SVGs com elementos ou transformações ainda não suportados não são importados parcialmente. O limite do arquivo na interface é 10 MB; a árvore aceita até 20.000 elementos e 64 níveis. Os vetores importados são adicionados à camada ativa desbloqueada e continuam selecionáveis, movíveis, transformáveis e com `pathData` editável no inspetor. O caminho de importação não implica suporte do adaptador GRBL.

A sidebar tem altura limitada à área visível no desktop e rolagem vertical própria; em telas estreitas a rolagem é limitada ao painel de ferramentas antes da área de desenho.

Ferramentas e teclas são descritas pelo catálogo de `toolbar.js`. Mover, rotacionar e distorcer podem ser feitos arrastando o objeto; o inspetor permite valores precisos. Alterações passam pela validação de `createDocument`. O histórico guarda snapshots de documento e descarta o ramo de refazer quando surge uma edição nova.

## Camadas e operações

`src/core/layers.js` valida operações, parâmetros métricos, enabled/visible/locked e cores de visualização. Um documento legado recebe uma camada padrão de gravação e seus objetos são associados a ela. Cada objeto tem `layerId`; referências inexistentes e ids duplicados são recusados.

Cada camada define `operation` (`engrave`, `cut` ou `fill`), `feedMmPerMinute`, `powerPercent`, `passes`, `fillSpacingMm`, `enabled`, `visible` e `locked`. Avanço e espaçamento são mm/min e mm; potência é percentual e passes é inteiro. Visibilidade afeta a visualização; `enabled` controla se a camada participa do envio à máquina; bloqueio impede transformar/remover objetos nela.

O exportador SVG agrupa objetos em camadas, colore cada grupo e representa preenchimento com formas preenchidas. O adaptador GRBL permanece restrito a retângulos sem transformações: gravação/corte percorrem contorno, número de passes e potência/avanço da camada; preenchimento varre o interior com linhas e o espaçamento definido. O adaptador limita a quantidade de linhas e recusa tipos/transformações que não preserva. Não assuma que todas as máquinas usam o mesmo `$30`, material ou parâmetros de laser.

## Ajuda e atalhos

`shortcuts.js` define teclas globais e `tooltips.js` associa descrições às ferramentas e controles. Campos de entrada, área de texto, seletores e diálogos mantêm o comportamento nativo do teclado. A lista de atalhos é produzida a partir do catálogo de ferramentas, evitando cópias de nomes/teclas.

Atalhos:

| Tecla | Ação |
|---|---|
| `V` | Selecionar |
| `M` | Mover |
| `E` | Editar |
| `R` | Rotacionar |
| `W` | Distorcer |
| `Delete` | Remover seleção |
| `Ctrl+D` | Duplicar seleção |
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
