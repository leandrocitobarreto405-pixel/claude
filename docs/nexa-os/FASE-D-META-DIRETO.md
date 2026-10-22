# Fase D: WhatsApp direto na Meta (pendências registradas)

Hoje o Chatwoot é o cano das mensagens (decisão em `DECISOES.md`). A única chamada direta à Meta
(Graph API, token do número da empresa) é o "digitando… e lido" da caixa de entrada, aprovada como
exceção em 21/10/2026. O que só fica completo quando as mensagens passarem direto pela Meta:

| Assunto                                                          | Situação hoje                                                                                                                                            | O que a fase D resolve                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticks de **entregue** e **lido** nas mensagens enviadas pelo app | O app mostra "✓ enviada" (e "falhou" quando o Chatwoot avisa). O Chatwoot não repassa os status de entrega e leitura da Meta.                            | Os webhooks de status da Meta (`sent`, `delivered`, `read`, `failed`) atualizam `whatsapp_messages.delivery_status` e o balão mostra ✓✓ entregue / lida. |
| "Gravando áudio…" para o cliente                                 | A API da Meta só tem o indicador de digitação; ao gravar, o cliente vê "digitando…". Testado em 21/10 (21:05 a 21:07): a Meta aceitou todas as chamadas. | Nada a fazer enquanto a Meta não oferecer "gravando".                                                                                                    |

Registrado em 22/10/2026 a pedido do dono do produto, depois do teste no iPhone.

## Agenda dos técnicos em grupo (Groups API da Meta) — anotado em 22/10/2026

Fora do escopo agora. A agenda do dia seguinte vai para o WhatsApp de cada técnico, uma mensagem
por técnico, pelo número da empresa (via Chatwoot). A opção de mandar num **grupo** fica para a
fase D:

- O grupo é criado pelo sistema pela Groups API da Meta; os técnicos entram por link de convite.
- Exige Conta comercial oficial (Official Business Account) no número da empresa.
- Não passa pelo Chatwoot: a mensagem vai direto pela Meta.
