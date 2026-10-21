/**
 * Avisos do servidor no canal privado "empresa:<id>" do Realtime (o mesmo que o banco usa para
 * "mudou"): presença de colegas na conversa. Vai pela API de broadcast com a chave de serviço;
 * quem ouve é só quem a política em realtime.messages deixa (gente da empresa).
 */
import { canalDaEmpresa } from "@/lib/conversas-tempo-real";

export async function avisarCanalDaEmpresa(
  empresaId: string,
  evento: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const url = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
  const chave = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !chave) return false;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
        Authorization: `Bearer ${chave}`,
      },
      body: JSON.stringify({
        messages: [{ topic: canalDaEmpresa(empresaId), event: evento, payload, private: true }],
      }),
    });
    if (!r.ok) console.warn("Tempo real: broadcast recusado", r.status);
    return r.ok;
  } catch (e) {
    console.warn("Tempo real: broadcast falhou", e instanceof Error ? e.message : e);
    return false;
  }
}
