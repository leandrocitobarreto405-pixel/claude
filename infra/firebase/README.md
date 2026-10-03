# Domínio do app (Firebase Hosting → Cloud Run)

`app.nexaperformance.com.br` aponta para o Firebase Hosting, que repassa tudo ao Cloud Run
`nexaos` (southamerica-east1). O domínio direto do Cloud Run não existe nessa região.

- Publicar de novo esta configuração (raramente necessário; o app em si continua sendo publicado
  pelo Cloud Build a cada push): no Cloud Shell, nesta pasta, `firebase deploy --only hosting --project <ID_DO_PROJETO>`.
- Limite do Firebase: **60 s por pedido** e corpo de pedido limitado. Webhooks (Chatwoot, Meta) e
  rotinas agendadas continuam chamando o endereço `run.app` direto, sem esse limite.
- O Firebase só repassa o cookie `__session`; o app não usa cookies (o login vai no cabeçalho
  `Authorization`), então isso não afeta.
- Páginas e funções do servidor não mandam `Cache-Control: public`, então o Firebase não guarda
  cópia; os arquivos de `/assets/` (com hash no nome) ficam em cache, como deve ser.
