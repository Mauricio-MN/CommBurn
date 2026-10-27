# CommBurn — guia inicial do projeto

## Visão

Um editor vetorial simples e acolhedor para preparar trabalhos de gravação e corte a laser. A interface deve privilegiar ações visíveis, menus curtos, ícones com cores funcionais e edição de texto compreensível para iniciantes. Este documento é um rascunho orientador, não uma promessa de compatibilidade universal com máquinas.

## Princípios do produto

- **Métrico por padrão:** milímetros são a unidade canônica para dimensões, posições e tamanho de texto; não arredondar silenciosamente.
- **Coordenadas explícitas:** origem e sentido dos eixos são escolhas do usuário, sem depender de sensores.
- **Uma única lógica:** interface, CLI, IA e plugins usam o mesmo núcleo de documentos.
- **Ações descobríveis:** controles comuns ficam visíveis e rotulados; não exigir conhecimento legado.
- **Compatibilidade progressiva:** começar com SVG e adicionar formatos e máquinas através de adaptadores testáveis.
- **Licenças idênticas:** plugins distribuídos com o CommBurn devem usar exatamente a licença MIT deste repositório.

## Rascunho funcional atual

O protótipo em `index.html` permite definir a área em mm, alternar orientação, escolher o canto de origem, inverter X/Y, criar/editar texto e formas, preservar a aparência de SVGs como objetos visuais ou converter geometria compatível em vetores editáveis, incorporar imagens PNG/JPEG/WebP, organizar objetos em camadas coloridas de gravação/corte/preenchimento e exportar SVG. A seleção aceita Shift+clique e caixa de seleção; mover, duplicar, copiar/colar e remover atuam sobre grupos selecionados. Objetos copiados podem ser colados na camada ativa; camadas podem ser duplicadas com sua configuração e objetos. A sidebar rola dentro da altura visível da tela. Ferramentas de seleção, mover, editar, rotacionar e distorcer compartilham o modelo e a conversão mm/SVG. A CLI cria SVG do mesmo documento JSON. O servidor local opcional abre portas seriais para controladores compatíveis com GRBL e envia apenas contornos retangulares sem transformação depois de confirmação explícita. O guia da [arquitetura da interface](./UI_ARCHITECTURE.md) documenta módulos, réguas, atalhos, importação segura e slots de extensão.

## Estrutura planejada

- `src/core/`: modelo de documento, validação, geometria e exportadores sem dependência de UI.
- `src/`: interface web estática que chama o núcleo compartilhado.
- `cli/`: comandos para automação local e agentes de IA, usando o mesmo contrato JSON.
- `plugins/`: futuro carregamento controlado de adaptadores com licença MIT idêntica.
- `docs/`: contratos públicos, decisões e guia de evolução.
- `tests/`: testes de unidade e integração para resultados determinísticos.

## Etapas sugeridas

1. **Rascunho:** editor SVG básico, valores métricos, edição de texto, coordenadas manuais, exportação e testes.
2. **Documentos:** desfazer/refazer, salvamento de projeto, seleção/manipulação avançada e importação controlada.
3. **Máquinas:** o primeiro adaptador GRBL comunica pela biblioteca MIT `serialport`; adicionar outros protocolos apenas com testes em equipamento. Operação exige confirmação e valores de avanço/potência informados para a máquina pelo usuário.
4. **Extensões:** API de plugins versionada, manifesto, permissões, licenciamento e compatibilidade.
5. **Robustez:** testes em diferentes tamanhos de tela, acessibilidade, arquivos grandes e matrizes de equipamentos suportadas.

## Máquinas e segurança

O envio direto é experimental e suporta somente firmware compatível com o protocolo serial GRBL. Não é controle universal, não configura limites, não detecta sensores e não substitui proteções físicas, intertravamentos ou parada de emergência. Confirme a origem, os limites e os parâmetros do controlador; faça primeiro ensaio sem material e com o laser desativado. O botão de pausa envia feed hold, não é parada de emergência.

Use `npm install`, depois `npm start`, e abra `http://127.0.0.1:4173` para disponibilizar a API serial apenas no loopback local. Se a listagem automática de portas não estiver disponível, informe o caminho da porta manualmente (por exemplo, `/dev/ttyACM0` ou `COM3`); alguns Linux precisam do utilitário `udevadm` para descoberta automática. O envio requer checklist explícito, aceita apenas retângulos sem transformação dentro da área do documento e espera confirmações do controlador e estado ocioso. Avanço, potência, passes e preenchimento vêm das camadas; a escala `S` (`$30`) e o modo laser dinâmico GRBL (`$32=1`) precisam estar configurados corretamente na máquina. O CommBurn não altera configurações do controlador.

## Fora do escopo inicial

Compatibilidade universal, descoberta automática por sensores, formatos proprietários não documentados, deformação livre por malha e execução de código de plugins. O controle direto existente é apenas experimental para GRBL e exige testes com equipamento real.

## Uso local

- Executar `npm start` e abrir `http://127.0.0.1:4173` para usar a interface com acesso serial local.
- Abrir `index.html` em um navegador moderno para experimentar o editor sem conexão serial.
- Executar testes com `npm test`.
- Converter um documento JSON para SVG: `node cli/commburn.mjs entrada.json saida.svg`.

Consulte [o contrato de CLI e plugins](./PLUGIN_CLI_CONTRACT.md).
