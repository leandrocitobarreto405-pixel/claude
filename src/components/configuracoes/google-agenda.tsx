// Seção de Configurações (veio da antiga tela de abas).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import {
  getCalendarSettings,
  saveCalendarSettings,
  testCalendarIntegration,
} from "@/lib/calendar.functions";
import { parseNumberBR } from "@/lib/format";

export function GoogleAgenda() {
  const getFn = useServerFn(getCalendarSettings);
  const saveFn = useServerFn(saveCalendarSettings);
  const testFn = useServerFn(testCalendarIntegration);

  const query = useQuery({ queryKey: ["google_calendar_settings"], queryFn: () => getFn({}) });

  const [ativa, setAtiva] = useState(false);
  const [agenda, setAgenda] = useState("primary");
  const [duracao, setDuracao] = useState("120");
  const [ocupado, setOcupado] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const d = query.data;
    if (!d) return;
    setAtiva(d.enabled);
    setAgenda(d.calendarId || "primary");
    setDuracao(String(d.durationMinutes ?? 120));
    setStatus(
      !d.hasConnection
        ? "Conta do Google não conectada"
        : d.enabled
          ? "Integração ativa"
          : "Integração desligada",
    );
  }, [query.data]);

  async function salvar() {
    setOcupado(true);
    setStatus("Salvando...");
    try {
      await saveFn({
        data: {
          enabled: ativa,
          calendarId: agenda.trim() || "primary",
          durationMinutes: Number(parseNumberBR(duracao)) || 120,
        },
      });
      toast.success("Configuração do Google Agenda salva.");
      await query.refetch();
    } catch (e) {
      setStatus("Erro ao salvar");
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setStatus("Testando conexão");
    try {
      const r = await testFn({});
      setStatus(`Conectado à agenda "${r.calendar}"`);
      toast.success(`Conexão validada com a agenda "${r.calendar}".`);
    } catch (e) {
      setStatus("Erro na conexão");
      toast.error(e instanceof Error ? e.message : "Falha ao testar a conexão.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="card-surface max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Google Agenda</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Com a integração ligada, cada serviço agendado (e cada visita de orçamento) cria um evento
        na agenda da empresa e convida o técnico pelo e-mail cadastrado em Equipe. Situação atual:{" "}
        <strong>{status || "Não configurada"}</strong>.
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gcal-id">Agenda usada</Label>
          <Input
            id="gcal-id"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="primary (agenda principal da conta)"
          />
          <p className="text-xs text-muted-foreground">
            Deixe "primary" para usar a agenda principal, ou cole o e-mail/ID de outra agenda.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gcal-dur">Duração do evento (minutos)</Label>
          <Input
            id="gcal-dur"
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
            className="w-[160px]"
          />
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Criar eventos automaticamente no Google Agenda
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={salvar} disabled={ocupado}>
          {ocupado ? "Aguarde..." : "Salvar integração"}
        </Button>
        <Button variant="outline" onClick={testar} disabled={ocupado}>
          Testar conexão
        </Button>
      </div>
    </section>
  );
}
