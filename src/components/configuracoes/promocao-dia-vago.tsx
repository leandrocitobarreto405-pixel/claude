// Promoção de dia vago (Configurações › Vendas › Descontos e promoções). Os campos são os mesmos
// de antes, quando ficavam em Agenda e técnicos; grava na mesma configuração da agenda.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, LinhaSwitch } from "@/components/nexa";
import {
  CHAVE_AGENDA_CONFIG,
  lerAgendaConfig,
  salvarAgendaConfig,
  type ConfigAgenda,
} from "@/lib/agenda-config.functions";
import { descreverFiltros } from "@/lib/listas";

export function PromocaoDiaVago() {
  const lerFn = useServerFn(lerAgendaConfig);
  const q = useQuery({ queryKey: CHAVE_AGENDA_CONFIG, queryFn: () => lerFn() });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (q.error || !q.data)
    return (
      <p className="text-sm text-muted-foreground">
        {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
      </p>
    );
  if (!q.data.admin)
    return <p className="text-sm text-muted-foreground">Só o administrador muda a promoção.</p>;
  return <FormPromocao config={q.data.config} />;
}

function FormPromocao({ config }: { config: ConfigAgenda }) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarAgendaConfig);
  const [c, setC] = useState(config);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setC(config), [config]);
  const muda = <K extends keyof ConfigAgenda>(k: K, v: ConfigAgenda[K]) => setC({ ...c, [k]: v });

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({ data: c });
      await qc.invalidateQueries({ queryKey: CHAVE_AGENDA_CONFIG });
      toast.success("Promoção salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campoNumero = (k: keyof ConfigAgenda, rotulo: string, sufixo: string, passo = 1) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`promo-${k}`}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`promo-${k}`}
          type="number"
          inputMode="decimal"
          step={passo}
          className="min-h-11"
          value={String(c[k])}
          onChange={(e) => muda(k, Number(e.target.value) as never)}
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
      </div>
    </div>
  );
  /** Campo que pode ficar em branco (sem limite). */
  const campoOpcional = (k: "margemMin" | "kmMax", rotulo: string, sufixo: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`promo-${k}`}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`promo-${k}`}
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="sem limite"
          className="min-h-11"
          value={c[k] === null ? "" : String(c[k])}
          onChange={(e) => muda(k, e.target.value === "" ? null : Number(e.target.value))}
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
      </div>
    </div>
  );
  const total = Number(c.descontoPct) + Number(c.pixPct);

  return (
    <div className="flex flex-col gap-4">
      <LinhaSwitch
        id="promo-ligada"
        titulo="Promoção liberada"
        descricao="Desligada, ninguém consegue ativar a promoção."
        checked={c.promoLigada}
        onCheckedChange={(v) => muda("promoLigada", v)}
      />
      <p className="rounded-botao bg-background p-3 text-sm">
        <span className="block font-semibold">Quem recebe</span>
        {descreverFiltros(c.promoListas)}
        <span className="block text-xs text-muted-foreground">
          Para mudar as listas, toque em “Mudar” no cartão da promoção (Marketing ou Início).
        </span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        {campoNumero("diasAFrente", "Olhar a agenda de", "dia(s) à frente")}
        {campoNumero("descontoPct", "Desconto da promoção", "%", 0.5)}
        <div className="space-y-1">
          <p className="text-sm font-medium">Desconto a mais no Pix</p>
          <p className="min-h-11 rounded-botao border border-border px-3 py-2 text-sm">
            {String(c.pixPct).replace(".", ",")}%
          </p>
          <p className="text-xs text-muted-foreground">É o Desconto no Pix, no alto desta seção.</p>
        </div>
      </div>
      {total > 25 ? (
        <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
          Promoção + Pix = {String(total).replace(".", ",")}%. O máximo é 25%.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Total com Pix: {String(total).replace(".", ",")}% (máximo 25%).
        </p>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-bold">Margem e distância</h3>
        <p className="text-sm text-muted-foreground">
          Quem fica abaixo da margem mínima ou passa da distância máxima aparece desmarcado na
          lista, com o motivo (dá para marcar de novo). Em branco = sem limite.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {campoOpcional("margemMin", "Margem mínima", "R$")}
        {campoOpcional("kmMax", "Distância máxima (só a ida)", "km")}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-bold">Custo médio de produto por serviço</h3>
        <p className="text-sm text-muted-foreground">
          Entra na margem estimada junto com o imposto e o deslocamento da ida (sem mão de obra).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {campoNumero("produtoHigienizacao", "Higienização", "R$", 0.5)}
        {campoNumero("produtoImpermeabilizacao", "Impermeabilização", "R$", 0.5)}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="promo-template">Modelo aprovado na Meta</Label>
        <Input
          id="promo-template"
          value={c.template}
          onChange={(e) => muda("template", e.target.value)}
        />
      </div>
      <Botao onClick={() => void salvar()} disabled={salvando || total > 25} className="self-start">
        {salvando ? "Salvando…" : "Salvar promoção"}
      </Botao>
    </div>
  );
}
