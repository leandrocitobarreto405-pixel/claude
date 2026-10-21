// Configurações › Mensagens › "Digitando… e lido no WhatsApp (Meta)": ao focar a barra de
// resposta ou começar a gravar, o cliente vê "digitando…" e a última mensagem dele fica lida.
// Ligado por padrão; só faz algo na empresa com conexão Meta.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LinhaSwitch } from "@/components/nexa";
import {
  lerDigitandoFn,
  salvarDigitandoFn,
  type TentativaDigitando,
} from "@/lib/caixa-equipe.functions";

export function DigitandoMeta() {
  const qc = useQueryClient();
  const ler = useServerFn(lerDigitandoFn);
  const salvar = useServerFn(salvarDigitandoFn);
  const q = useQuery({
    queryKey: ["config-digitando"],
    queryFn: () => ler(),
    refetchInterval: 15_000,
  });
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
      <UltimasTentativas tentativas={q.data.tentativas} />
    </div>
  );
}

const MOTIVOS: Record<string, string> = {
  desligado: "desligado aqui em Configurações",
  sem_meta: "empresa sem conexão com a Meta",
  sem_mensagem: "a conversa não tem mensagem do cliente com código da Meta",
  sem_numero: "a conta da Meta não devolveu o número",
  meta: "a Meta recusou",
};

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** As últimas tentativas, com a resposta da Meta: é por aqui que se confere um teste. */
function UltimasTentativas({ tentativas }: { tentativas: TentativaDigitando[] }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-semibold">Últimas tentativas</p>
      {tentativas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ainda. Toque na barra de resposta de uma conversa e volte aqui.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {tentativas.slice(0, 8).map((t) => (
            <li
              key={`${t.em}-${t.conversaId}`}
              className="min-w-0 rounded-botao border border-border bg-card px-3 py-2 text-xs"
            >
              <span className="font-semibold">{hora(t.em)}</span>{" "}
              {t.ok ? (
                <span className="font-semibold text-marca">Meta aceitou</span>
              ) : (
                <span className="text-problema-foreground">
                  não foi: {MOTIVOS[t.motivo ?? ""] ?? t.motivo}
                </span>
              )}
              {t.resposta ? (
                <span className="mt-0.5 block break-all text-muted-foreground">
                  Resposta: {t.resposta}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
