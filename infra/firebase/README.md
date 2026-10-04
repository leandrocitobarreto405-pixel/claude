# Domínio do app (Firebase Hosting → Cloud Run)

`app.nexaperformanceos.com.br` aponta para o Firebase Hosting, que repassa tudo ao Cloud Run
`nexaos` (southamerica-east1). O domínio direto do Cloud Run não existe nessa região.

- Publicar de novo esta configuração (raramente necessário; o app em si continua sendo publicado
  pelo Cloud Build a cada push): no Cloud Shell, nesta pasta, `firebase deploy --only hosting --project <ID_DO_PROJETO>`.
- Limite do Firebase: **60 s por pedido** e corpo de pedido limitado. Webhooks (Chatwoot, Meta) e
  rotinas agendadas continuam chamando o endereço `run.app` direto, sem esse limite.
- Chamadas pesadas do app (envio de foto/vídeo da OS, gerar documento e termo da OS, importar
  planilha de contatos, preparar/editar campanha, teste de planilhas) vão **direto ao `run.app`**
  mesmo com o app aberto pelo domínio novo (`fetchDireto` em `src/lib/enderecos.ts`). O servidor
  libera CORS/CSRF só para as origens do app (`ORIGENS_DO_APP`).
- O Firebase só repassa o cookie `__session`; o app não usa cookies (o login vai no cabeçalho
  `Authorization`), então isso não afeta.
- Páginas e funções do servidor não mandam `Cache-Control: public`, então o Firebase não guarda
  cópia; os arquivos de `/assets/` (com hash no nome) ficam em cache, como deve ser.

## Endereços oficiais (desde 04/10/2026)

| Uso                                                                                       | Endereço                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| App (equipe, convites, links de senha, confirmação de conta)                              | https://app.nexaperformanceos.com.br                   |
| Webhooks (Chatwoot, robô da Alice, leads, WhatsApp), rotinas agendadas e chamadas pesadas | https://nexaos-980094719320.southamerica-east1.run.app |

No código: `ENDERECO_APP` e `ENDERECO_SERVIDOR` em `src/lib/enderecos.ts`. As telas que mostram
endereço de webhook sempre mostram o `run.app`, mesmo abertas pelo domínio novo.

Notificações no celular: a permissão é por endereço. Quem ativou pelo `run.app` continua recebendo
lá; para receber abrindo pelo domínio novo, ative de novo em Avisos → Notificações no celular.
