# Anúncios: pop-up das landings → CRM → conversão offline no Google Ads

Fluxo: o visitante clica no anúncio, cai na landing (Lovable), preenche o pop-up (nome e
WhatsApp) e vai para o WhatsApp. O pop-up manda os dados para o Nexa, que guarda o clique
(`ads_clicks`), liga ao lead quando a conversa chega e, quando a venda é paga, exporta a conversão
para a planilha que o Google Ads importa todo dia.

Nada de anúncio fica em `crm_leads`: a ligação é `ads_clicks.crm_lead_id`.

## 1. Endpoint do pop-up

```
POST https://nexaos-980094719320.southamerica-east1.run.app/api/public/ads/lead
```

- Aceita JSON (`Content-Type: application/json`), formulário ou `navigator.sendBeacon` (texto com JSON).
- Campos (aceita também os nomes entre parênteses):
  `nome` (name), `telefone` (phone, whatsapp, celular), `gclid`, `gbraid`, `wbraid`, `fbclid`,
  `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `page_url` (pageUrl, url),
  `servico` (service: "higienizacao" / "impermeabilizacao").
  O que faltar e estiver na URL da página (`page_url`) é lido de lá (gclid e UTMs).
  Sem `servico`, o serviço vem do endereço da landing ("imper" / "higien").
- Resposta: sempre **200** com `{ "ok": true|false, "resultado": "..." }`. O front nunca precisa
  esperar nem tratar erro. Resultados: `gravado`, `duplicado`, `invalido`, `dominio_desconhecido`,
  `limite`, `erro`.
- CORS: só os domínios da tabela `ads_dominios`. Hoje: `turbinecleanimper.lovable.app` e
  `turbineclanhigenizacao.lovable.app`.
- Idempotente: mesmo telefone + mesmo gclid na última hora devolve o registro que já existe.
- Limite: 20 envios por IP a cada 10 minutos (o IP não é guardado, só um hash).

Exemplo para o pop-up (Lovable):

```js
const params = new URLSearchParams(location.search);
fetch("https://nexaos-980094719320.southamerica-east1.run.app/api/public/ads/lead", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  keepalive: true, // continua mesmo se a página mudar para o WhatsApp
  body: JSON.stringify({
    nome, telefone,
    gclid: params.get("gclid"), gbraid: params.get("gbraid"), wbraid: params.get("wbraid"),
    fbclid: params.get("fbclid"),
    utm_source: params.get("utm_source"), utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"), utm_term: params.get("utm_term"),
    utm_content: params.get("utm_content"),
    page_url: location.href,
    servico: "impermeabilizacao", // ou "higienizacao", conforme a landing
  }),
}).catch(() => {});
// e em seguida abre o WhatsApp normalmente
```

Nova landing: cadastrar o domínio (sem `https://`):

```sql
INSERT INTO ads_dominios (dominio, empresa_id)
VALUES ('nova-landing.lovable.app', '11111111-1111-1111-1111-111111111111');
```

O servidor relê a lista a cada minuto.

## 2. Vínculo com o lead

- Lead criado (ou com o telefone trocado): pega o clique mais recente do mesmo telefone nos últimos
  90 dias, ainda sem lead, e preenche `crm_lead_id` e `vinculado_em`.
- Pop-up depois do lead existir (lead com atividade nos últimos 90 dias): liga na hora.
- Primeira mensagem do cliente no WhatsApp depois do pop-up: `whatsapp_iniciado_em`.
- Telefone: mesma normalização do CRM (`private.normalizar_telefone`). A comparação usa
  `private.telefone_chave` (DDD + últimos 8 dígitos), porque o WhatsApp manda alguns celulares
  sem o 9º dígito (na Turbine, 8 de 70 contatos).

## 3. Conversões (`vw_conversoes_google`)

Colunas exatas da importação offline: `Google Click ID`, `Conversion Name`, `Conversion Time`,
`Conversion Value`, `Conversion Currency`. Só vendas com gclid ainda não enviadas.

- **Venda** = `crm_leads.faturado_em` preenchido (primeiro pagamento "Pago" da OS do lead).
- **Nome**: "Venda Higienização" ou "Venda Impermeabilização", pelo `servico` do clique (sem
  serviço no clique, pelo serviço de interesse do lead; na dúvida, higienização).
- **Horário**: `faturado_em` no horário de São Paulo, `yyyy-MM-dd HH:mm:ss-03:00`. O pagamento é
  registrado por data (o sistema usa 12h); se cair antes do clique (pagamento no mesmo dia), usa
  1 minuto depois do clique, porque o Google recusa conversão anterior ao clique.
- **Valor**: `work_orders.total_gross_value`, o total da OS (o valor fechado com o cliente, antes
  de taxas de cartão e descontos de recebimento). É o que o Google deve otimizar: receita da venda,
  não o líquido recebido. Venda sem OS ligada ao lead não entra.
- **Uma conversão por venda**: o clique com gclid mais recente do lead, feito até 90 dias antes da
  venda. Lead que já teve conversão enviada não volta, mesmo com clique novo.

`vw_conversoes_google_pendentes` é a mesma consulta com os IDs (usada pela exportação).

## 4. Exportação diária para a planilha

A planilha fica no Google Drive da conta que a empresa conectou no Nexa (Turbine:
`atendimento@turbineclean.com.br`). Não precisa compartilhar com mais ninguém.

Configuração (uma vez):

1. No Cloud Shell, ative a API do Sheets no projeto do Nexa:
   `gcloud services enable sheets.googleapis.com`
2. Crie a planilha com a conta `atendimento@turbineclean.com.br` (ou compartilhe com ela como
   editora) e pegue o ID (o trecho entre `/d/` e `/edit` do link).
3. Grave o ID:
   ```sql
   INSERT INTO ads_configuracoes (empresa_id, google_planilha_id)
   VALUES ('11111111-1111-1111-1111-111111111111', 'ID_DA_PLANILHA')
   ON CONFLICT (empresa_id) DO UPDATE SET google_planilha_id = EXCLUDED.google_planilha_id;
   ```

A exportação reescreve a primeira aba: linha 1 `Parameters:TimeZone=America/Sao_Paulo`, linha 2 os
nomes das colunas e, embaixo, as conversões dos últimos 90 dias (as que já estavam + as novas).
Manter as recentes evita perder uma venda se o Google ler a planilha só depois de duas
exportações; o Google ignora a mesma conversão (gclid + nome + horário) importada de novo. Depois
de gravar a planilha, marca `enviado_google_em` nos cliques exportados.

Rodar à mão (Cloud Shell):

```bash
URL=https://nexaos-980094719320.southamerica-east1.run.app
SEGREDO=$(gcloud secrets versions access latest --secret=nexa-tarefas-segredo)
# Só mostra o que seria exportado (não grava nem marca nada):
curl -s -X POST "$URL/api/public/hooks/ads-exportar-google?simular=1" -H "Authorization: Bearer $SEGREDO"
# Exporta de verdade:
curl -s -X POST "$URL/api/public/hooks/ads-exportar-google" -H "Authorization: Bearer $SEGREDO"
```

Agendar (depois do teste), todo dia às 5h:

```bash
gcloud scheduler jobs create http ads-exportar-google --location southamerica-east1 \
  --schedule="0 5 * * *" --time-zone="America/Sao_Paulo" \
  --uri="$URL/api/public/hooks/ads-exportar-google" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=nexa-tarefas-segredo)"
```

No Google Ads: crie as ações de conversão "Venda Higienização" e "Venda Impermeabilização"
(Metas → Conversões → Nova → Importar → Outras fontes de dados ou CRMs → Rastrear conversões de
cliques) e agende a importação em Metas → Conversões → Uploads → Programações → Google Sheets,
apontando para a planilha, diariamente depois das 5h.

## 5. Fase 2 (desligada): a Alice inicia a conversa

Se quem preencheu o pop-up não chamar no WhatsApp em N minutos (`alice_iniciar_apos_minutos`,
padrão 3), a Alice inicia a conversa. Precisa de modelo de mensagem aprovado pela Meta.

- Liga em `ads_configuracoes.alice_iniciar_conversa`; o banco não deixa ligar sem
  `alice_template_nome`.
- Roda na varredura da Alice (a cada 5 min): atraso real entre N e N+5 minutos.
- Ponto de integração: `enviarModeloDeBoasVindas` em `src/lib/ads/alice-contato.server.ts`. Hoje
  não envia nada; falta implementar o envio do modelo pelo Chatwoot (criar contato e conversa,
  mandar o modelo, deixar a conversa pendente com a Alice) e marcar `alice_contato_em`.

## 6. Logs

- Cloud Run: linhas JSON com `message` começando por `[ads]` (filtro no Logs Explorer:
  `jsonPayload.message:"[ads]"`). Eventos: `captacao.*`, `cors.recusado`, `exportacao.*`,
  `alice_contato.*`.
- Banco: `ads_eventos` (tipo `captacao`, `vinculo`, `whatsapp`, `exportacao_google`, `alice`).

```sql
SELECT created_at, tipo, resultado, detalhe FROM ads_eventos ORDER BY created_at DESC LIMIT 50;
```

## Testes

| Teste | O que verifica |
|---|---|
| `supabase/tests/100_ads.sql` | Domínio, validação, idempotência, limite por IP, vínculo (com e sem o 9º dígito, na criação e na troca do telefone, pop-up depois do lead), WhatsApp iniciado, conversões (só venda paga com OS, uma por lead, horário, valor, colunas exatas), isolamento entre empresas, fase 2 travada. Proteções validadas com mutação. |
| `supabase/tests/api/ads.test.mjs` | Endpoint (JSON, formulário, sendBeacon, CORS no POST, falhas sempre 200), lead pelo WhatsApp, exportação simulada e real para planilha falsa, erro do Google sem marcar enviados, fase 2 desligada. |
| `src/lib/ads/ads.test.ts` | Leitura do pop-up, domínio de origem, linhas recentes da planilha. |

O preflight de CORS (OPTIONS) é respondido pelo Vite no modo dev; foi conferido no build de
produção (`NITRO_PRESET=node-server`): landing liberada, outro domínio sem liberação.
