// Configurações › Equipe › Notificações: quem recebe no celular, em qual aparelho e quando a última
// notificação chegou (recibo do aparelho). Só leitura; cada pessoa ativa no próprio celular.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing } from "lucide-react";
import { Chip } from "@/components/nexa";
import { notificacoesDaEquipeFn } from "@/lib/push.functions";
import { dateTimeBR } from "@/lib/format";

export function NotificacoesEquipe() {
  const lerFn = useServerFn(notificacoesDaEquipeFn);
  const { data, error } = useQuery({ queryKey: ["push", "equipe"], queryFn: () => lerFn() });
  if (error)
    return (
      <p className="text-sm text-problema-foreground">
        Não foi possível carregar as notificações da equipe.
      </p>
    );
  if (!data) return null;
  return (
    <section className="card-surface space-y-3 p-5" aria-label="Notificações no celular">
      <div className="flex items-center gap-2">
        <BellRing className="size-5 text-marca" aria-hidden />
        <h2 className="text-lg font-semibold">Notificações no celular</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Cada pessoa ativa no próprio celular (Avisos › Notificações). "Chegou" é quando o aparelho
        confirmou o recebimento.
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {data.map((p) => (
          <li key={p.userId} className="flex flex-col gap-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.nome}</span>
              <span className="text-muted-foreground">· {p.papel}</span>
              {!p.aparelhos.length ? <Chip tom="atencao">Sem notificação</Chip> : null}
            </div>
            {p.aparelhos.map((a, i) => {
              const confirmado = Boolean(a.confirmadoEm);
              const semConfirmar = !confirmado && a.enviosSemRecibo >= 3;
              return (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                >
                  <Chip tom={confirmado ? "sucesso" : semConfirmar ? "problema" : "neutro"}>
                    {confirmado ? "Ativa" : semConfirmar ? "Não confirma" : "Aguardando 1º recibo"}
                  </Chip>
                  <span>{a.aparelho || "Aparelho"}</span>
                  <span>· desde {dateTimeBR(a.desde)}</span>
                  <span>· último envio {a.ultimoEnvio ? dateTimeBR(a.ultimoEnvio) : "—"}</span>
                  <span>· chegou {a.confirmadoEm ? dateTimeBR(a.confirmadoEm) : "—"}</span>
                  {a.ultimoStatus ? <span>· status {a.ultimoStatus}</span> : null}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
