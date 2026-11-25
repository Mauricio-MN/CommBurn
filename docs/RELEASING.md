# Versionamento e builds

Este documento descreve como a versão do CommBurn é definida e como gerar pacotes pelo GitHub Actions. Os comandos de desenvolvimento do dia a dia estão no [README](../README.md).

## Onde a versão vive

A versão do aplicativo é a de `package.json` (campo `version`), repetida em `package-lock.json` (duas ocorrências, no topo do arquivo). Todos os workflows leem esse valor; não existe outro número de versão no Actions.

Ela não tem relação com a versão do formato de projeto (`commburn-project`), descrita em [PROJECT_FORMAT.md](./PROJECT_FORMAT.md): são independentes.

Para trocar a versão, sem criar tag:

```bash
npm version 0.1.3 --no-git-tag-version
```

Isso atualiza `package.json` e `package-lock.json`. Use o formato semver (`X.Y.Z` ou `X.Y.Z-prerelease`).

## Workflows

Todos ficam em `.github/workflows/`. Exceto o CI, só rodam manualmente (**Actions → nome do workflow → Run workflow**).

| Workflow | Quando roda | Pede versão? | Resultado |
| --- | --- | --- | --- |
| **CI** | Push e pull request para `main`; também manual | Não | Executa `npm test` e os testes de navegador (Ubuntu e Windows) |
| **Desktop release** | Manual | Sim | GitHub Release `vX.Y.Z` com instaladores de Linux, Windows e macOS |
| **Build MSIX** | Manual | Sim, mais o canal (`store` ou `local`) | Artifact `commburn-msix-vX.Y.Z-<canal>`, que não vai para a Release |
| **Build Android test APK** | Manual | Não (lê `package.json`) | Artifact `commburn-android-debug` com `CommBurn-X.Y.Z-debug.apk` (30 dias) |
| **Windows test installer** | Manual | Não | Artifact `commburn-windows-test-installer-<n>` com o `.exe` (14 dias) |

## Gerar uma release desktop

1. Atualize a versão com `npm version X.Y.Z --no-git-tag-version`.
2. Faça commit e push dessa alteração para `main`.
3. No GitHub, abra **Actions → Desktop release → Run workflow**, selecione a branch `main`, informe `X.Y.Z` (sem o `v`) e inicie.
4. Ao terminar com sucesso, a Release `vX.Y.Z` é criada com as notas geradas automaticamente e os pacotes:
   - Windows: instalador `.msi` e executável portátil `.exe`
   - macOS: `.dmg` e `.zip`
   - Linux: `.AppImage` e `.deb`

Cada sistema roda `npm ci`, `npm test` e `npm run dist` antes de empacotar. As builds macOS ainda não são assinadas nem notarizadas; isso exige certificados e credenciais Apple configurados como secrets do repositório.

### Validações do workflow

O workflow recusa a execução quando:

- a branch escolhida não é `main`;
- a versão informada é diferente da de `package.json`;
- a versão não segue semver;
- a tag `vX.Y.Z` já existe no repositório.

Se uma release saiu errada e precisa ser refeita com o mesmo número, apague a Release e a tag no GitHub antes de rodar de novo; caso contrário, suba a versão.

## Gerar o MSIX

Use a mesma versão que já está em `main` e abra **Actions → Build MSIX → Run workflow**. Escolha `main`, informe a versão e o canal:

- `store`: usa a identidade e o publisher reservados no Partner Center, para envio à loja (a Store assina o pacote).
- `local`: usa o publisher `CN=CMBRN - Software`, para ser assinado localmente com um certificado de mesmo subject.

Ao terminar, baixe `commburn-msix-vX.Y.Z-<canal>` na seção **Artifacts** da execução. O arquivo fica disponível por 90 dias e não é adicionado à GitHub Release. Esse workflow também exige a branch `main` e a versão igual à de `package.json`.

## Android e instalador de teste

- **Build Android test APK** roda `npm test`, gera os assets web, cria o projeto Android com Capacitor, aplica a versão de `package.json` como `versionName` e compila um APK de depuração. Não tem campo de versão: atualize o `package.json` antes.
- **Windows test installer** roda os testes (incluindo os de navegador) e gera um instalador de teste com `npm run dist:test`. Ele inclui o plugin proprietário "Tema Escuro", conforme o README.

## Comandos locais

| Comando | O que faz |
| --- | --- |
| `npm test` | Testes do núcleo e do CLI |
| `npm run test:browser` | Testes de navegador (Playwright) |
| `npm run desktop` | Abre o app desktop em modo de desenvolvimento |
| `npm run dist` | Pacotes desktop padrão, sem publicar |
| `npm run dist:test` | Instalador de teste para Windows |
| `npm run dist:msix` | MSIX local, no Windows |
| `npm run build:www` / `npm run build:android` | Assets web e sincronização do projeto Android |
