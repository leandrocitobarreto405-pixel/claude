import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DecimalInput, IntegerInput, MoneyInput } from "@/components/ui/numeric-input";
import { brl } from "@/lib/format";
import { CATEGORIA_LABEL } from "@/lib/precos";
import { usePapel } from "@/lib/tenant";
import {
  CONFIG_PADRAO,
  useConfigOrcamento,
  useSalvarConfigOrcamento,
  type LinhaConfigOrcamento,
} from "@/lib/orcamento-config";
import { calcularVitrine, regrasDaLinha, type Categoria } from "@/lib/orcamento-regras";

const CLASSE_SELECT =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring";

function Bloco({
  titulo,
  descricao,
  ligado,
  onLigar,
  children,
  desabilitado,
}: {
  titulo: string;
  descricao: string;
  ligado?: boolean;
  onLigar?: (v: boolean) => void;
  children?: React.ReactNode;
  desabilitado: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{titulo}</p>
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
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
      {children && (ligado ?? true) ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{children}</div>
      ) : null}
    </div>
  );
}

/** Regras de preço do orçamento da empresa: todas desligadas por padrão. */
export function OrcamentoRegrasConfig() {
  const { linha, carregando, empresaId } = useConfigOrcamento();
  const salvar = useSalvarConfigOrcamento();
  const { papel } = usePapel();
  const admin = papel === "admin";
  const [f, setF] = useState<LinhaConfigOrcamento>(CONFIG_PADRAO);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setF(linha ? { ...CONFIG_PADRAO, ...linha } : CONFIG_PADRAO);
  }, [linha]);

  const set = <K extends keyof LinhaConfigOrcamento>(k: K, v: LinhaConfigOrcamento[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const num = (v: number | null) => (v === null ? 0 : Number(v));
  const nulo = (v: number) => (v > 0 ? v : null);

  const exemplo = useMemo(() => {
    const r = regrasDaLinha(f as unknown as Record<string, unknown>);
    return {
      novo: calcularVitrine(352, r.vitrine, true),
      antigo: calcularVitrine(352, r.vitrine, false),
    };
  }, [f]);

  async function gravar() {
    if (!empresaId) return;
    if (
      f.distancia_sem_acrescimo_km !== null &&
      f.distancia_limite_km !== null &&
      f.distancia_sem_acrescimo_km > f.distancia_limite_km
    ) {
      toast.error("A distância sem acréscimo precisa ser menor que o limite da área.");
      return;
    }
    setSalvando(true);
    try {
      await salvar(empresaId, f);
      toast.success("Regras do orçamento salvas.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível salvar as regras do orçamento.",
      );
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const bloqueado = !admin;

  return (
    <section className="card-surface space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">Regras do orçamento</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo desligado deixa o orçamento como sempre foi. A atendente pode alterar o preço de
          qualquer item; a mudança fica marcada como "editado", com o valor da tabela ao lado.
          {bloqueado ? " Só o administrador pode mudar estas regras." : ""}
        </p>
      </div>

      <Bloco
        titulo="Desconto no item adicional"
        descricao="O item mais caro fica com preço cheio; cada item adicional das categorias marcadas ganha o desconto. Dois itens iguais: o segundo também ganha. A atendente pode mudar onde o desconto vai."
        ligado={f.desconto_adicional_ligado}
        onLigar={(v) => set("desconto_adicional_ligado", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Desconto (%)</Label>
          <DecimalInput
            value={f.desconto_adicional_pct}
            onValueChange={(v) => set("desconto_adicional_pct", v)}
            disabled={bloqueado}
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs">Categorias com desconto automático</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {(Object.keys(CATEGORIA_LABEL) as Categoria[]).map((c) => {
              const marcado = f.desconto_categorias.includes(c);
              return (
                <label
                  key={c}
                  className="flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={marcado}
                    disabled={bloqueado}
                    onChange={(e) =>
                      set(
                        "desconto_categorias",
                        e.target.checked
                          ? [...f.desconto_categorias, c]
                          : f.desconto_categorias.filter((x) => x !== c),
                      )
                    }
                  />
                  {CATEGORIA_LABEL[c]}
                </label>
              );
            })}
          </div>
        </div>
      </Bloco>

      <Bloco
        titulo="Classe do estofado"
        descricao="Em cada item, a equipe escolhe A, B ou C (padrão B). Classe A tem acréscimo sobre a tabela; B e C ficam no preço da tabela."
        ligado={f.classe_ligada}
        onLigar={(v) => set("classe_ligada", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Acréscimo da classe A (%)</Label>
          <DecimalInput
            value={f.classe_a_pct}
            onValueChange={(v) => set("classe_a_pct", v)}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Acréscimos por item"
        descricao="Marcados em cada item e somados com a classe sobre a tabela (ex.: A + almofadas + encardido = +40%). O preço com acréscimo é arredondado para o real de cima."
        ligado={f.acrescimos_ligado}
        onLigar={(v) => set("acrescimos_ligado", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Almofadas soltas (%)</Label>
          <DecimalInput
            value={f.almofadas_soltas_pct}
            onValueChange={(v) => set("almofadas_soltas_pct", v)}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Muito encardido (%)</Label>
          <DecimalInput
            value={f.encardido_pct}
            onValueChange={(v) => set("encardido_pct", v)}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Pedido mínimo só de cadeiras"
        descricao="Quando o orçamento tem só cadeiras e fica abaixo deste valor, completa até o mínimo. Deixe 0 para não usar."
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Valor mínimo</Label>
          <MoneyInput
            value={num(f.minimo_cadeiras)}
            onValueChange={(v) => set("minimo_cadeiras", nulo(v))}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Muito sujo"
        descricao="A atendente marca no orçamento; o acréscimo vale sobre o pedido inteiro."
        ligado={f.sujidade_ligado}
        onLigar={(v) => set("sujidade_ligado", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Acréscimo (%)</Label>
          <DecimalInput
            value={f.sujidade_pct}
            onValueChange={(v) => set("sujidade_pct", v)}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Distância"
        descricao="Só a ida, a partir da base do técnico mais próximo do cliente. Até a primeira faixa sem acréscimo; até o limite com acréscimo; acima do limite aparece “fora da área” para a equipe."
        ligado={f.distancia_ligado}
        onLigar={(v) => set("distancia_ligado", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Sem acréscimo até (km)</Label>
          <DecimalInput
            value={num(f.distancia_sem_acrescimo_km)}
            onValueChange={(v) => set("distancia_sem_acrescimo_km", nulo(v))}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Limite da área (km)</Label>
          <DecimalInput
            value={num(f.distancia_limite_km)}
            onValueChange={(v) => set("distancia_limite_km", nulo(v))}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Acréscimo (%)</Label>
          <DecimalInput
            value={f.distancia_pct}
            onValueChange={(v) => set("distancia_pct", v)}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="Vitrine com boas-vindas"
        descricao="A tabela guarda o valor no Pix (o mínimo). A mensagem mostra o valor dos estofados, o cartão com boas-vindas para cliente novo e o Pix, sem preço por item."
        ligado={f.vitrine_ligada}
        onLigar={(v) => set("vitrine_ligada", v)}
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Boas-vindas (%)</Label>
          <DecimalInput
            value={f.boas_vindas_pct}
            onValueChange={(v) => set("boas_vindas_pct", v)}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Desconto no Pix (%)</Label>
          <DecimalInput
            value={f.pix_pct}
            onValueChange={(v) => set("pix_pct", v)}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Arredondamento</Label>
          <select
            value={f.arredondamento}
            disabled={bloqueado}
            onChange={(e) =>
              set("arredondamento", e.target.value as LinhaConfigOrcamento["arredondamento"])
            }
            className={CLASSE_SELECT}
          >
            <option value="dezena_5">Dezena e múltiplo de 5</option>
            <option value="noventa">Final ,90</option>
          </select>
        </div>
        <p className="text-sm text-muted-foreground sm:col-span-3">
          Exemplo com tabela {brl(352)}: cliente novo {brl(exemplo.novo.vitrine)} →{" "}
          {brl(exemplo.novo.cartao)} no cartão · {brl(exemplo.novo.pix)} no Pix. Cliente antigo{" "}
          {brl(exemplo.antigo.cartao)} no cartão · {brl(exemplo.antigo.pix)} no Pix.
        </p>
      </Bloco>

      <Bloco
        titulo="Parcelas e validade"
        descricao="Usadas na mensagem do orçamento. Deixe 0 para usar as da configuração da Alice."
        desabilitado={bloqueado}
      >
        <div>
          <Label className="text-xs">Parcelas no cartão (máximo)</Label>
          <IntegerInput
            value={num(f.parcelas_max)}
            emptyValue={0}
            min={0}
            onValueChange={(v) => set("parcelas_max", v > 0 ? Math.min(v, 12) : null)}
            disabled={bloqueado}
          />
        </div>
        <div>
          <Label className="text-xs">Validade (dias)</Label>
          <IntegerInput
            value={num(f.validade_dias)}
            emptyValue={0}
            min={0}
            onValueChange={(v) => set("validade_dias", v > 0 ? Math.min(v, 60) : null)}
            disabled={bloqueado}
          />
        </div>
      </Bloco>

      {admin ? (
        <div className="flex justify-end">
          <Button onClick={() => void gravar()} disabled={salvando} className="min-h-11">
            {salvando ? "Salvando…" : "Salvar regras"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
