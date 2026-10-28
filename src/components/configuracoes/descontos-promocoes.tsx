// Configurações › Vendas › Descontos e promoções: tudo que dá desconto num lugar só (Pix, boas-
// vindas, cupons, promoção de dia vago e oferta do último follow-up). Só muda de lugar: os campos e
// as tabelas são os mesmos de antes, e cada bloco grava só os seus campos.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DecimalInput } from "@/components/ui/numeric-input";
import { ComRecurso } from "@/components/plano/recurso-bloqueado";
import { CuponsConfig } from "@/components/configuracoes/cupons";
import { PromocaoDiaVago } from "@/components/configuracoes/promocao-dia-vago";
import { brl } from "@/lib/format";
import { usePapel } from "@/lib/tenant";
import {
  CONFIG_PADRAO,
  useConfigOrcamento,
  useSalvarConfigOrcamento,
  type LinhaConfigOrcamento,
} from "@/lib/orcamento-config";
import { calcularVitrine, regrasDaLinha } from "@/lib/orcamento-regras";
import { salvarOfertaFollowup, situacaoAlice } from "@/lib/alice.functions";

const CLASSE_SELECT =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring";

function Item({
  titulo,
  ondeUsa,
  descricao,
  ligado,
  onLigar,
  desabilitado,
  children,
}: {
  titulo: string;
  ondeUsa: string;
  descricao?: string;
  ligado?: boolean;
  onLigar?: (v: boolean) => void;
  desabilitado?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{titulo}</p>
          <p className="mt-1 text-xs font-medium text-marca">Usado em: {ondeUsa}</p>
          {descricao ? <p className="mt-1 text-sm text-muted-foreground">{descricao}</p> : null}
        </div>
        {onLigar ? (
          <Switch
            checked={Boolean(ligado)}
            onCheckedChange={onLigar}
            disabled={desabilitado}
            aria-label={titulo}
          />
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

type CamposDesconto = Pick<
  LinhaConfigOrcamento,
  "pix_pct" | "vitrine_ligada" | "boas_vindas_pct" | "arredondamento"
>;

const camposDesconto = (l: LinhaConfigOrcamento): CamposDesconto => ({
  pix_pct: l.pix_pct,
  vitrine_ligada: l.vitrine_ligada,
  boas_vindas_pct: l.boas_vindas_pct,
  arredondamento: l.arredondamento,
});

/** Pix e boas-vindas (orcamento_configuracoes): grava só estes quatro campos. */
function PixEBoasVindas() {
  const { linha, carregando, empresaId } = useConfigOrcamento();
  const salvar = useSalvarConfigOrcamento();
  const { papel } = usePapel();
  const bloqueado = papel !== "admin";
  const [f, setF] = useState<CamposDesconto>(camposDesconto(CONFIG_PADRAO));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setF(camposDesconto(linha ? { ...CONFIG_PADRAO, ...linha } : CONFIG_PADRAO));
  }, [linha]);

  const set = <K extends keyof CamposDesconto>(k: K, v: CamposDesconto[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const exemplo = useMemo(() => {
    const r = regrasDaLinha({ ...CONFIG_PADRAO, ...linha, ...f } as unknown as Record<
      string,
      unknown
    >);
    return {
      novo: calcularVitrine(352, r.vitrine, true),
      antigo: calcularVitrine(352, r.vitrine, false),
    };
  }, [f, linha]);

  async function gravar() {
    if (!empresaId) return;
    setSalvando(true);
    try {
      await salvar(empresaId, { ...CONFIG_PADRAO, ...linha, ...f });
      toast.success("Descontos salvos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar os descontos.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="grid gap-4">
      <Item
        titulo="Desconto no Pix"
        ondeUsa="orçamento manual, Alice, PDF, boas-vindas e promoção de dia vago"
        descricao="Fonte única do Pix da empresa: o que estiver aqui vale em todo lugar. 0 = sem desconto no Pix."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Desconto no Pix (%)</Label>
            <DecimalInput
              value={f.pix_pct}
              onValueChange={(v) => set("pix_pct", v)}
              disabled={bloqueado}
            />
          </div>
        </div>
      </Item>

      <Item
        titulo="Boas-vindas para cliente novo"
        ondeUsa="mensagem do orçamento (Alice e orçamento manual)"
        descricao="A tabela guarda o valor no Pix (o mínimo). A mensagem mostra o valor dos estofados, o cartão com boas-vindas para cliente novo e o Pix, sem preço por item."
        ligado={f.vitrine_ligada}
        onLigar={(v) => set("vitrine_ligada", v)}
        desabilitado={bloqueado}
      >
        {f.vitrine_ligada ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Boas-vindas (%)</Label>
              <DecimalInput
                value={f.boas_vindas_pct}
                onValueChange={(v) => set("boas_vindas_pct", v)}
                disabled={bloqueado}
              />
            </div>
            <div>
              <Label className="text-xs">Arredondamento</Label>
              <select
                value={f.arredondamento}
                disabled={bloqueado}
                onChange={(e) =>
                  set("arredondamento", e.target.value as CamposDesconto["arredondamento"])
                }
                className={CLASSE_SELECT}
              >
                <option value="dezena_5">Dezena e múltiplo de 5</option>
                <option value="noventa">Final ,90</option>
                <option value="nenhum">Sem arredondamento</option>
              </select>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-3">
              Exemplo com tabela {brl(352)}: cliente novo {brl(exemplo.novo.vitrine)} →{" "}
              {brl(exemplo.novo.cartao)} no cartão · {brl(exemplo.novo.pix)} no Pix. Cliente antigo{" "}
              {brl(exemplo.antigo.cartao)} no cartão · {brl(exemplo.antigo.pix)} no Pix.
            </p>
          </div>
        ) : null}
      </Item>

      {bloqueado ? (
        <p className="text-sm text-muted-foreground">Só o administrador muda os descontos.</p>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => void gravar()} disabled={salvando} className="min-h-11">
            {salvando ? "Salvando…" : "Salvar Pix e boas-vindas"}
          </Button>
        </div>
      )}
    </div>
  );
}

const CHAVE_ALICE = ["alice_situacao"];

/** Oferta do último follow-up da Alice (ia_configuracoes): grava só os três campos dela. */
function OfertaUltimoFollowup() {
  const qc = useQueryClient();
  const situacaoFn = useServerFn(situacaoAlice);
  const salvarFn = useServerFn(salvarOfertaFollowup);
  const { papel } = usePapel();
  const bloqueado = papel !== "admin";
  const q = useQuery({ queryKey: CHAVE_ALICE, queryFn: () => situacaoFn({}) });
  const cfg = q.data?.config;
  const [ligada, setLigada] = useState(false);
  const [tipo, setTipo] = useState<"pct" | "reais">("pct");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    setLigada(cfg.oferta_followup_ligada);
    setTipo(cfg.oferta_followup_tipo);
    setValor(
      cfg.oferta_followup_valor === null ? "" : String(cfg.oferta_followup_valor).replace(".", ","),
    );
  }, [cfg]);

  async function gravar() {
    setSalvando(true);
    try {
      const v = valor.replace(",", ".").trim();
      await salvarFn({ data: { ligada, tipo, valor: v === "" ? null : Number(v) || 0 } });
      await qc.invalidateQueries({ queryKey: CHAVE_ALICE });
      toast.success("Oferta do último follow-up salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a oferta.");
    } finally {
      setSalvando(false);
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const nome = cfg?.nome || "Alice";

  return (
    <Item
      titulo="Oferta do último follow-up"
      ondeUsa={`${nome}, no último toque do follow-up (D2 16h), só depois do orçamento`}
      descricao="Vale até o dia seguinte. Só sai com valor preenchido e se a sequência de toques estiver ligada na configuração da Alice."
      ligado={ligada}
      onLigar={setLigada}
      desabilitado={bloqueado}
    >
      {ligada ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="oferta-tipo" className="text-xs">
              Desconto em
            </Label>
            <select
              id="oferta-tipo"
              className={CLASSE_SELECT}
              value={tipo}
              disabled={bloqueado}
              onChange={(e) => setTipo(e.target.value === "reais" ? "reais" : "pct")}
            >
              <option value="pct">% sobre o orçamento</option>
              <option value="reais">R$ sobre o orçamento</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="oferta-valor" className="text-xs">
              {tipo === "reais" ? "Valor (R$)" : "Percentual (%)"}
            </Label>
            <Input
              id="oferta-valor"
              inputMode="decimal"
              className="min-h-11"
              value={valor}
              disabled={bloqueado}
              onChange={(e) => setValor(e.target.value)}
              placeholder={tipo === "reais" ? "Ex.: 30" : "Ex.: 10"}
            />
          </div>
        </div>
      ) : null}
      {bloqueado ? null : (
        <div className="mt-3 flex justify-end">
          <Button onClick={() => void gravar()} disabled={salvando} className="min-h-11">
            {salvando ? "Salvando…" : "Salvar oferta"}
          </Button>
        </div>
      )}
    </Item>
  );
}

export function DescontosPromocoes() {
  return (
    <div className="grid gap-4">
      <PixEBoasVindas />
      <Item
        titulo="Cupons"
        ondeUsa="orçamento manual e Alice"
        descricao="Cada cupom liga e desliga sozinho (ativo). Não se apaga cupom: o que não vale mais fica inativo."
      >
        <ComRecurso recurso="cupons">
          <CuponsConfig />
        </ComRecurso>
      </Item>
      <Item
        titulo="Promoção de dia vago"
        ondeUsa="agenda com dia vago (cartão da promoção no Marketing e no Início)"
        descricao={`Nada é enviado sozinho: a chave só libera a promoção. Cada envio sai quando o admin toca em "Ativar", depois de conferir a lista, e com o "Envio ligado" do Marketing.`}
      >
        <PromocaoDiaVago />
      </Item>
      <ComRecurso recurso="alice">
        <OfertaUltimoFollowup />
      </ComRecurso>
    </div>
  );
}
