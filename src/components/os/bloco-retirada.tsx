import { useState } from "react";
import { Truck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Botao } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HORARIO_COMERCIAL, PRAZO_DIAS_UTEIS, diaCurto, type TipoRetirada } from "@/lib/retirada";
import type { InfoRetirada } from "@/lib/nova-os/retirada-visitas";

const NOME: Record<TipoRetirada, string> = { persiana: "persiana", tapete: "tapete" };

/** Horário do atendimento de retirada: o parceiro passa em horário comercial. */
export function HorarioComercial({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Horário</Label>
      <p
        id={id}
        className="flex min-h-11 items-center rounded-md border border-input bg-muted/50 px-3 text-sm"
      >
        {HORARIO_COMERCIAL}
      </p>
    </div>
  );
}

/**
 * Retirada de persiana/tapete no formulário da OS (05/11): aviso do atendimento misturado com o
 * botão para separar, ou a entrega prevista (calculada, editável) e o parceiro sugerido.
 */
export function BlocoRetirada({
  id,
  info,
  tecnicoId,
  tecnicos,
  aoMudarEntrega,
  aoUsarParceiro,
  aoSeparar,
}: {
  id: string;
  info: InfoRetirada | undefined;
  tecnicoId: string;
  tecnicos: Array<{ id: string; name: string }>;
  /** null volta ao cálculo. */
  aoMudarEntrega: (data: string | null) => void;
  aoUsarParceiro: (id: string) => void;
  aoSeparar: () => void;
}) {
  if (!info || info.situacao === "comum") return null;
  if (info.situacao === "misturado") {
    const tipos = info.tipos.map((t) => NOME[t]).join(" e ");
    return (
      <div
        role="note"
        className="flex flex-col gap-2 rounded-md bg-atencao px-3 py-2.5 text-xs font-medium text-atencao-foreground"
      >
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {tipos.charAt(0).toUpperCase() + tipos.slice(1)} é retirada pelo parceiro e lavada no
          galpão: fica num atendimento de retirada separado, sem ocupar o técnico.
        </p>
        <Botao variante="contorno" className="self-start" onClick={aoSeparar}>
          Separar {tipos} em atendimento de retirada
        </Botao>
      </div>
    );
  }
  const parceiro = info.parceiroId ? tecnicos.find((t) => t.id === info.parceiroId) : null;
  const editada = info.entrega !== info.entregaCalculada;
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border bg-secondary/60 px-3 py-2.5">
      <p className="flex items-start gap-2 text-xs font-semibold">
        <Truck className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
        Retirada de {NOME[info.tipo]} · {HORARIO_COMERCIAL} · não ocupa técnico próprio. A entrega
        aparece na agenda no dia previsto.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-entrega`}>Entrega prevista</Label>
        <Input
          id={`${id}-entrega`}
          type="date"
          value={info.entrega}
          onChange={(ev) => aoMudarEntrega(ev.target.value || null)}
        />
        <p className="text-xs text-muted-foreground">
          {editada && info.entregaCalculada ? (
            <>
              Data alterada pela equipe. Pelo prazo seria {diaCurto(info.entregaCalculada)}.{" "}
              <button
                type="button"
                className="font-semibold text-marca underline"
                onClick={() => aoMudarEntrega(null)}
              >
                Voltar ao prazo
              </button>
            </>
          ) : info.entrega ? (
            `${diaCurto(info.entrega)}: ${PRAZO_DIAS_UTEIS[info.tipo]} dias úteis depois da retirada (feriados sem trabalho não contam).`
          ) : null}
        </p>
      </div>
      {parceiro && parceiro.id !== tecnicoId ? (
        <Botao
          variante="contorno"
          className="self-start"
          onClick={() => aoUsarParceiro(parceiro.id)}
        >
          Usar {parceiro.name} (parceiro da {NOME[info.tipo]})
        </Botao>
      ) : null}
    </div>
  );
}

/** Tela da OS: retirada de persiana/tapete com a entrega prevista (editável) ou já feita. */
export function EntregaDaRetirada({
  visita,
  onSalvo,
}: {
  visita: {
    id: string;
    retirada?: string | null;
    entrega_prevista?: string | null;
    entrega_editada?: boolean | null;
    entrega_feita_em?: string | null;
  };
  onSalvo: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState(visita.entrega_prevista ?? "");
  const [salvando, setSalvando] = useState(false);
  if (visita.retirada !== "persiana" && visita.retirada !== "tapete") return null;
  const tipo = visita.retirada;

  async function salvar() {
    if (!data) return;
    setSalvando(true);
    const { error } = await supabase
      .from("visits")
      .update({ entrega_prevista: data, entrega_editada: true } as never)
      .eq("id", visita.id);
    setSalvando(false);
    if (error) return void toast.error("Não foi possível salvar a data da entrega.");
    toast.success("Entrega prevista atualizada.");
    setEditando(false);
    onSalvo();
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md bg-secondary/60 px-3 py-2 text-sm">
      <p className="flex items-start gap-2">
        <Truck className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
        <span>
          Retirada de {NOME[tipo]} · {HORARIO_COMERCIAL}.{" "}
          {visita.entrega_feita_em ? (
            <strong>
              Entregue em {visita.entrega_feita_em.slice(0, 10).split("-").reverse().join("/")}
            </strong>
          ) : visita.entrega_prevista ? (
            <>
              Entrega prevista: <strong>{diaCurto(visita.entrega_prevista)}</strong>
              {visita.entrega_editada ? " (data alterada pela equipe)" : ""}
            </>
          ) : (
            "Entrega sem data."
          )}
        </span>
      </p>
      {visita.entrega_feita_em ? null : editando ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Nova data da entrega"
            className="w-auto"
            value={data}
            onChange={(ev) => setData(ev.target.value)}
          />
          <Botao onClick={() => void salvar()} disabled={salvando || !data}>
            Salvar
          </Botao>
          <Botao variante="neutro" onClick={() => setEditando(false)}>
            Cancelar
          </Botao>
        </div>
      ) : (
        <Botao variante="contorno" className="self-start" onClick={() => setEditando(true)}>
          Alterar data da entrega
        </Botao>
      )}
    </div>
  );
}
