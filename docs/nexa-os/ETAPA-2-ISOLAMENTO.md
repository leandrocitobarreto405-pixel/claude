# Nexa OS — Etapa 2 (parte 1): isolamento entre empresas

Esta parte corrige os riscos R1 a R7 do relatório da Etapa 1 e cria a base de papéis e
configurações da Nexa. O Google (OAuth por empresa) e a publicação no Google Cloud ficam para a
parte 2.

## Como o isolamento funciona agora

```text
Navegador ──(JWT do usuário + cabeçalho x-empresa-id)──▶ Supabase (PostgREST)
                                                          │
                                  private.empresa_ativa() │ valida: o usuário tem vínculo
                                                          │ com essa empresa? (ou é nexa_admin)
                                                          ▼
                        RLS de TODAS as tabelas de negócio: empresa_id = empresa ativa
                        empresa_id das inserções = empresa ativa (sem valor fixo)
                        gatilhos: registro não aponta para registro de outra empresa
```

- **Empresa ativa**: escolhida no seletor do topo (quem tem mais de uma empresa) e guardada por
  aba. Um usuário com uma empresa só não precisa escolher. Cabeçalho de uma empresa sem vínculo é
  ignorado e a consulta não devolve nada.
- **Funções de servidor** (documento da OS, termo de garantia, Drive, Agenda, WhatsApp) usam o
  middleware `requireEmpresa`. Elas acessam o banco **como o usuário**, não com a chave de serviço,
  e por isso o RLS vale para elas também. As configurações do Google passaram a ser por empresa e
  só o administrador da empresa pode alterá-las (`requireAdminEmpresa`).
- **Rotinas sem usuário** (webhook de leads e tarefas mensais) informam a empresa explicitamente.
  As tarefas mensais rodam como um **usuário-robô da Nexa**, entrando empresa por empresa.
- **Cadastro**: só por convite. A Nexa cria as empresas na tela **Nexa → Empresas e comissões**.
  A empresa nova recebe uma cópia dos catálogos da empresa-modelo (Turbine Clean) e o contrato de
  comissão padrão.
- **Comissão**: contrato por empresa, com vigência (Turbine 3%, padrão 5%). A mudança de
  percentual cria uma nova vigência; na mesma data de início, corrige o percentual.
- O webhook direto da Meta foi **desativado** (decisão D2).
- Os textos com "Turbine Clean" fixo (nome da pasta no Drive, termo de garantia, títulos das
  páginas) passaram a usar o nome da empresa ou "Nexa OS".

## Testes

| Comando | O que verifica |
|---|---|
| `npm run test:db` | Recria um Postgres local, aplica as 32 migrações e roda `supabase/tests/010_isolamento_multiempresa.sql`: leitura e gravação entre empresas, cabeçalho forjado, referência cruzada, estoque, comissão, convites, perfis, chave de serviço sem empresa, cadastro sem convite |
| `npm run test:api` | Sobe o PostgREST (a API do Supabase) e testa por HTTP, com JWT e cabeçalho `x-empresa-id`, inclusive as consultas embutidas usadas pelo app |
| `npm run typecheck` / `npm run build` | Tipos e build |

Os testes de banco foram validados com **mutação**: ao remover cada proteção, o teste
correspondente falha.

Pré-requisito local: Postgres 16 em `/tmp:54329`. Os scripts aceitam `PGHOST`, `PGPORT` e
`PGUSER`.

## Configuração no Supabase (quando o projeto for criado)

1. Aplicar as migrações: `npx supabase link --project-ref <ref>` e `npx supabase db push`.
2. **Auth → Providers → Email**: manter o cadastro por e-mail. Quem se cadastra sem convite fica
   sem empresa e não vê nada. Opcional: desligar "Allow new users to sign up" e usar só convites
   pelo painel.
3. Criar o primeiro administrador da Nexa. Depois de ele criar a conta no app, rodar no SQL Editor:
   ```sql
   insert into public.plataforma_usuarios (user_id, papel)
   select id, 'nexa_admin' from auth.users where email = 'SEU-EMAIL@...';
   ```
4. Criar o **usuário-robô** das tarefas automáticas: em Auth → Users → Add user, informar e-mail e
   senha fortes e marcar como confirmado. Depois:
   ```sql
   insert into public.plataforma_usuarios (user_id, papel)
   select id, 'nexa_admin' from auth.users where email = 'robo@nexaperformance.com.br';
   ```
5. Vincular Maria e Carol às empresas: com a empresa aberta, **Usuários → Convidar**, papel
   "Atendente". A Turbine Clean já vem com Maria e Carol marcadas como atendentes da Nexa entre as
   vendedoras. Nas empresas novas, por enquanto a marcação (`salespeople.atendente_nexa`) é feita
   por SQL; a tela entra junto com a apuração de comissão (Etapa 5).

## Variáveis de ambiente do servidor

| Variável | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | App e usuário-robô |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook de leads, reprocessamento/simulação de WhatsApp (sempre com empresa explícita) |
| `NEXA_ROBO_EMAIL`, `NEXA_ROBO_SENHA` | Usuário-robô das tarefas mensais |
| `NEXA_TAREFAS_SEGREDO` | Segredo (32+ caracteres) exigido no cabeçalho `Authorization: Bearer …` de `/api/public/hooks/recurring-expenses` e `/monthly-mileage-closing` |

## Pendências conhecidas

- **Google (Drive/Docs/Agenda)** ainda usa o conector do Lovable (`LOVABLE_API_KEY` +
  `GOOGLE_*_API_KEY`), com uma conta Google só. As configurações já são por empresa. A troca por
  OAuth por empresa é a parte 2 desta etapa.
- **Resumo por IA do lead** depende do gateway do Lovable; fica inativo fora dele até a etapa de IA.
- **Permissões por papel dentro da empresa** (técnico × atendente × admin) ainda são aplicadas só
  nas telas; o banco garante o isolamento **entre empresas**. Restringir tabelas financeiras por
  papel no banco é um próximo passo.
- As telas novas (seletor de empresa, Nexa → Empresas) passaram por typecheck e build, mas **ainda
  não foram usadas num navegador** contra um Supabase real. Isso acontece assim que o projeto de
  desenvolvimento no Supabase existir.
- O agendamento das tarefas mensais (antes via pg_cron no Lovable) será feito pelo Cloud Scheduler
  na publicação.
