# Integração com o Google Agenda

## Objetivo
Todo serviço agendado no app aparece automaticamente no Google Agenda da empresa, com o técnico como convidado — assim ele recebe o aviso no celular sem ninguém digitar nada. Reagendamentos e cancelamentos refletem na agenda.

## O que muda para você

1. **E-mail do técnico**: cada técnico passa a ter um campo de e-mail em Configurações. É esse e-mail que recebe o convite do evento.

2. **Conexão da conta Google**: em Configurações aparece um bloco "Google Agenda" com liga/desliga, o campo da agenda usada (padrão: agenda principal da conta) e um botão "Testar conexão", no mesmo estilo do bloco de Google Docs.

3. **Criação automática do evento**, quando a integração estiver ligada:
   - Serviço de OS: título "OS {número} - {cliente}"
   - Visita de orçamento: título "Orçamento - {cliente}"
   - Descrição: endereço completo, serviço/estofados e telefone do cliente
   - Data e hora do agendamento, duração padrão de 2 horas
   - Convidado: e-mail do técnico responsável (se cadastrado)

4. **Reagendamento**: gera um evento novo na nova data; o evento antigo fica marcado como cancelado, para manter o histórico.

5. **Cancelamento**: o evento continua visível na agenda com "CANCELADO" no início do título e o convite é retirado.

6. **Mensagens de amanhã** continua igual — nada é removido, a agenda só passa a ser preenchida por cima.

Se a integração estiver desligada, sem conta conectada ou o Google falhar, o agendamento no app é salvo normalmente: a falha só aparece como aviso, nunca bloqueia o serviço.

## Detalhes técnicos

- **Conector**: é preciso ligar o conector `google_calendar` (mesma conta do Docs/Drive), que injeta `GOOGLE_CALENDAR_API_KEY`. O card de conexão aparece no chat durante a implementação.
- **Migration** (aditiva): `technicians.email text`, `visits.google_event_id text`, `budget_visits.google_event_id text`.
- **`src/lib/google-calendar.server.ts`**: mesmo padrão de `google-docs.server.ts` (base `https://connector-gateway.lovable.dev/google_calendar/calendar/v3`, headers `Authorization: Bearer LOVABLE_API_KEY` + `X-Connection-Api-Key`, tradução de 401/403/404 para mensagens em português). Funções: `createEvent`, `updateEvent`, `cancelEvent` (renomeia com prefixo CANCELADO e limpa attendees), `testCalendarConnection`.
- **`src/lib/calendar.server.ts`**: monta o payload a partir da visita (busca visita + OS + cliente + técnico com o cliente service-role), lê as configurações em `app_settings` (`gcal_enabled`, `gcal_calendar_id`), grava `google_event_id` e sempre retorna erro silencioso (log + `{ ok: false }`).
- **`src/lib/calendar.functions.ts`**: server functions com `requireSupabaseAuth` — `syncVisitEvent({ visitId, kind })`, `cancelVisitEvent({ visitId, kind })`, `getCalendarSettings`, `saveCalendarSettings`, `testCalendarIntegration`.
- **Pontos de chamada** (efeito colateral após o salvamento, sem `await` bloqueante da UI): criação/edição de visita em `src/lib/os.ts` e `src/lib/budget-visits.ts`, fluxo de reagendamento (novo evento + cancelamento do anterior) e mudança de status para Cancelado.
- **Configurações**: novo bloco Google Agenda em `src/routes/_authenticated/configuracoes.tsx` (visível para admin) e campo e-mail na edição de técnicos.
- `sendUpdates: "all"` no create/update para o Google disparar o convite ao técnico.
