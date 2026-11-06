# App "Nexa OS" na Meta: WhatsApp Cloud API e Cadastro Incorporado

App ID **2330123227786041** · Portfólio **Nexa Performance** (Business ID 1819405918725550) ·
Provedor de Tecnologia. App web: **https://app.nexaperformanceos.com.br**.

Tudo aqui é **novo e separado** da Turbine Clean: o app "gestão Turbine Clean", o número da
Turbine, o webhook dela, os tokens e o Chatwoot não mudam. Nenhum número de cliente é conectado
por enquanto.

## 1. Endereços

| O quê                                          | URL                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Política de Privacidade                        | https://app.nexaperformanceos.com.br/privacidade                                                                              |
| Termos de Uso                                  | https://app.nexaperformanceos.com.br/termos                                                                                   |
| Exclusão de dados (instruções)                 | https://app.nexaperformanceos.com.br/exclusao-de-dados                                                                        |
| Callback de exclusão de dados (signed_request) | https://avvxapeplhuiruijyyed.supabase.co/functions/v1/nexa-meta-exclusao                                                      |
| Callback de desautorizar (deauthorize)         | https://avvxapeplhuiruijyyed.supabase.co/functions/v1/nexa-meta-desautorizar                                                  |
| Webhook do WhatsApp (URL de retorno)           | https://avvxapeplhuiruijyyed.supabase.co/functions/v1/nexa-meta-webhook                                                       |
| Tela "Conectar WhatsApp" (admin da empresa)    | https://app.nexaperformanceos.com.br/configuracoes/whatsapp                                                                   |
| Tela de testes (Painel Nexa)                   | https://app.nexaperformanceos.com.br/nexa/meta-teste                                                                          |
| Ícone 1024×1024                                | `public/brand/meta/nexa-os-icone-1024.png` (também em https://app.nexaperformanceos.com.br/brand/meta/nexa-os-icone-1024.png) |

## 2. Secrets (Supabase → Edge Functions → Secrets)

| Nome                                 | O que colocar                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `NEXA_META_APP_SECRET`               | Chave secreta do app Nexa OS (Configurações do app → Básico)                                                                   |
| `NEXA_META_WEBHOOK_VERIFY_TOKEN`     | Um texto aleatório inventado por você (ex.: `openssl rand -hex 24`); o mesmo vai no campo "Verificar token" do webhook na Meta |
| `NEXA_META_TOKEN_KEY`                | Chave da criptografia dos tokens dos clientes: `openssl rand -base64 32` (32 bytes). Não troque depois de conectar clientes    |
| `NEXA_META_ES_CONFIG_ID`             | ID da configuração do "Login do Facebook para Empresas" (Cadastro Incorporado)                                                 |
| `NEXA_META_TESTE_TOKEN`              | Token de acesso do número de teste (+1 555 188-4259), com whatsapp_business_messaging e whatsapp_business_management           |
| `NEXA_META_APP_ID` (opcional)        | Só se quiser trocar o App ID (padrão 2330123227786041)                                                                         |
| `NEXA_META_GRAPH_VERSION` (opcional) | Versão da Graph API (padrão `v23.0`)                                                                                           |

Os IDs do número de teste ficam no código, porque não são segredo: Phone Number ID
1547429628435173 e WABA 3641269396036529.

## 3. Como funciona

- **Webhook** (`nexa-meta-webhook`). O GET confere o `hub.verify_token` e devolve o `hub.challenge`.
  O POST confere `X-Hub-Signature-256` (HMAC-SHA256 do corpo com o App Secret) e grava mensagens e
  status em `whatsapp_cloud_eventos`; a empresa é achada pelo `phone_number_id`/`waba_id`. Não
  responde ao cliente, não chama a Alice e não mexe no Chatwoot.
- **Cadastro Incorporado**. A tela abre o SDK da Meta (`FB.login` com `config_id`), lê o `waba_id` e
  o `phone_number_id` pelo postMessage e manda o `code` para `nexa-meta-cadastro`. A função:
  1. troca o `code` pelo token;
  2. confere no `debug_token` que o WABA é desse token;
  3. guarda o token e o PIN criptografados (AES-256-GCM) em `whatsapp_cloud_segredos`;
  4. faz `POST /{waba_id}/subscribed_apps`;
  5. faz `POST /{phone_number_id}/register` com o PIN;
  6. salva número, nome e situação.
- **Liberação**. Empresa sem linha em `whatsapp_cloud_conexoes` vê "Ainda não disponível". Para
  liberar uma empresa (só com OK do dono):
  `INSERT INTO whatsapp_cloud_conexoes (empresa_id) VALUES ('<id>');`
- **Exclusão e desautorizar**. Validam o `signed_request` e registram em `meta_exclusao_pedidos`. A
  exclusão devolve `{ url, confirmation_code }`; a página `/exclusao-de-dados?codigo=` mostra a
  situação do pedido.

## 4. Chamadas de teste (para liberar o acesso avançado)

Pré-requisitos:

- secrets acima preenchidos;
- seu celular cadastrado como destinatário em WhatsApp → Configuração da API ("Para", até 5
  números).

1. Entre no app como admin da Nexa → Painel Nexa → **WhatsApp Cloud: teste**.
2. Em "Enviar para", digite seu número com DDI (ex.: 55119…).
3. **Enviar modelo** com `hello_world`: a mensagem chega no seu WhatsApp. Este passo abre a
   conversa.
4. Responda pelo seu celular, toque **Atualizar** em "Mensagens recebidas" e confira sua mensagem
   (é o webhook funcionando).
5. **Enviar texto**: chega no seu WhatsApp (dentro da janela de 24 h aberta pela sua resposta).
6. **Listar modelos** e **Listar números**: a resposta da Meta aparece embaixo, com
   `hello_world`, o número +1 555 188-4259 etc.
7. (Opcional) **Criar modelo**: cria `nexa_os_teste`, que fica em análise na Meta.

O que conferir:

- no painel do app → Análise do app → Permissões, os contadores de chamadas de
  whatsapp_business_messaging e whatsapp_business_management sobem (pode levar até 24 h);
- cada botão mostra "ok" e a resposta da Meta sem erro.

## 5. Roteiro do vídeo de demonstração (legendas em inglês)

Grave a tela em 1080p, com o mouse visível, em uma empresa de demonstração já liberada. Nunca use o
número da Turbine. Para o Cadastro Incorporado, use um número que não esteja em uso no WhatsApp.

**a) Connect WhatsApp**

1. Abra https://app.nexaperformanceos.com.br e faça login.
   Legenda: _"A business logs in to Nexa OS, our customer service and operations platform."_
2. Configurações → Mensagens → **Conectar WhatsApp**.
   Legenda: _"In Settings, the business admin opens 'Connect WhatsApp'."_
3. Toque em **Conectar WhatsApp**.
   Legenda: _"Clicking 'Connect WhatsApp' launches Meta's Embedded Signup."_

**b) Embedded Signup → number connected** 4. Entre com o Facebook, escolha o portfólio, crie ou escolha a conta do WhatsApp Business, informe
o número e confirme o código.
Legenda: _"The business selects its portfolio, creates a WhatsApp Business Account and verifies
its own phone number."_ 5. De volta ao Nexa OS, o card mostra **Conectado** com o número.
Legenda: _"Nexa OS exchanges the code on the server, subscribes to the account's webhooks and
registers the number. The number now shows as Connected."_

**c) Receive and reply** 6. De outro celular, mande "Hi, I'd like a quote" para o número conectado (ou, no Painel Nexa →
WhatsApp Cloud: teste, para o número de teste). 7. Toque **Atualizar** em "Mensagens recebidas": a mensagem aparece.
Legenda: _"The customer's message arrives in Nexa OS through the WhatsApp Cloud API webhook."_ 8. Toque **Responder**, escreva a resposta e **Enviar texto**; mostre a resposta chegando no
celular.
Legenda: _"The agent replies from Nexa OS and the customer receives it on WhatsApp
(whatsapp_business_messaging)."_

**d) Message templates** 9. **Listar modelos**: a lista aparece.
Legenda: _"Nexa OS lists the account's message templates (whatsapp_business_management)."_ 10. **Criar modelo** (`nexa_os_teste`): a resposta mostra o modelo criado, em análise.
Legenda: _"The business creates a new utility template, which is submitted to Meta for
review."_ 11. (Opcional) **Enviar modelo** `hello_world`.
Legenda: _"Approved templates are used to start conversations, such as appointment
confirmations."_

## 6. Textos para a Análise do app (em inglês, para colar)

**whatsapp_business_messaging**

> Nexa OS is a customer service and operations platform for cleaning-service businesses (upholstery
> and mattress cleaning). Each business connects its own WhatsApp number through Embedded Signup.
> We use whatsapp_business_messaging to send and receive WhatsApp messages on behalf of the
> connected business: we receive customer messages via webhooks and display them in the Nexa OS
> inbox, agents reply from Nexa OS within the 24-hour customer service window, and the business
> sends approved template messages that customers expect, such as appointment confirmations,
> quotes they requested and service follow-ups. Messages are only sent from the business's own
> number to its own customers. No messages are sent without the business's action or configuration,
> and we do not send marketing on our own behalf.

**whatsapp_business_management**

> We use whatsapp_business_management to onboard and manage each business's own WhatsApp Business
> Account after it completes Embedded Signup inside Nexa OS: subscribing our app to the account's
> webhooks, registering the phone number on the Cloud API, reading the phone number details
> (display number, verified name and quality) to show the connection status, and listing, creating
> and editing the business's message templates from the Nexa OS settings screen. We only access the
> WhatsApp Business Accounts that the business explicitly shares with Nexa OS during Embedded
> Signup.

## 7. Checklist do que depende de você na Meta

- [ ] **Configurações do app → Básico**:
  - Política de Privacidade, Termos e Exclusão de dados com as URLs acima;
  - categoria do app;
  - ícone 1024×1024;
  - e-mail de contato.
- [ ] **Callbacks** (Login do Facebook para Empresas → Configurações): desautorizar e exclusão de
      dados com as URLs acima.
- [ ] **WhatsApp → Configuração → Webhook**:
  - URL de retorno: a do `nexa-meta-webhook`;
  - Verificar token: o mesmo de `NEXA_META_WEBHOOK_VERIFY_TOKEN`;
  - tocar **Verificar e salvar**;
  - assinar o campo **messages**.
- [ ] **Login do Facebook para Empresas → Configurações**: criar a configuração do Cadastro
      Incorporado (WhatsApp, permissões whatsapp_business_management e whatsapp_business_messaging) e
      me passar o **config_id** (vai em `NEXA_META_ES_CONFIG_ID`).
- [ ] Secrets no Supabase (seção 2).
- [ ] Número de teste: cadastrar o seu celular como destinatário ("Para") na Configuração da API.
- [ ] Rodar as chamadas de teste (seção 4) e esperar os contadores subirem.
- [ ] Gravar o vídeo (seção 5) e enviar a Análise do app pedindo **acesso avançado** a
      whatsapp_business_messaging e whatsapp_business_management, com os textos da seção 6.
- [ ] Depois da aprovação: me pedir para liberar a primeira empresa (nunca a Turbine sem OK).
