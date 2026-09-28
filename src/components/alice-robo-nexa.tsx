import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { criarRoboAlice } from "@/lib/alice.functions";

/** Nexa → Chatwoot: cria o robô "Alice" (agent bot) na conta, usado pelas empresas que ligarem a IA. */
export function RoboAliceNexa({
  conexaoId,
  temTokenApi,
}: {
  conexaoId: string;
  temTokenApi: boolean;
}) {
  const qc = useQueryClient();
  const criarFn = useServerFn(criarRoboAlice);
  const [ocupado, setOcupado] = useState(false);
  const robo = useQuery({
    queryKey: ["alice_robo", conexaoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chatwoot_conexoes")
        .select("alice_bot_id")
        .eq("id", conexaoId)
        .maybeSingle();
      if (error) throw error;
      return data?.alice_bot_id ?? null;
    },
  });

  async function criar() {
    setOcupado(true);
    try {
      await criarFn({ data: { conexaoId, origem: window.location.origin } });
      toast.success("Robô da Alice criado no Chatwoot.");
      await qc.invalidateQueries({ queryKey: ["alice_robo", conexaoId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o robô.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="card-surface mb-6 space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Robô da Alice (vendedora de IA)</h2>
      </div>
      {robo.data ? (
        <p className="text-sm">
          Criado no Chatwoot (robô nº {robo.data}). Cada empresa liga a Alice em Configurações →
          Alice (IA); o robô entra nas caixas de entrada dela.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Cria o robô “Alice” na conta do Chatwoot. Ele responde as conversas novas das empresas
            que ligarem a Alice. Usa o token de acesso da API cadastrado acima.
          </p>
          <Button onClick={() => void criar()} disabled={ocupado || !temTokenApi}>
            {ocupado ? "Criando…" : "Criar robô da Alice no Chatwoot"}
          </Button>
          {!temTokenApi ? (
            <p className="text-xs text-amber-900">Cadastre antes o token de acesso da API.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
