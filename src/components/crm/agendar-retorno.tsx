import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneBR, scheduleFollowup, useCrmInvalidate } from "@/lib/crm";

/** Retorno manual para um lead aberto (fim da tela de Follow-ups). */
export function AgendarManual({ onDone }: { onDone: () => void }) {
  const [leadId, setLeadId] = useState("");
  const [quando, setQuando] = useState("");
  const invalidate = useCrmInvalidate();

  const abertos = useQuery({
    queryKey: ["crm_leads_abertos_simples"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, lead_name, phone")
        .eq("is_open", true)
        .order("last_interaction_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="m-lead">Lead</Label>
        <NativeSelect
          id="m-lead"
          value={leadId}
          onChange={setLeadId}
          options={(abertos.data ?? []).map((l) => ({
            value: l.id,
            label: `${l.lead_name || "Sem nome"} — ${formatPhoneBR(l.phone)}`,
          }))}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-quando">Data e hora</Label>
        <Input
          id="m-quando"
          type="datetime-local"
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
        />
      </div>
      <Button
        onClick={async () => {
          if (!leadId || !quando) {
            toast.error("Escolha o lead e a data do retorno.");
            return;
          }
          try {
            await scheduleFollowup(leadId, new Date(quando).toISOString());
            toast.success("Retorno agendado.");
            setLeadId("");
            setQuando("");
            invalidate();
            onDone();
          } catch {
            toast.error("Não foi possível agendar o retorno.");
          }
        }}
      >
        Agendar
      </Button>
    </div>
  );
}
