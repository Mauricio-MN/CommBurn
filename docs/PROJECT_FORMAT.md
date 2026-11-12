# Formato de projeto editável

## Versão atual

O envelope persistido é JSON UTF-8 no formato `commburn-project`. A versão 2 declara a unidade canônica explicitamente:

```json
{
  "format": "commburn-project",
  "version": 2,
  "units": "mm",
  "document": {}
}
```

A versão do formato editável é independente da versão do aplicativo em `package.json`. O modelo dentro de `document` continua sendo validado por `createDocument`; coordenadas, dimensões, fontes, camadas e objetos conservam seus valores e identificadores.

## Conversões

`src/core/project-conversions.js` contém as conversões entre versões. `parseProject` converte para a versão atual antes de validar e criar o modelo. Cada conversão precisa avançar exatamente uma versão. Versões futuras ou envelopes desconhecidos são recusados sem tentar adivinhar, descartar ou regravar seus dados.

A conversão v1→v2 acrescenta `units: "mm"` ao envelope. Não transforma nem arredonda a geometria. A fixture v1 em `tests/fixtures/project-v1.json` é o contrato de compatibilidade para arquivos já existentes.

## TABUS

- **TABU:** alterar, remover, renomear ou reinterpretar campos/valores persistidos sem incrementar a versão do formato e escrever uma conversão explícita de cada versão anterior.
- **TABU:** descartar propriedades desconhecidas, objetos, camadas, ids, ordem, transforms, cores, fontes ou dados incorporados para conseguir carregar um arquivo.
- **TABU:** converter silenciosamente vetor em bitmap, substituir texto por uma fonte de sistema, arredondar medidas ou mudar a aparência durante uma migração.
- **TABU:** sobrescrever o arquivo original durante a conversão. A carga normaliza em memória; a gravação acontece somente por uma ação explícita de salvar/exportar.
- **TABU:** aceitar uma versão futura como se fosse a versão atual. Recusar com erro específico é mais seguro do que corromper o documento.

Se uma propriedade antiga não puder ser representada sem perda, a conversão deve preservar o objeto original como referência editável/visual quando isso for seguro ou recusar a conversão com um erro específico. Nunca alegar conversão fiel se a aparência ou a geometria mudou.

## Testes obrigatórios por versão

Para cada versão publicada, mantenha uma fixture imutável do envelope antigo e teste:

- parsing, migração de cada versão suportada e rejeição explícita de versões futuras;
- igualdade do modelo normalizado antes/depois, incluindo dimensões, origem, ordem, ids, camadas, estilos e dados incorporados;
- igualdade de `renderSvg` antes/depois para geometrias visuais representáveis;
- round-trip da versão atual (`parseProject(serializeProject(document))`);
- importação/exportação pela UI ou CLI quando o fluxo correspondente mudar.

Atualizações do schema só estão completas quando todas as fixtures e `npm test` passam. Conversões que intencionalmente mudam aparência precisam de uma decisão explícita, descrição do impacto e teste de diferença aprovado; não podem ser uma consequência incidental da migração.
