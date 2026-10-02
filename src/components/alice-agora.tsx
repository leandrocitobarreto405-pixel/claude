import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, ExternalLink, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/app-shell";
import { LeadLink } from "@/components/crm-ui";
import { conversasComAlice, pararAliceNaConversa } from "@/lib/alice.functions";
import { dateTimeBR } from "@/lib/format";

/**
 * Conversas que a Alice está atendendo agora, com um toque para a equipe assumir.
 * Sem conversas, mostra `vazio` (ou nada).
 */
export function AliceAgora({ vazio = null }: { vazio?: React.ReactNode } = {}) {
  const qc = useQueryClient();
  const listarFn = useServerFn(conversasComAlice);
  const pararFn = useServerFn(pararAliceNaConversa);
  const q = useQuery({
    queryKey: ["alice_agora"],
    queryFn: () => listarFn(),
    refetchInterval: 30_000,
  });
  const [parando, setParando] = useState<string | null>(null);

  const conversas = q.data ?? [];
  if (!conversas.length) return q.isLoading ? null : <>{vazio}</>;

  async function parar(id: string) {
    setParando(id);
    try {
      await pararFn({ data: { conversaId: id } });
      toast.success("Pronto: a Alice saiu da conversa. Agora é com a equipe.");
      await qc.invalidateQueries({ queryKey: ["alice_agora"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível tirar a Alice.");
    } finally {
      setParando(null);
    }
  }

  return (
    <div className="mb-4">
      <SectionCard
        icon={Bot}
        title={`Alice atendendo agora (${conversas.length})`}
        description="Para assumir: toque em Assumir, responda o cliente no WhatsApp do celular ou mande a nota privada #parar no Chatwoot."
        accent="navy"
      >
        <ul className="grid gap-3 text-sm">
          {conversas.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.leadId ? <LeadLink id={c.leadId}>{c.nome}</LeadLink> : c.nome}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {c.ultimaEm ? dateTimeBR(c.ultimaEm) : ""}
                  </span>
                </p>
                {c.ultimaMensagem ? (
                  <p className="truncate text-xs text-muted-foreground">{c.ultimaMensagem}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {c.url ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={c.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" /> Chatwoot
                    </a>
                  </Button>
                ) : null}
                <Button size="sm" disabled={parando !== null} onClick={() => void parar(c.id)}>
                  <Hand className="size-4" /> {parando === c.id ? "Assumindo..." : "Assumir"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
