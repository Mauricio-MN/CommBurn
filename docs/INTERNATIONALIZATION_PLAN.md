# Plano de internacionalização

## Estado

Implementação disponível para `en` e `pt-BR`: núcleo independente de DOM em `src/core/i18n.js`, catálogos pareados, seletor persistido, interface principal e diálogos traduzidos, CLI localizada e catálogos locais para plugins desktop. Os rótulos gerados pelo aplicativo acompanham o idioma sem alterar dados do usuário. A cobertura ainda não é completa: persistem mensagens fixas em alguns erros e fluxos de módulos da UI, servidor e adaptadores. Este documento separa o contrato implementado do trabalho restante.

## Objetivos

- Começar com inglês (`en`) e português brasileiro (`pt-BR`), mantendo a linguagem da interface consistente.
- Colocar resolução de idioma, formatação e representação de erros no núcleo compartilhado, sem dependência de DOM, Electron, filesystem ou navegador.
- Usar a mesma política de idioma na interface web, desktop, CLI e integrações.
- Permitir que cada plugin forneça seus próprios catálogos e consulte o idioma ativo.
- Manter modelos de documento, enumerações, coordenadas, G-code, JSON de automação e protocolos estáveis e independentes do idioma.

## Decisões implementadas

- Usar tags BCP 47 canônicas `en` e `pt-BR`. Normalizar `en-*` para `en` e `pt`/`pt-*` para `pt-BR`.
- Na UI, resolver preferência salva, idioma do navegador e `pt-BR` como fallback inicial. Na CLI, resolver `--locale`, `COMMBURN_LOCALE`, `LANG` e `pt-BR`. Usar `en` como fallback de chave.
- Guardar a preferência da interface em armazenamento de preferências, nunca no documento editável. Trocar o idioma não modifica nomes, texto ou outros dados do usuário.
- Manter o inglês como catálogo de referência completo; exigir paridade de chaves para `pt-BR` nos testes antes de publicar.
- Traduzir mensagens voltadas ao usuário, incluindo nomes acessíveis, rótulos, dicas, diálogos, estados, validação, avisos e erros. Não traduzir conteúdo criado/importado pelo usuário nem mensagens de protocolo ou dados de máquina.

## Arquitetura atual

1. `src/core/i18n.js` fornece normalização/resolução, interpolação, pluralização, formatação numérica e erros codificados sem dependência de ambiente global.
2. `src/locales/en.js` e `src/locales/pt-BR.js` são os catálogos do CommBurn e têm paridade verificada por teste.
3. A UI tem seletor persistido e tradutor DOM; toolbar, camadas e atalhos dinâmicos reagem à mudança de idioma. A cobertura ainda precisa alcançar toda a superfície indicada no inventário.
4. Erros de documento, camadas e GRBL selecionados mantêm subclasses compatíveis e recebem `code` e `params`; a apresentação formata códigos reconhecidos. A migração de erros ainda não cobre todos os módulos.
5. CLI aceita locale explícito e ambiente. SVG, G-code, JSON do documento e códigos de saída permanecem estáveis.
6. Plugins desktop podem declarar catálogos JSON locais; o host valida e serve apenas os caminhos declarados e injeta `context.i18n` antes da ativação.

## API implementada para plugins

O manifesto pode declarar arquivos JSON locais, opcionais, por idioma:

```json
{
  "id": "marcador-demo",
  "name": "Demo marker",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "plugin.mjs",
  "locales": {
    "en": "locales/en.json",
    "pt-BR": "locales/pt-BR.json"
  }
}
```

O host aceita somente os caminhos exatos `locales/en.json` e `locales/pt-BR.json`, rejeita symlinks e caminhos não declarados, limita cada arquivo a 256 KiB e valida catálogos de até oito níveis com folhas de texto. Somente arquivos declarados são servidos; não há carregamento remoto. Plugins sem `locales` continuam funcionando.

O contexto receberá uma API aditiva e compatível com plugins v1 existentes:

```js
context.i18n.locale                 // locale ativo, por exemplo "pt-BR"
context.i18n.t("button.label")      // catálogo do próprio plugin
context.i18n.formatError(error)      // erro de domínio do CommBurn, se reconhecido
context.i18n.onLocaleChange(handler) // registra atualização da UI do plugin
```

`t` usa o catálogo do plugin para o locale ativo e recorre a `en` quando a chave não existe; se faltar em ambos, retorna a própria chave. `locale` reflete alterações do seletor, e o listener retorna uma função de cancelamento. `formatError` traduz códigos reconhecidos pelo núcleo do CommBurn. O host não traduz conteúdo arbitrário nem expõe caminhos locais do usuário ao plugin.

## Política de erros

- Erros de validação do núcleo recebem códigos estáveis e parâmetros tipados. Exemplos: tipo de elemento inválido, medida não finita, geometria incompatível com GRBL e limite de segmentos excedido.
- A tradução é feita na fronteira de apresentação. A camada de domínio não consulta `navigator.language`, DOM, Electron ou preferências globais.
- `cause` e detalhes técnicos são preservados para diagnóstico; textos brutos de dependências não devem ser concatenados a uma tradução, pois isso recria mensagens bilíngues.
- CLI aceita locale explícito (`--locale`) e uma variável de ambiente documentada. Saída JSON/machine-readable permanece estável; mensagens humanas em `stderr` seguem o locale resolvido.
- Erros de API mantêm identificador/código independente do idioma; clientes podem pedir mensagem localizada sem depender dela para lógica.

## Trabalho restante

1. Inventariar e traduzir as mensagens fixas que restam em `src/app.js`, `src/ui/`, servidor e adaptadores; testar a troca de idioma com foco/diálogo ativos.
2. Migrar erros restantes para códigos e parâmetros localizáveis sem concatenar mensagens de dependências.
3. Auditar nomes e parâmetros, chaves sem uso e cobertura das superfícies nos dois idiomas.
4. Exercitar a CLI e a API de plugins em builds desktop distribuídas, além dos testes unitários locais.

## Critérios de aceite

- A interface, mensagens de erro comuns e superfícies de plugin não exibem mistura acidental de português e inglês no mesmo locale.
- Todos os controles têm texto acessível localizado; mudar idioma não perde trabalho, seleção, foco ou estado de diálogo.
- Catálogos `en` e `pt-BR` têm as mesmas chaves e parâmetros compatíveis; testes cobrem fallback, interpolação e pluralização.
- Erros do núcleo são testados por código/parâmetros, não pela redação traduzida.
- Plugins v1 antigos continuam carregando; plugins novos podem usar seus próprios arquivos locais de idioma e recebem o idioma atual.
- G-code, dados de documento, unidades e contratos de automação permanecem invariantes à troca de locale.