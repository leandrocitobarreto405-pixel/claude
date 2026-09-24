# Pastas e mídias da OS no Google Drive

Organizar os materiais de cada cliente no Google Drive, permitir o envio de várias fotos e vídeos pela tela da OS e manter o conteúdo interno completamente separado do link compartilhado com o cliente.

## Estrutura no Google Drive

- Dentro da pasta configurada, criar ou reutilizar:
  - `Materiais dos clientes / {Ano} / {Mês} / OS {número} - {cliente}`
  - dentro da pasta da OS: `Antes`, `Depois` e `Vídeos`.
- O documento da OS e o termo de garantia passam a ser criados na pasta da OS, junto dessas três subpastas.
- Criar `Controle interno / {Ano} / {Mês} / OS {número} - {cliente}` somente no primeiro envio marcado como controle interno.
- Usar o ano e mês da geração ou do primeiro envio, preservando o comportamento temporal atual.
- OSs antigas e documentos já existentes permanecem onde estão; novas gerações, novas versões e novos arquivos usam a estrutura nova.

## Fotos e vídeos na tela da OS

- Adicionar a seção **Fotos e vídeos** com seleção de vários arquivos de uma vez.
- Permitir escolher um destino por envio: **Antes**, **Depois**, **Vídeos** ou **Controle interno**.
- Exibir no destino interno o aviso **“Não vai aparecer para o cliente”**.
- Mostrar os arquivos selecionados, andamento e resultado individual, permitindo que um arquivo com erro não interrompa os demais.
- Ler a duração dos vídeos no celular antes do envio; acima de 60 segundos mostrar apenas um aviso, sem bloquear.
- Manter os limites seguros do aplicativo para tipo e tamanho de arquivo e apresentar mensagens claras quando um arquivo não puder ser enviado.

## Link para o cliente

- Adicionar **Copiar link para o cliente** na seção de fotos e vídeos.
- Ao usar o botão, criar ou reutilizar a pasta da OS em **Materiais dos clientes**, conceder leitura para qualquer pessoa com o link e copiar o endereço da pasta.
- O compartilhamento será aplicado somente à pasta da OS em **Materiais dos clientes**; a árvore **Controle interno** será uma pasta raiz irmã e nunca será mencionada no link.

## Acesso do técnico

- Liberar `/os` para o papel técnico, permitindo abrir todas as OSs da empresa pelos links da Agenda.
- Conforme definido, o técnico verá a página inteira da OS e poderá enviar vários arquivos.
- Manter o isolamento por empresa existente: nenhum papel acessa OSs de outra empresa.

## Dados e segurança

- Criar uma tabela por empresa/OS para guardar os IDs e links das pastas do Google Drive, evitando duplicação e permitindo reutilização segura.
- Criar uma tabela de arquivos enviados com nome, tipo, tamanho, destino, ID/link no Drive, autor e data, para exibir o histórico na OS.
- Aplicar permissões da base para usuários autenticados da mesma empresa e acesso administrativo do servidor, com os `GRANT`s obrigatórios.
- Validar no servidor a sessão, a empresa da OS, o destino permitido, o tipo e o tamanho antes de aceitar cada upload.

## Implementação técnica

- Ampliar `google-docs.server.ts` com upload multipart para o Drive, criação de permissão pública de leitura e geração de link de pasta, preservando os erros detalhados do provedor no servidor.
- Centralizar em `os-docs.server.ts` a criação/reutilização das árvores de materiais e controle interno; geração da OS e garantia chamará o mesmo resolvedor de pasta.
- Criar funções autenticadas para consultar pastas/arquivos e preparar o link do cliente.
- Criar um endpoint autenticado de upload multipart para receber arquivos binários sem convertê-los para texto, enviá-los ao Drive e registrar o resultado.
- Atualizar a tela da OS com o seletor de destino, seleção múltipla, aviso de duração, progresso, histórico e cópia do link.
- Atualizar `ROTAS_TECNICO` para incluir `/os` sem adicionar a listagem de OSs ao menu do técnico.

## Validação

- Verificar geração do documento e do termo na mesma pasta da OS.
- Testar envio múltiplo para Antes, Depois, Vídeos e Controle interno, incluindo vídeo acima de 60 segundos.
- Confirmar que Controle interno só nasce no primeiro envio interno e nunca aparece no link público.
- Confirmar reutilização das pastas sem duplicatas, compartilhamento somente para leitura e acesso móvel do técnico.
- Confirmar que OSs antigas continuam abrindo e seus documentos antigos não são movidos.