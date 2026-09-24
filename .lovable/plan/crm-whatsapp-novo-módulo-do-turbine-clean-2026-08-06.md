# CRM WhatsApp — novo módulo do Turbine Clean

Adiciona um módulo de CRM ao app atual, alimentado pelo webhook do WhatsApp Business, reproduzindo a planilha atual (DATA, NOME, TELEFONE, ESTOFADO, SERVIÇO, FRIO/QUENTE, STATUS, RESUMO, CHAMEI?, O QUE ACONTECEU?, ORIGEM, CAMPANHA) com automações seguras. Nada dos módulos existentes é reescrito.

## O que será reaproveitado (sem duplicar)

- `customers` — clientes existentes são vinculados pelo telefone normalizado; nunca duplicados.
- `work_orders` / `visits` / fluxo de Nova OS — a conversão abre a tela atual de Nova OS pré-preenchida.
- `config_options` — já concentra opções editáveis (`sales_origin`, `service_type`, `upholstery_type`, etc.). Os novos catálogos do CRM (status, resultados de retorno, motivos de perda, interesses de serviço) entram como novos `kind` nessa mesma tabela, editáveis sem código.
- `salespeople` — vendedora do lead.
- Autenticação, RLS por `is_staff`, design system, `AppShell`, formato de webhook público já usado no fechamento de rotas e despesas recorrentes.

## Novas tabelas

`whatsapp_contacts`, `crm_leads`, `whatsapp_messages`, `crm_status_history`, `crm_followups`, `crm_campaigns`, `campaign_investments`, `crm_webhook_events` (logs), `crm_import_batches`.

Regras principais:
- `whatsapp_contacts.normalized_phone` e `wa_id` únicos.
- `whatsapp_messages.whatsapp_message_id` único (idempotência do webhook).
- Todas com RLS: leitura/escrita apenas para usuários autenticados da equipe (mesmo padrão `is_staff`), com GRANTs explícitos. Nenhum dado de CRM acessível por rota pública.
- Status, motivos de perda e resultados vêm de `config_options` (novos kinds), então dá para renomear, reordenar, colorir, ativar/desativar sem apagar histórico.

## Contato x oportunidade

- **Contato** = uma pessoa/número de WhatsApp.
- **Lead** = uma negociação. O mesmo contato pode ter várias ao longo do tempo (janeiro: impermeabilização; agosto: higienização).
- Mensagem nova em contato com lead **aberto** → entra na oportunidade existente, sem criar lead novo.
- Contato com oportunidade **encerrada** → não cria automaticamente; o app pergunta "reabrir ou criar nova oportunidade?" (criação automática só se o cliente habilitar depois um período de inatividade nas configurações).

## Normalização de telefone

Função compartilhada (usada no webhook, na importação e na busca): remove espaços, parênteses, traços, `+`; mantém DDI; acrescenta `55` quando o número brasileiro vem sem DDI. Guarda formato original para exibição e o numérico para deduplicação — inclusive no cruzamento com `customers`.

## Webhook

Endpoint público em `src/routes/api/public/hooks/whatsapp.ts` (padrão TanStack já usado no app):
- `GET` → verificação da Meta com `WHATSAPP_VERIFY_TOKEN` (hub.challenge).
- `POST` → validação da assinatura `X-Hub-Signature-256` com `WHATSAPP_APP_SECRET`, validação do payload, registro do evento em `crm_webhook_events` (Recebido → Processando → Processado / Ignorado por duplicidade / Erro), com retry e sem duplicar nada.
- Processamento: normaliza telefone → acha/cria contato → atualiza nome e últimos contatos → acha lead ativo ou cria com status inicial → grava mensagem (tipo, mídia, resposta, referral do anúncio) → vincula a cliente existente → atualiza contadores.
- Segredos apenas no backend: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`. A tela de configuração mostra só "configurado / não configurado" — nunca o valor.
- O CRM funciona normalmente antes da conexão (leads manuais + importação).

## Páginas (grupo "CRM" na navegação)

- **Visão geral** — filtros de período/origem/campanha/serviço/vendedora e os KPIs pedidos (contatos, leads únicos, recorrentes, quentes/frios, aguardando, negociação, orçamentos, repescagens, vendas, conversão, custo por lead, custo por venda, receita originada). Lead único conta por telefone normalizado + oportunidade, não por mensagem.
- **Leads** — lista com busca (nome, telefone, estofado, resumo, campanha, conteúdo de mensagem, número da OS) e todos os filtros pedidos; tabela no desktop, cards no mobile.
- **Funil** — kanban com colunas configuráveis e arrastar/soltar; cada movimento grava histórico com usuário e data.
- **Detalhe do lead** — dados de contato e comerciais, histórico de OSs anteriores ("Cliente existente — possui X ordens de serviço anteriores"), linha do tempo (mensagens, mudanças de status, retornos, notas, conversão), ações rápidas (iniciar atendimento, orçamento enviado, aguardando cliente, criar repescagem, agendado, desistiu, converter em OS, nova oportunidade, encerrar) e "Abrir WhatsApp" com modelos editáveis de mensagem — envio sempre manual.
- **Repescagens** — vencidas, de hoje, próximas, sem resposta; "Contato realizado" atualiza CHAMEI? e pergunta "O que aconteceu?" com opções editáveis. Sugestão de 1º retorno em 24h e 2º em 3 dias, com intervalos configuráveis.
- **Campanhas** — CRUD, plataforma, serviço anunciado, mapeamento de `source_id`/ad id, investimento por dia/semana/mês/período; referral sem correspondência aparece como "Campanha não identificada" com opção de criar a campanha a partir dele, sem descartar dado.
- **Relatórios** — leads por dia/semana/mês, por campanha, novos x recorrentes, frio x quente, conversão por status/vendedora/serviço/campanha, custo por lead, por lead quente, por venda, receita por campanha, ROAS, motivos de perda, tempos médios, conversão de repescagem. Exportação Excel/CSV com nomes e cabeçalhos em português. Divisões protegidas contra zero; receita usa o total negociado da OS já usado no financeiro.
- **Importar planilha** — CSV/XLSX, tela de mapeamento das 12 colunas atuais, normalização, detecção de contatos e oportunidades duplicados, prévia e erros antes de confirmar, opções "criar somente novos / atualizar existentes / ignorar duplicados", lote de importação revisável. Não sobrescreve dado mais novo sem confirmação.
- **Configurações do CRM** — status e cores, regras de frio/quente, intervalos de retorno, resultados, motivos de perda, interesses de serviço, origens, campanhas, vendedoras, resumo por IA, transcrição de áudio (padrão desligada).
- **Configurações do WhatsApp** — status da integração (Não configurada / Aguardando conexão / Conectada / Recebendo mensagens / Erro), URL do webhook com botão copiar, indicadores de segredos configurados, último evento recebido/processado, contagem de erros, testar recebimento, verificar configuração, ver registros de erro.

## IA (sugestões, nunca verdade absoluta)

Usa a IA já disponível no app para sugerir nome, estofado, quantidade, serviço de interesse, cidade/bairro, intenção, objeções, próxima ação, temperatura e resumo. Tudo editável; não sobrescreve temperatura ou dados confirmados manualmente sem aviso; nunca inventa preço, data, quantidade, endereço ou decisão de compra. Rótulo "Classificação sugerida pela IA" enquanto não confirmada.

## Conversão em OS

"Converter em OS" abre a tela atual de Nova OS pré-preenchida (nome, telefone, endereço quando existir, origem, campanha, vendedora, estofado, serviço, observações do CRM). O usuário revisa e salva. Depois: lead vinculado à OS, status → Agendado, histórico preservado, conversão duplicada bloqueada, número e link da OS exibidos. Cancelar não altera o status. OS concluída → status Pós-venda.

## Automação: limites

Nunca automático: marcar Desistiu, criar OS, inventar serviço/valor, enviar retorno ou mensagem no WhatsApp, excluir lead, mesclar números diferentes. Inatividade apenas sugere "Não respondeu / Repescar".

## Proteção do que já existe

Somente arquivos novos (`src/lib/crm-*`, `src/routes/_authenticated/crm/*`, hook do webhook) e duas alterações pontuais: acrescentar o grupo CRM em `src/components/app-shell.tsx` e ler parâmetros de pré-preenchimento na Nova OS (padrão `validateSearch` já existente lá, hoje usado por `?editar=`). Nenhuma tabela, política, consulta, cálculo financeiro ou fluxo atual é alterado. Após implementar, valido login, OSs criadas, agenda, mensagens, pagamentos, despesas, rotas, DRE e exportações.

## Entrega em etapas

1. Banco (tabelas, RLS, GRANTs, catálogos), normalização de telefone, webhook seguro, navegação, Configurações do WhatsApp.
2. Leads, detalhe do lead, funil, ações rápidas, conversão em OS.
3. Repescagens, campanhas e investimento, IA de resumo/temperatura.
4. Visão geral, relatórios com exportação, importação da planilha, Configurações do CRM.
