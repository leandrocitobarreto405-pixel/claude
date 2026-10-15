import { Link } from "@tanstack/react-router";
import { Botao, Card, Chip, NumeroGrande } from "@/components/nexa";
import { brl, monthLabelPT, remainingDaysInMonth } from "@/lib/format";
import type { ResumoPainel } from "@/lib/painel";

/** Meta do mês: realizado + agendado até o fim do mês contra a meta. */
export function MetaDoMes({
  r,
  carregando,
  podeDefinir,
}: {
  r: ResumoPainel | undefined;
  carregando: boolean;
  podeDefinir: boolean;
}) {
  const mes = r?.mes ?? new Date().toISOString().slice(0, 7);
  const nomeDoMes = monthLabelPT(mes).split(" de ")[0] ?? "";
  const meta = r?.meta.valor ?? null;
  const realizado = r?.realizado.noMes ?? 0;
  const agendado = r?.realizado.agendadoAteFimDoMes ?? 0;
  const pct = r?.meta.pct ?? null;
  const pctRealizado = meta ? Math.min(100, (realizado / meta) * 100) : 0;
  const pctAgendado = meta ? Math.min(100 - pctRealizado, (agendado / meta) * 100) : 0;
  const faltam = meta ? Math.max(0, meta - realizado - agendado) : 0;

  return (
    <Card aria-label="Meta do mês">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">Meta de {nomeDoMes}</span>
        {pct !== null ? (
          <Chip tom={pct >= 100 ? "sucesso" : "neutro"}>{Math.floor(pct)}%</Chip>
        ) : null}
      </div>
      <NumeroGrande
        valor={carregando ? "…" : brl(realizado + agendado)}
        complemento={meta ? `de ${brl(meta)}` : undefined}
      />
      {meta ? (
        <>
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, pct ?? 0))}
            aria-label="Meta do mês"
          >
            <div className="h-full bg-dado" style={{ width: `${pctRealizado}%` }} />
            <div className="h-full bg-dado/40" style={{ width: `${pctAgendado}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">
            Realizado {brl(realizado)} · agendado até o fim do mês {brl(agendado)}.{" "}
            {faltam > 0
              ? `Faltam ${brl(faltam)} em ${remainingDaysInMonth(mes)} dia(s).`
              : "Meta batida!"}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Nenhuma meta definida para este mês. Realizado {brl(realizado)} · agendado{" "}
            {brl(agendado)}.
          </p>
          {podeDefinir ? (
            <Botao asChild variante="contorno" className="self-start">
              <Link to="/configuracoes/empresa">Definir meta</Link>
            </Botao>
          ) : null}
        </>
      )}
    </Card>
  );
}
