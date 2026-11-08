# CommBurn

![CommBurn — editor vetorial para trabalhos a laser](commburn.png)

Rascunho de um editor vetorial simples para trabalhos a laser, com milímetros como unidade canônica e origem/eixos controlados explicitamente pelo usuário.

## Experimentar

- Abra `index.html` em um navegador moderno.
- Execute `npm install` e `npm start`; acesse `http://127.0.0.1:4173` para habilitar a conexão serial experimental com controladores compatíveis com GRBL.
- Execute `npm test` para rodar os testes do núcleo e da CLI.
- Exporte um documento JSON para SVG com `node cli/commburn.mjs entrada.json saida.svg`.

## Aplicativo desktop

- Execute `npm run desktop` para abrir o CommBurn em uma janela desktop durante o desenvolvimento.
- O GitHub Actions executa testes e valida os pacotes Linux e Windows em pushes para `main` e pull requests direcionados a `main`.
- O workflow **Build MSIX** gera um pacote Windows separado em pushes/pull requests para `main` ou sob demanda. O `.msix` fica disponível como artifact da execução e não é enviado para uma GitHub Release.
- Para publicar uma versão, atualize `package.json` e `package-lock.json`, crie e envie a tag correspondente, por exemplo `v0.1.1`. O workflow recusa tags que não correspondam a `v<version>` e publica uma GitHub Release depois que os três builds concluírem.
- A publicação inclui instalador `.msi` e executável portátil `.exe` para Windows, `.dmg` e `.zip` para macOS, e `.AppImage` e `.deb` para Linux. As builds macOS ainda não são assinadas nem notarizadas; isso requer certificados e credenciais Apple configurados como secrets do repositório.

O primeiro envio à máquina suporta somente contornos retangulares. Confira as limitações e precauções de hardware em [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md). O contrato de automação, plugins e GRBL está em [docs/PLUGIN_CLI_CONTRACT.md](docs/PLUGIN_CLI_CONTRACT.md).

Para módulos de interface, ferramentas, atalhos, geometria e pontos de extensão, consulte [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md).
