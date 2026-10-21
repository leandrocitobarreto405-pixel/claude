// Configurações › Mensagens › "Digitando… e lido no WhatsApp (Meta)": ao focar a barra de
// resposta ou começar a gravar, o cliente vê "digitando…" e a última mensagem dele fica lida.
// Ligado por padrão; só faz algo na empresa com conexão Meta.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LinhaSwitch } from "@/components/nexa";
import { lerDigitandoFn, salvarDigitandoFn } from "@/lib/caixa-equipe.functions";

export function DigitandoMeta() {
  const qc = useQueryClient();
  const ler = useServerFn(lerDigitandoFn);
  const salvar = useServerFn(salvarDigitandoFn);
  const q = useQuery({ queryKey: ["config-digitando"], queryFn: () => ler() });
  if (!q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Quando alguém da equipe foca a barra de resposta ou começa a gravar um áudio, o cliente vê
        "digitando…" no WhatsApp e a última mensagem dele fica marcada como lida. Vai direto na
        Meta, com o token do número da empresa.
        {q.data.temMeta
          ? ""
          : " Esta empresa não tem conexão com a Meta; o interruptor não faz nada."}
      </p>
      <LinhaSwitch
        id="digitando-meta"
        titulo='"Digitando…" e lido no WhatsApp (Meta)'
        descricao="Ligado por padrão. Desligue se der problema."
        checked={q.data.ligado}
        onCheckedChange={(v) =>
          void salvar({ data: { ligado: v } })
            .then(() => {
              toast.success(v ? "Digitando… ligado." : "Digitando… desligado.");
              return qc.invalidateQueries({ queryKey: ["config-digitando"] });
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."))
        }
      />
    </div>
  );
}
