# Problemas conhecidos e plano de correção

Este documento registra os problemas de fidelidade e fluxo observados no checkpoint `a1fe441`, separa cada um em subproblemas e define testes de regressão e critérios de aceite. O objetivo é corrigir o comportamento na origem e manter o modelo editável compartilhado entre editor, prévia, exportação e GRBL.

## Status

As correções deste tracker foram implementadas e a suíte completa foi ampliada desde o checkpoint inicial. Texto agora usa fontes OpenType incorporadas no SVG e gera contornos tipográficos para o GRBL; a operação da camada também controla o preenchimento do texto.

## 1. Texto diferente entre editor e prévia de máquina

**Causa observada no checkpoint `a1fe441`:** o editor usava `<text>` com fontes do sistema, mas o plano GRBL usava glifos Hershey; além disso, texto em camada `fill` era rebaixado a strokes abertos.

### Subproblemas

- O desenho visível não corresponde ao formato, espaçamento ou avanço dos strokes usados no G-code.
- Fontes disponíveis no navegador podem variar entre sistemas e não correspondem aos estilos Hershey selecionados pelo editor.
- A prévia de máquina e a simulação podem divergir da área de edição mesmo quando partem do mesmo objeto `text`.

### Correção

Manter o objeto `text` editável. O editor e o SVG usam elementos `<text>` nativos com a face OpenType incorporada; o GRBL extrai os contornos dos mesmos glifos. Aplicar origem e inversões sem espelhar as letras. Cada operação (`engrave`, `cut`, `fill`) deve permanecer a da camada, e `fill` deve usar algoritmo e espaçamento configurados.

### Testes de regressão

- Comparar os segmentos do elemento de texto no SVG de prévia com os pontos de trabalho retornados por `planGrblJob`, incluindo origem invertida.
- Verificar as famílias suportadas, acentos, quebras de linha e espaços no mesmo caminho de geometria.
- Confirmar que o modelo e o inspetor continuam preservando `type: "text"`, conteúdo e família selecionada.
- Confirmar que glifo ou família sem suporte falha com o mesmo erro tanto na prévia quanto no plano GRBL, sem cair silenciosamente na fonte do navegador.

### Critério de aceite

A área de edição, o SVG exportado e a prévia GRBL exibem a mesma geometria de strokes para o mesmo objeto e documento.

## 2. Importação SVG rasterizada ou sem o modo de camada solicitado

**Causa observada:** o modo visual armazena SVG como `svg-image`; a ação de vetorizar esse objeto rasteriza a aparência em canvas antes de usar ImageTracer. Esse caminho perde a geometria original. O modo editável por cores já existe parcialmente, mas o fluxo precisa preservar geometria e explicitar a cor/camada de destino.

### Subproblemas

- SVG vetorial não deve ser convertido em bitmap para ser enviado ao GRBL.
- Geometrias básicas e paths devem chegar ao documento como objetos vetoriais métricos; formas curtas ou transformadas não podem virar objetos que o adaptador depois rejeita sem aviso.
- O modo por cor deve criar/usar camadas correspondentes às cores de origem.
- O modo de camada atual deve direcionar toda geometria para essa camada e fazer seus objetos respeitarem a cor e a operação dela.
- Efeitos visuais, conteúdo ativo, referências externas, imagens raster incorporadas e geometrias que não possam ser preservadas precisam de comportamento explícito; não podem ser silenciosamente rasterizados ou descartados.

### Correção

Separar importação editável de preservação visual. Importação editável deve converter as geometrias SVG suportadas em paths/objetos vetoriais, aplicar transforms ao path e suportar os modos `por cor` e `camada atual`. Preservação visual pode continuar disponível como referência, mas não deve oferecer um botão que prometa conversão vetorial por rasterização. Recursos não representáveis como trajetórias devem ser recusados com mensagem específica ou mantidos somente no modo visual claramente identificado.

### Testes de regressão

- Importar as primitivas, paths e grupos transformados suportados; confirmar tipos vetoriais e dimensões/posições em mm. Formas não suportadas são rejeitadas explicitamente.
- Em modo por cor, confirmar uma camada por cor/operacão e atribuição correta dos elementos.
- Em modo camada atual, confirmar que não são criadas camadas por cor e que o SVG renderizado usa sempre a cor da camada, ignorando as cores de origem.
- Passar o resultado editável a `planGrblJob`; confirmar trajetórias válidas para geometrias compatíveis e nenhum `image`/`svg-image` criado.
- Testar efeitos/elementos não suportados e verificar erro específico, sem rasterização automática, omissão silenciosa ou perda de geometria.

### Critério de aceite

Um SVG vetorial compatível permanece vetorial do arquivo ao plano GRBL. O modo visual é apenas preservação de aparência; nunca é apresentado como equivalente à importação vetorial.

## 3. Regressão na apresentação guiada

**Causa observada:** a experiência automatizada original foi reduzida a cinco etapas sem ponteiro. Isso removeu a orientação visual que mostrava os controles e as ações executadas, tornando a demonstração difícil de acompanhar.

### Subproblemas

- Sem um ponteiro visível, não fica claro qual controle está sendo demonstrado.
- Reduzir ações independentes a cinco etapas esconde etapas importantes, como a simulação do percurso.
- Avanço manual por cartão não demonstra a interação real com os controles do editor.
- Ações da demonstração podem divergir da sequência manual recomendada ou deixar o resultado visual incoerente.

### Correção

Restaurar a demonstração automática em sete etapas: configurar a área, inserir texto, desenhar moldura e detalhe, ajustar um objeto, abrir a prévia e simular o percurso. Cada etapa digita e escolhe valores nos campos reais e clica nos botões do editor, com um ponteiro animado (`mouse-cursor-presentation.svg`) e a descrição da subetapa atual. Permitir pausar, retomar e reiniciar; a prévia não envia comandos ao hardware e sair restaura o estado original.

### Testes de regressão

- Confirmar as sete etapas, as subetapas e os alvos reais (ids existentes em `index.html`).
- Verificar que cada ação altera os valores e objetos descritos, e que o resultado final corresponde ao documento usado pela prévia GRBL.
- Confirmar pausa/retomada, reinício, saída e restauração do documento original.
- Confirmar que texto e formas da demonstração usam as mesmas renderizações e trajetórias do editor normal.

### Critério de aceite

A demonstração percorre automaticamente as sete etapas didáticas, mantém o ponteiro visível nos controles correspondentes e não apresenta alvos inexistentes, conteúdo coberto ou resultados divergentes da prévia da máquina.

## 4. Avisos de validação imprecisos ou fora de contexto

**Causa observada:** valores inválidos em vários controles são convertidos em exceções genéricas exibidas no aviso global; algumas mensagens descrevem outro campo ou outra operação.

### Subproblemas

- Campos vazios, não finitos, fora do mínimo/máximo ou com precisão inválida são tratados como se fossem o mesmo erro.
- O aviso pode apontar uma operação/camada quando o problema está em uma dimensão, posição ou parâmetro diferente.
- Valores de propriedades de camada e do inspetor nem sempre mantêm foco no campo inválido.
- Mensagens não informam unidade, limite esperado e ação corretiva relevante.

### Correção

Centralizar a validação de cada controle numérico com label, unidade, intervalo e código estável. Validar o elemento que está sendo editado e atualizar seu erro inline/`aria-describedby`; manter o aviso global para falhas de ação que não pertencem a um único campo. Não substituir nem limpar valores inválidos silenciosamente.

### Testes de regressão

- Testar campos vazios, `NaN`/infinito, limites inferiores/superiores e passo inválido; validar a interação do painel de camadas.
- Verificar que a mensagem inclui o label, a unidade e o limite correto.
- Confirmar que o erro aparece no campo inválido, esse campo recebe foco, outros campos não são marcados e o aviso global não é usado para erro inline.
- Confirmar que um valor válido limpa somente o erro correspondente.

### Critério de aceite

Cada valor inválido aponta para o controle que falhou, usa a unidade/limite pertinente e não gera mensagens sobre outra camada ou operação.

## Execução e verificação

1. Texto: SVG preserva `<text>` editável com fonte incorporada; GRBL usa contornos OpenType e respeita a operação da camada.
2. SVG: removida a ação que rasterizava SVG visual; importação editável por cor/camada gera geometrias nativas e trajetórias compatíveis.
3. Apresentação: sete etapas com subetapas (digitação, escolha e cliques nos controles reais), ponteiro `mouse-cursor-presentation.svg`, pausa/retomada e reinício; estado original restaurado ao sair.
4. Validação: erros numéricos distinguem formato, obrigatório, mínimo, máximo e passo; mensagens acessíveis e locais incluem unidade.
5. Verificação: `npm test` passou com 121 testes.
