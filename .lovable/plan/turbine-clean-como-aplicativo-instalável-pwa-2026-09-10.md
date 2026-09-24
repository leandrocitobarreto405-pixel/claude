# Turbine Clean como aplicativo instalável (PWA)

O app passa a poder ser instalado na tela inicial do celular, com nome, ícone e cores próprias, abrindo em tela cheia sem a barra do navegador.

## Observação sobre o ícone

As duas imagens anexadas são prints das telas do app, não um logo. Vou criar o ícone a partir da marca já usada no app (gota branca sobre quadrado teal, igual ao topo do menu). Se você tiver o logo em arquivo (PNG de preferência quadrado), envie e eu troco.

## O que será feito

1. Ícones do app em vários tamanhos (192px, 512px, versão para iPhone e favicon), gerados a partir da marca Turbine Clean.
2. Arquivo de configuração do aplicativo com: nome "Turbine Clean", nome curto "Turbine", abertura em tela cheia, cor de tema azul-marinho (#123B5D) e fundo claro (#F4F8FA), idioma pt-BR, atalho direto para a Agenda e para Nova OS.
3. Etiquetas necessárias no topo do site para Android/Chrome e iPhone/Safari reconhecerem o app.
4. Aviso de instalação dentro do app:
   - Android/Chrome: botão "Instalar aplicativo" que dispara o convite nativo do navegador.
   - iPhone/Safari: cartão explicando o caminho Compartilhar > Adicionar à Tela de Início (Safari não tem convite automático).
   - Aparece apenas no celular, some depois de instalado e pode ser fechado (não volta a incomodar).
5. Revisão de responsividade nas telas mais usadas no celular (Início, Agenda, Nova OS, OSs criadas, Orçamentos, Pagamentos): tabelas com rolagem correta, filtros empilhados, botões com área de toque adequada e nada cortado na largura.

## Fora do escopo

Uso offline (sem internet) não entra: o app depende de dados do servidor em quase toda tela, e cache offline traria risco de mostrar informação financeira desatualizada. Se quiser depois, faço em uma etapa separada.

## Detalhes técnicos

- `public/manifest.webmanifest` + ícones em `public/icons/` (192, 512, 512 maskable, apple-touch-icon 180).
- Tags `manifest`, `theme-color`, `apple-mobile-web-app-*` e `apple-touch-icon` no `head()` de `src/routes/__root.tsx`.
- Novo componente `src/components/install-prompt.tsx`: escuta `beforeinstallprompt`, detecta iOS/Safari por user agent, esconde quando `display-mode: standalone`, guarda a dispensa em `localStorage`. Renderizado dentro de `AppShell`.
- Sem service worker, sem `vite-plugin-pwa`, sem cache-busting — instalação só por manifest.
