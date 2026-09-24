# Pasta da cliente: documentos automáticos, fotos na conclusão e envio por e-mail

## 1. Uma pasta só para compartilhar

A pasta da OS continua sendo a pasta única que você compartilha, agora com o nome
`OS {número} - {cliente} - Turbine Clean`. Dentro dela ficam:

- o documento da OS (com os valores),
- o termo de garantia (quando houver impermeabilização),
- e as subpastas de mídia, criadas conforme o serviço.

## 2. Subpastas conforme o tipo de serviço

- Só higienização: `Antes` e `Depois`.
- Só impermeabilização: `Vídeos`.
- Higienização + impermeabilização: `Antes`, `Depois` e `Vídeos`.

Se o serviço mudar depois, as subpastas que faltarem são criadas na hora.

## 3. Pasta de controle interno com nome completo

A pasta interna passa a se chamar `OS {número} - {cliente} - Controle interno`, fora da pasta da
cliente e nunca incluída no link. Pastas internas antigas são renomeadas no próximo uso.

## 4. Fotos e vídeos dentro do "Concluir serviço"

O técnico não precisa mais descer na OS: no mesmo passo em que informa produtos usados e gastos
(estacionamento, zona azul, pedágio), aparece o envio de mídia:

- Higienização: envio de fotos de `Antes` e `Depois`.
- Impermeabilização: envio de `Vídeos`.
- Combinada: as três opções.
- Também disponível o destino `Controle interno`, com o aviso de que não aparece para a cliente.
- Vários arquivos por vez, progresso por arquivo, e um arquivo com erro não impede os outros.
- Envio opcional: não trava a conclusão se o técnico não tiver arquivos no momento.

A seção "Fotos e vídeos" continua existindo na tela da OS para complementos posteriores.

## 5. Documentos gerados sozinhos

- Ao concluir o atendimento de impermeabilização, o termo de garantia é gerado automaticamente na
  pasta da OS.
- Ao concluir o atendimento, o documento da OS também é gerado (ou atualizado) automaticamente.
- Os botões manuais de gerar/gerar novamente continuam existindo.
- Falha no Drive não bloqueia a conclusão: fica registrado o erro e o botão manual resolve.

## 6. Compartilhar com a cliente só depois de concluído

- O compartilhamento com o e-mail cadastrado acontece na conclusão do atendimento, depois do envio
  das mídias — sem depender de pagamento.
- Acesso de leitura, com aviso por e-mail do Google.
- Continua também o link "qualquer pessoa com o link pode ver", para o WhatsApp.
- Sem e-mail no cadastro: só o link, com aviso na tela pedindo o e-mail.
- Feito uma única vez por OS (não repete a cada conclusão ou envio).

## Detalhes técnicos

- `src/lib/google-docs.server.ts`: `shareFolderWithEmail(folderId, email)` via `permissions`
  (`role: reader`, `type: user`, `sendNotificationEmail=true`) e `renameFile(fileId, name)`.
- `src/lib/os-media.server.ts`:
  - `loadWorkOrder` traz `customer.email` e `visits.service_type.name`;
  - `ensureMaterialsFolders` usa o nome `OS {n} - {cliente} - Turbine Clean`, cria `Antes`/`Depois`
    só com higienização e `Vídeos` só com impermeabilização (colunas não usadas ficam `null`), e
    renomeia pastas já criadas com o nome antigo;
  - `ensureInternalFolder` usa o sufixo "Controle interno" e renomeia o formato antigo;
  - novo `shareWithCustomerEmail(workOrderId)` chamado apenas na conclusão, controlado pela coluna
    nova `customer_shared_email` em `os_drive_folders` (migração aditiva);
  - `destinationFolder` valida o destino contra o tipo de serviço.
- `src/lib/os-media.functions.ts`: função autenticada com destinos permitidos + estado do
  compartilhamento; nova `finishOsSharing` (gera documentos pendentes e compartilha por e-mail).
- `src/lib/os-docs.server.ts`: `ensureOsDocuments(workOrderId, userId)` reutilizando
  `generateDocument`/`generateWarranty`, com erros registrados e não propagados.
- `src/components/visit-dialog.tsx`: novo bloco de envio de mídia no passo de conclusão (usa
  `uploadOsMedia`), e após concluir chama `finishOsSharing` de forma não bloqueante, invalidando as
  queries de documentos/mídia da OS.
- `src/routes/_authenticated/os.$osNumber.tsx`: seletor de destino dinâmico e aviso sobre o
  compartilhamento por e-mail.
- Migração aditiva: `ALTER TABLE public.os_drive_folders ADD COLUMN customer_shared_email TEXT`.

## Verificação

- OS de higienização: pasta `OS ... - Turbine Clean` com documento, `Antes` e `Depois`.
- OS de impermeabilização: documento, `Vídeos` e termo gerado sozinho ao concluir.
- OS combinada: as três subpastas, documento e termo.
- Envio de fotos direto no passo de concluir, pelo celular do técnico.
- Convite do Google chegando ao e-mail da cliente somente após a conclusão.
- Pasta interna como `OS 1603 - Cliente - Controle interno`, fora da pasta da cliente.
