/**
 * Fila da Alice. As tarefas nascem no banco (gatilho nas mensagens) e são entregues ao
 * processador (/api/public/hooks/alice-processar) na hora certa:
 *  - em produção, pelo Google Cloud Tasks (ALICE_FILA = projects/…/locations/…/queues/…,
 *    ALICE_URL_BASE = endereço público do app), autenticado com NEXA_TAREFAS_SEGREDO;
 *  - sem Cloud Tasks (desenvolvimento), por um temporizador no próprio servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenDaContaDeServico as tokenDoGoogle } from "@/lib/google-cloud.server";

type Admin = SupabaseClient;

async function criarTarefaNoCloudTasks(
  fila: string,
  urlBase: string,
  tarefaId: string,
  quando: Date,
) {
  const segredo = process.env["NEXA_TAREFAS_SEGREDO"];
  if (!segredo) throw new Error("NEXA_TAREFAS_SEGREDO não configurado");
  const corpo = Buffer.from(JSON.stringify({ tarefa_id: tarefaId })).toString("base64");
  const res = await fetch(`https://cloudtasks.googleapis.com/v2/${fila}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await tokenDoGoogle()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: {
        scheduleTime: quando.toISOString(),
        httpRequest: {
          httpMethod: "POST",
          url: `${urlBase.replace(/\/+$/, "")}/api/public/hooks/alice-processar`,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${segredo}` },
          body: corpo,
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok)
    throw new Error(`Cloud Tasks respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Entrega as tarefas pendentes ainda não enfileiradas. Nunca lança erro (o webhook não pode falhar). */
export async function enfileirarPendentes(admin: Admin, limite = 50): Promise<number> {
  const { data: tarefas, error } = await admin
    .from("ia_tarefas")
    .select("id, executar_apos")
    .eq("situacao", "pendente")
    .eq("enfileirada", false)
    .order("executar_apos")
    .limit(limite);
  if (error || !tarefas?.length) return 0;

  const fila = process.env["ALICE_FILA"];
  const urlBase = process.env["ALICE_URL_BASE"];
  let n = 0;
  for (const t of tarefas as Array<{ id: string; executar_apos: string }>) {
    const quando = new Date(t.executar_apos);
    try {
      if (fila && urlBase) {
        await criarTarefaNoCloudTasks(fila, urlBase, t.id, quando);
      } else {
        const espera = Math.max(0, quando.getTime() - Date.now()) + 250;
        setTimeout(() => {
          void import("./motor.server").then(({ processarTarefa }) =>
            processarTarefa(t.id).catch((e) => console.error("Alice: falha ao processar", e)),
          );
        }, espera);
      }
      // Só marca se a tarefa não foi adiada por uma mensagem nova enquanto isso.
      await admin
        .from("ia_tarefas")
        .update({ enfileirada: true })
        .eq("id", t.id)
        .eq("executar_apos", t.executar_apos);
      n++;
    } catch (e) {
      console.error("Alice: falha ao enfileirar a tarefa", t.id, e);
    }
  }
  return n;
}

/** Atraso a partir do qual uma tarefa já entregue é considerada perdida pela fila. */
const ATRASO_PERDIDA_MS = 3 * 60_000;

/**
 * Varredura (Cloud Scheduler): entrega o que ficou de fora e processa aqui mesmo as tarefas
 * atrasadas. A reserva no banco garante que nenhuma tarefa é feita duas vezes.
 */
export async function varrerFila(): Promise<{ entregues: number; atrasadas: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as Admin;
  const entregues = await enfileirarPendentes(admin);
  const { data: atrasadas } = await admin
    .from("ia_tarefas")
    .select("id")
    .eq("situacao", "pendente")
    .eq("enfileirada", true)
    .lt("executar_apos", new Date(Date.now() - ATRASO_PERDIDA_MS).toISOString())
    .order("executar_apos")
    .limit(20);
  const { processarTarefa } = await import("./motor.server");
  for (const t of (atrasadas ?? []) as Array<{ id: string }>) {
    await processarTarefa(t.id).catch((e) => console.error("Alice: falha na varredura", t.id, e));
  }
  return { entregues, atrasadas: atrasadas?.length ?? 0 };
}
