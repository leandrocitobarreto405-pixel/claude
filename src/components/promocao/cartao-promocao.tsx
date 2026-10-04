import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Botao, Chip, Switch } from "@/components/nexa";
import { EscolherListasPromocao } from "@/components/promocao/listas-promocao";
import { salvarPromocaoRapidaFn } from "@/lib/agenda-config.functions";
import { resumoPromocaoFn } from "@/lib/promocao.functions";
import { CHAVE_RESUMO_PROMOCAO, CHAVE_SITUACAO_PROMOCAO } from "@/lib/promocao";
import { descreverFiltros, type Filtros } from "@/lib/listas";
import { addDaysISO, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

function rotuloDoDia(data: string) {
  if (data === addDaysISO(todayISO(), 1)) return "Amanhã";
  const d = new Date(`${data}T12:00:00`);
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Promoção de dia vago: horários livres, chave que libera a promoção, listas de quem recebe e
 * "X na lista, Y podem receber agora". A chave só libera: cada envio ainda depende de "Ativar".
 * `faixa`: versão em destaque do Início e da Agenda, que só aparece com horário vago.
 */
export function CartaoPromocao({ faixa = false }: { faixa?: boolean }) {
  const qc = useQueryClient();
  const fn = useServerFn(resumoPromocaoFn);
  const salvarFn = useServerFn(salvarPromocaoRapidaFn);
  const q = useQuery({ queryKey: CHAVE_RESUMO_PROMOCAO, queryFn: () => fn(), staleTime: 60_000 });
  const [listasAbertas, setListasAbertas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const r = q.data;
  if (!r) return null;
  const livres = r.horarios.livres;
  if (faixa && (!r.horarios.configurado || livres.length === 0)) return null;

  async function salvar(m: { ligada?: boolean; listas?: Filtros }) {
    setSalvando(true);
    try {
      await salvarFn({ data: m });
      await Promise.all([
        qc.invalidateQueries({ queryKey: CHAVE_RESUMO_PROMOCAO }),
        qc.invalidateQueries({ queryKey: CHAVE_SITUACAO_PROMOCAO }),
      ]);
      if (m.ligada !== undefined)
        toast.success(m.ligada ? "Promoção liberada." : "Promoção desligada.");
      else toast.success("Listas da promoção salvas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      throw e;
    } finally {
      setSalvando(false);
    }
  }

  const titulo = !r.horarios.configurado
    ? "Promoção de dia vago"
    : `${rotuloDoDia(r.horarios.data)}: ${
        livres.length === 0
          ? "nenhum horário vago"
          : `${livres.length} ${livres.length === 1 ? "horário livre" : "horários livres"}`
      }`;

  return (
    <section
      aria-label="Promoção de dia vago"
      className={cn(
        "flex flex-col gap-3 rounded-card p-4",
        faixa ? "bg-atencao text-atencao-foreground" : "border border-border bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <CalendarPlus
          className={cn("mt-0.5 size-5 shrink-0", faixa ? "" : "text-marca")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">{titulo}</p>
          {livres.length ? (
            <p className="text-sm">{livres.map((l) => `${l.hora} · ${l.tecnico}`).join(", ")}</p>
          ) : !r.horarios.configurado ? (
            <p className="text-sm text-muted-foreground">
              Cadastre os horários base dos técnicos em Agenda e promoção para saber o que está
              vago.
            </p>
          ) : null}
        </div>
      </div>

      {r.admin ? (
        <div className="flex min-h-11 items-center gap-3">
          <label htmlFor="promo-ligada" className="flex min-w-0 flex-1 cursor-pointer flex-col">
            <span className="text-[15px] font-bold">Promoção liberada</span>
            <span className="text-[13px] leading-snug opacity-80">
              Cada envio ainda precisa do seu toque em “Ativar”.
            </span>
          </label>
          <Switch
            id="promo-ligada"
            checked={r.ligada}
            disabled={salvando}
            onCheckedChange={(v) => void salvar({ ligada: v }).catch(() => undefined)}
          />
        </div>
      ) : (
        <Chip tom={r.ligada ? "sucesso" : "neutro"} className="self-start">
          {r.ligada ? "Promoção liberada" : "Promoção desligada"}
        </Chip>
      )}

      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">{descreverFiltros(r.listas)}</span>
          <span className="block opacity-80">
            {r.total} na lista, {r.podem} {r.podem === 1 ? "pode" : "podem"} receber agora
          </span>
        </p>
        {r.admin ? (
          <Botao variante="contorno" disabled={salvando} onClick={() => setListasAbertas(true)}>
            Mudar
          </Botao>
        ) : null}
      </div>

      {livres.length ? (
        <Botao asChild variante="primario" className="sm:self-start">
          <Link to="/promocao">Preencher com promoção</Link>
        </Botao>
      ) : null}
      {r.admin && livres.length && !r.ligada ? (
        <p className="text-xs opacity-80">Ligue a chave para poder ativar a promoção.</p>
      ) : null}

      <EscolherListasPromocao
        aberto={listasAbertas}
        fechar={() => setListasAbertas(false)}
        listas={r.listas}
        salvar={(listas) => salvar({ listas })}
      />
    </section>
  );
}
