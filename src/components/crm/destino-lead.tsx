import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { dateBR, todayISO } from "@/lib/format";

type Motivo = {
  id: string;
  nome: string;
  pede_data: "desejada" | "retorno" | null;
  adiou: boolean;
};

/** Destino do lead em um clique: agendou, follow-up para uma data ou perdido com motivo. */
export function Destino({
  leadId,
  aoConcluir,
}: {
  leadId: string;
  aoConcluir: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState<"data" | "perdido" | null>(null);
  const [data, setData] = useState("");
  const [salvando, setSalvando] = useState(false);
  const motivos = useQuery({
    queryKey: ["crm_catalog", "motivos-sem-desfecho"],
    queryFn: async () => {
      const { data: m, error } = await supabase.rpc("motivos_sem_desfecho");
      if (error) throw error;
      return (m ?? []) as unknown as Motivo[];
    },
    enabled: aberto !== null,
  });
  const adiou = (motivos.data ?? []).find((m) => m.adiou);
  const perdas = (motivos.data ?? []).filter((m) => !m.adiou && m.pede_data !== "retorno");

  async function registrar(m: Motivo, d?: string) {
    setSalvando(true);
    const { error } = await supabase.rpc("registrar_desfecho", {
      _lead: leadId,
      _motivo: m.id,
      ...(d ? { _data: d } : {}),
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(m.adiou ? `Follow-up em ${dateBR(d)}.` : `Perdido: ${m.nome}`);
    await aoConcluir();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Destino">
        <span className="text-xs text-muted-foreground">Destino:</span>
        <Botao variante="neutro" asChild className="min-h-9 px-3 text-xs">
          <Link to="/nova-os" search={{ lead: leadId }}>
            Agendou
          </Link>
        </Botao>
        <Botao
          variante="neutro"
          className="min-h-9 px-3 text-xs"
          aria-pressed={aberto === "data"}
          onClick={() => setAberto(aberto === "data" ? null : "data")}
        >
          Follow-up em…
        </Botao>
        <Botao
          variante="neutro"
          className="min-h-9 px-3 text-xs"
          aria-pressed={aberto === "perdido"}
          onClick={() => setAberto(aberto === "perdido" ? null : "perdido")}
        >
          Perdido (motivo)
        </Botao>
      </div>
      {aberto === "data" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-card bg-muted p-3">
          <Input
            type="date"
            aria-label="Voltar a falar em"
            min={todayISO()}
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-44"
          />
          <Botao
            disabled={salvando || !data || !adiou}
            onClick={() => adiou && void registrar(adiou, data)}
          >
            Marcar follow-up
          </Botao>
        </div>
      ) : null}
      {aberto === "perdido" ? (
        <div className="flex flex-wrap gap-1.5 rounded-card bg-muted p-3">
          {perdas.map((m) => (
            <Botao
              key={m.id}
              variante="contorno"
              className="min-h-9 px-3 text-xs"
              disabled={salvando}
              onClick={() => void registrar(m)}
            >
              {m.nome}
            </Botao>
          ))}
        </div>
      ) : null}
    </div>
  );
}
