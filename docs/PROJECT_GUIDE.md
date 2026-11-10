# CommBurn — guia inicial do projeto

## Visão

Um editor vetorial simples e acolhedor para preparar trabalhos de gravação e corte a laser. A interface deve privilegiar ações visíveis, menus curtos, ícones com cores funcionais e edição de texto compreensível para iniciantes. Este documento é um rascunho orientador, não uma promessa de compatibilidade universal com máquinas.

## Princípios do produto

- **Métrico por padrão:** milímetros são a unidade canônica para dimensões, posições e tamanho de texto; não arredondar silenciosamente.
- **Coordenadas explícitas:** origem e sentido dos eixos são escolhas do usuário, sem depender de sensores.
- **Uma única lógica:** interface, CLI, IA e plugins usam o mesmo núcleo de documentos.
- **Localização consistente:** UI, CLI, core e plugins usam locales explícitos e catálogos; idioma nunca altera dados métricos, documentos ou protocolos.
- **Ações descobríveis:** controles comuns ficam visíveis e rotulados; não exigir conhecimento legado.
- **Compatibilidade progressiva:** começar com SVG e adicionar formatos e máquinas através de adaptadores testáveis.
- **Licenças separadas:** desde `0.1.2`, o núcleo usa GNU AGPL-3.0-only; plugins independentes podem manter licenças permissivas, como MIT, conforme [LICENSE-PLUGINS](../LICENSE-PLUGINS), sem relicenciar o núcleo.

## Rascunho funcional atual

O protótipo em `index.html` permite definir a área em mm, alternar orientação, escolher o canto de origem, inverter X/Y, criar/editar texto e formas, preservar a aparência de SVGs como objetos visuais ou converter geometria compatível em vetores editáveis. A edição e importação raster usam o componente local MIT `@jodit/image-editor` para recorte, redimensionamento, rotação, filtros e ajuste de tons; a imagem final é incorporada como PNG e dimensionada em mm. A conversão de imagem usa ImageTracerJS local para criar regiões vetoriais sólidas; cada região é um path independente, e o usuário pode incluir ou excluir cores antes de aplicar. A prévia preserva as cores originais; no editor, preenchimento e borda usam sempre a cor atual da camada. A borda pode ser desativada e sua espessura é configurável em mm. O resultado permanece na camada atual, sem criar camadas por cor. A seleção aceita Shift+clique e caixa de seleção; mover, redimensionar, duplicar, copiar/colar e remover atuam sobre grupos selecionados. Objetos copiados podem ser colados na camada ativa; camadas podem ser duplicadas com sua configuração e objetos. A sidebar rola dentro da altura visível da tela. Ferramentas de seleção, mover, editar, redimensionar, rotacionar e distorcer compartilham o modelo e a conversão mm/SVG. A prévia GRBL exibe trajetórias de trabalho e saltos rápidos com o laser desligado; o simulador mostra esses movimentos à medida que cada comando é confirmado, sem acionar hardware. O servidor local opcional abre portas seriais para controladores compatíveis com GRBL e envia retângulos ou paths sem transformação depois de confirmação explícita. O guia da [arquitetura da interface](./UI_ARCHITECTURE.md) documenta módulos, réguas, atalhos, importação segura e slots de extensão.

## Estrutura planejada

- `src/core/`: modelo de documento, validação, geometria e exportadores sem dependência de UI.
- `src/`: interface web estática que chama o núcleo compartilhado.
- `cli/`: comandos para automação local e agentes de IA, usando o mesmo contrato JSON.
- Plugins desktop locais são carregados de `app.getPath("userData")/plugins/`; o editor web não carrega código externo. Consulte o contrato de plugins para o manifesto/API e os limites de confiança.
- `docs/`: contratos públicos, decisões e guia de evolução.
- `tests/`: testes de unidade e integração para resultados determinísticos.

## Etapas sugeridas

1. **Rascunho:** editor SVG básico, valores métricos, edição de texto, coordenadas manuais, exportação e testes.
2. **Documentos:** desfazer/refazer, salvamento de projeto, seleção/manipulação avançada e importação controlada.
3. **Máquinas:** o primeiro adaptador GRBL comunica pela biblioteca MIT `serialport`; adicionar outros protocolos apenas com testes em equipamento. Operação exige confirmação e valores de avanço/potência informados para a máquina pelo usuário.
4. **Extensões:** API v1 de plugins desktop locais implementada; localização via catálogos locais e `context.i18n` está disponível. Permissões adicionais e isolamento seguem como trabalho futuro.
5. **Internacionalização:** suporte inicial a inglês e português brasileiro está implementado na UI, CLI, erros selecionados e plugins desktop. A cobertura completa de strings e erros permanece em andamento; consulte o [plano de internacionalização](./INTERNATIONALIZATION_PLAN.md).
6. **Robustez:** testes em diferentes tamanhos de tela, acessibilidade, arquivos grandes e matrizes de equipamentos suportadas.

## Máquinas e segurança

O envio direto é experimental e suporta somente firmware compatível com o protocolo serial GRBL. Retângulos, paths vetoriais editáveis sem transformação e texto são processados; texto usa fontes de gravação de traço único integradas, com acentos portugueses comuns, e é convertido em trajetórias sem alterar o objeto editável. Caracteres fora da cobertura das fontes são recusados explicitamente. Imagens raster e SVGs visuais podem ser convertidos localmente em regiões vetoriais antes do envio; SVGs visuais preservam a aparência estática, mas precisam dessa conversão para gerar trajetórias. Elipses, linhas e formas transformadas são recusadas pelo GRBL. Texto em qualquer camada é executado como gravação de traço único; em camadas de preenchimento, não recebe hachura, enquanto formas fechadas continuam usando o algoritmo configurado. A prévia agrupa visualmente as trajetórias para reduzir o custo de renderização e estima o tempo de trabalho por operação a partir dos avanços configurados; não inclui deslocamentos rápidos, aceleração ou resposta do controlador. Não é controle universal, não configura limites, não detecta sensores e não substitui proteções físicas, intertravamentos ou parada de emergência. Confirme a origem, os limites e os parâmetros do controlador; faça primeiro ensaio sem material e com o laser desativado. O botão de pausa envia feed hold, não é parada de emergência.

Use `npm install`, depois `npm start`, e abra `http://127.0.0.1:4173` para disponibilizar a API serial apenas no dispositivo local. Se a lista automática de portas não funcionar no seu sistema, informe o caminho da porta manualmente (por exemplo, `/dev/ttyACM0` ou `COM3`). A velocidade serial pode ser escolhida manualmente ou detectada entre valores comuns por uma consulta de estado GRBL sem movimento; se não houver resposta, escolha o valor indicado pelo fabricante. Ao conectar, o CommBurn também tenta ler `$30` para preencher a escala de potência. O envio requer checklist explícito e aceita texto, retângulos e paths vetoriais sem transformação dentro da área do documento; texto usa traços de fonte única mesmo em camadas de preenchimento, sem gerar hachura. Formas fechadas nessas camadas continuam usando o algoritmo configurado. Imagens raster e SVGs visuais precisam ser convertidos em paths antes do envio; o SVG visual permanece editável e o original pode ser recuperado com Desfazer. Avanço, potência, passes, algoritmo de preenchimento e ordem dos objetos vêm das camadas; paths vetoriais podem sobrescrever potência por objeto. A escala `S` (`$30`) e o modo laser dinâmico GRBL (`$32=1`) precisam estar configurados corretamente na máquina. O CommBurn não altera configurações do controlador.

## Fora do escopo inicial

Compatibilidade universal, descoberta automática por sensores, formatos proprietários não documentados, deformação livre por malha e execução de plugins remotos ou não confiáveis. Plugins desktop locais executam sem isolamento e só devem ser instalados após revisão. O controle direto existente é apenas experimental para GRBL e exige testes com equipamento real.

## Uso local

- Executar `npm start` e abrir `http://127.0.0.1:4173` para usar a interface com acesso serial local.
- Executar `./restart-server.sh` para reiniciar o servidor local e validar que o processo correto está atendendo a porta.
- Abrir `index.html` em um navegador moderno para experimentar o editor sem conexão serial.
- Executar testes com `npm test`.
- Converter um documento JSON para SVG: `node cli/commburn.mjs entrada.json saida.svg`.

Consulte [o contrato de CLI e plugins](./PLUGIN_CLI_CONTRACT.md).
