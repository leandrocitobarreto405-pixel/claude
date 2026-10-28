import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import {
  EQUIPE_SEM_NOME,
  desempenhoPorPessoa,
  primeirasRespostas,
  respostasPeloNexaPorSemana,
  type DesempenhoPessoa,
  type MensagemConversa,
  type SemanaRespostas,
} from "@/lib/desempenho-vendas";

// Desempenho por pessoa do Dashboard (taxa de fechamento e 1ª resposta). Só leitura, com o
// cliente da própria pessoa (RLS da empresa ativa).

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const inicioSP = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();
const fimSP = (d: string) =>
  new Date(new Date(`${d}T00:00:00-03:00`).getTime() + 86_400_000).toISOString();

export const desempenhoVendasFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { de: string; ate: string }) => {
    if (!DATA.test(input.de) || !DATA.test(input.ate) || input.ate < input.de)
      throw new Error("Período inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<DesempenhoPessoa[]> => {
    const db = context.supabase;
    const de = inicioSP(data.de);
    const ate = fimSP(data.ate);
    const [{ data: vendedoras }, { data: orcamentos }, { data: conversas }] = await Promise.all([
      db.from("salespeople").select("name, user_id, eh_ia"),
      db
        .from("quotes")
        .select("created_by, generated_work_order_id")
        .gte("created_at", de)
        .lt("created_at", ate)
        .limit(5000),
      db.from("conversas").select("id").gte("created_at", de).lt("created_at", ate).limit(3000),
    ]);
    const alice = (vendedoras ?? []).find((v) => v.eh_ia)?.name ?? "Alice (IA)";
    const nomeDoUsuario = new Map(
      (vendedoras ?? []).filter((v) => v.user_id).map((v) => [v.user_id as string, v.name]),
    );
    const autorDoUsuario = (u: string | null) =>
      u ? (nomeDoUsuario.get(u) ?? EQUIPE_SEM_NOME) : alice;

    const ids = (conversas ?? []).map((c) => c.id);
    const msgs: MensagemConversa[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data: lote } = await db
        .from("whatsapp_messages")
        .select("conversa_id, direction, remetente_tipo, enviada_por, message_timestamp")
        .in("conversa_id", ids.slice(i, i + 150))
        .eq("privada", false)
        .order("message_timestamp")
        .limit(10000);
      for (const m of lote ?? []) {
        if (!m.conversa_id) continue;
        const recebida = m.direction === "Recebida";
        msgs.push({
          conversa: m.conversa_id,
          recebida,
          autor: recebida
            ? null
            : m.remetente_tipo === "agent_bot"
              ? alice
              : m.enviada_por
                ? (nomeDoUsuario.get(m.enviada_por) ?? EQUIPE_SEM_NOME)
                : EQUIPE_SEM_NOME,
          quando: m.message_timestamp,
        });
      }
    }

    return desempenhoPorPessoa(
      (orcamentos ?? []).map((q) => ({
        autor: autorDoUsuario(q.created_by),
        virouOs: Boolean(q.generated_work_order_id),
      })),
      primeirasRespostas(msgs),
    );
  });

// % das respostas da equipe feitas pelo Nexa, nas últimas 8 semanas (para acompanhar a troca do
// celular e do Chatwoot pelas Conversas do Nexa). Mensagens de campanha do Marketing não contam.
export const respostasPeloNexaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SemanaRespostas[]> => {
    const db = context.supabase;
    const agora = new Date();
    const desde = new Date(agora.getTime() - 8 * 7 * 86_400_000).toISOString();
    const [{ data: msgs }, { data: campanhas }] = await Promise.all([
      db
        .from("whatsapp_messages")
        .select("message_timestamp, origem, chatwoot_message_id")
        .eq("direction", "Enviada")
        .eq("remetente_tipo", "user")
        .eq("privada", false)
        .gte("message_timestamp", desde)
        .limit(20000),
      db
        .from("mkt_envios")
        .select("chatwoot_message_id")
        .gte("created_at", desde)
        .not("chatwoot_message_id", "is", null)
        .limit(20000),
    ]);
    const deCampanha = new Set((campanhas ?? []).map((e) => String(e.chatwoot_message_id)));
    return respostasPeloNexaPorSemana(
      (msgs ?? [])
        .filter(
          (m) => m.chatwoot_message_id == null || !deCampanha.has(String(m.chatwoot_message_id)),
        )
        .map((m) => ({ quando: m.message_timestamp, peloNexa: m.origem === "nexa" })),
      agora,
    );
  });
