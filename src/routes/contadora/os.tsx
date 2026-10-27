import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl, dateBR } from "@/lib/format";
import { ROTULO_STATUS } from "@/lib/contabil";
import { osRealizadasFn } from "@/lib/contadora.functions";
import { mesAtual, useEmpresasDaContadora } from "@/lib/contadora";

export const Route = createFileRoute("/contadora/os")({
  head: () => ({ meta: [{ title: "OS realizadas — Nexa OS" }] }),
  component: OsRealizadas,
});

const SITUACOES = [
  "Todas",
  "Sem pedido",
  "Pendente",
  "Solicitada",
  "Emitida",
  "Cancelada",
  "Não emitir",
];

function OsRealizadas() {
  const { data: ctx } = useEmpresasDaContadora();
  const empresaId = ctx?.ativa?.empresa_id ?? "";
  const [mes, setMes] = useState(mesAtual());
  const [situacao, setSituacao] = useState("Todas");
  const listar = useServerFn(osRealizadasFn);
  const { data, isLoading } = useQuery({
    queryKey: ["contadora", "os", empresaId, mes],
    enabled: Boolean(empresaId),
    queryFn: () => listar({ data: { empresaId, mes } }),
  });
  const lista = (data ?? []).filter((o) => situacao === "Todas" || o.nota === situacao);
  const total = lista.reduce((t, o) => t + Number(o.valor ?? 0), 0);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela titulo="OS realizadas" descricao="Serviços concluídos no mês. Só leitura." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="mes-os">Mês</Label>
          <Input
            id="mes-os"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sit-os">Nota</Label>
          <Select value={situacao} onValueChange={setSituacao}>
            <SelectTrigger id="sit-os" className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITUACOES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_STATUS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-sm text-muted-foreground">
          {lista.length} OS · <span className="font-semibold text-foreground">{brl(total)}</span>
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !lista.length ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhuma OS realizada neste filtro.</p>
        </Card>
      ) : (
        lista.map((o) => (
          <Card as="article" key={o.id} aria-label={`OS ${o.os}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">
                  OS {o.os} · {o.cliente ?? "Cliente sem nome"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Concluída em {dateBR(o.data)} ·{" "}
                  {o.documento ? `CPF/CNPJ ${o.documento}` : "CPF/CNPJ não informado"}
                  {o.email ? ` · ${o.email}` : ""}
                </p>
              </div>
              <Chip
                tom={
                  o.nota === "Emitida"
                    ? "sucesso"
                    : o.nota === "Cancelada"
                      ? "problema"
                      : o.nota === "Sem pedido" || o.nota === "Não emitir"
                        ? "neutro"
                        : "atencao"
                }
              >
                Nota: {ROTULO_STATUS[o.nota] ?? o.nota}
                {o.nota_numero ? ` nº ${o.nota_numero}` : ""}
              </Chip>
            </div>
            {o.endereco ? <p className="text-sm">{o.endereco}</p> : null}
            <ul className="space-y-1 text-sm">
              {(o.servicos ?? []).map((s, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {s.servico}
                    {s.descricao ? ` — ${s.descricao}` : ""}
                    {s.repasse_parceiro ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · parceiro, repasse {brl(Number(s.repasse_parceiro))}
                      </span>
                    ) : null}
                  </span>
                  {s.valor !== null ? (
                    <span className="tabular-nums">{brl(Number(s.valor))}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Valor da OS</dt>
                <dd className="font-semibold">{o.valor !== null ? brl(Number(o.valor)) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Recebido</dt>
                <dd>{brl(Number(o.recebido ?? 0))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Forma recebida</dt>
                <dd>{o.pagamento ?? "Nada recebido ainda"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Repasse a parceiro</dt>
                <dd>{o.repasse_total ? brl(Number(o.repasse_total)) : "—"}</dd>
              </div>
            </dl>
          </Card>
        ))
      )}
    </div>
  );
}
