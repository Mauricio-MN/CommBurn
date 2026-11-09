# CommBurn

![CommBurn — editor vetorial para trabalhos a laser](commburn.png)

Rascunho de um editor vetorial simples para trabalhos a laser, com milímetros como unidade canônica e origem/eixos controlados explicitamente pelo usuário.

[Política de privacidade](PRIVACY.md)

## Experimentar

- Abra `index.html` em um navegador moderno.
- Execute `npm install` e `npm start`; acesse `http://127.0.0.1:4173` para habilitar a conexão serial experimental com controladores compatíveis com GRBL.
- Execute `npm test` para rodar os testes do núcleo e da CLI.
- Exporte um documento JSON para SVG com `node cli/commburn.mjs entrada.json saida.svg`.

## Aplicativo desktop

- Execute `npm run desktop` para abrir o CommBurn em uma janela desktop durante o desenvolvimento.
- O GitHub Actions executa os testes automaticamente em pushes para `main` e pull requests direcionados a `main`. A criação de pacotes de lançamento é manual.
- Para criar builds versionados:
  1. Atualize a versão, por exemplo, com `npm version 0.1.1 --no-git-tag-version` (isso altera `package.json` e `package-lock.json`, sem criar uma tag).
  2. Envie essa alteração para `main` com seu fluxo normal de commit e push.
  3. No GitHub, abra **Actions → Desktop release → Run workflow**, selecione `main`, informe `0.1.1` (sem `v`) e inicie.
  4. Quando a execução terminar com sucesso, a GitHub Release `v0.1.1` terá os instaladores de Linux, Windows e macOS.
- A publicação inclui instalador `.msi` e executável portátil `.exe` para Windows, `.dmg` e `.zip` para macOS, e `.AppImage` e `.deb` para Linux. As builds macOS ainda não são assinadas nem notarizadas; isso requer certificados e credenciais Apple configurados como secrets do repositório.
- Para gerar um `.msix` versionado, use a mesma versão já enviada para `main` e abra **Actions → Build MSIX → Run workflow**. Escolha `main`, informe a versão (por exemplo, `0.1.1`) e inicie. Ao terminar, baixe `commburn-msix-v0.1.1` na seção **Artifacts** da execução. O arquivo fica disponível por 90 dias e não é adicionado à GitHub Release. O pacote usa a identidade e o publisher reservados no Partner Center; assine-o conforme os requisitos da conta antes do envio. Também é possível executar `npm run dist:msix` localmente no Windows.

O primeiro envio à máquina suporta somente contornos retangulares. Confira as limitações e precauções de hardware em [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md). O contrato de automação, plugins e GRBL está em [docs/PLUGIN_CLI_CONTRACT.md](docs/PLUGIN_CLI_CONTRACT.md).

Para módulos de interface, ferramentas, atalhos, geometria e pontos de extensão, consulte [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md).
