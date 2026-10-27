import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GripVertical, PlusCircle, Trash2 } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/ui/numeric-input";
import {
  excluirItemPreco,
  itemPrecoEmUso,
  reordenarItensPreco,
  saveItemPreco,
  setItemPrecoAtivo,
  useParceiros,
  useTabelaPrecos,
  CATEGORIA_LABEL,
  type ItemPreco,
} from "@/lib/precos";
import type { Categoria } from "@/lib/orcamento-regras";
import { custoImperIgnorado } from "@/lib/terceirizados";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/erros";

const CLASSE_SELECT =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring sm:h-9";

function SelectCategoria({
  value,
  onChange,
  id,
}: {
  value: Categoria;
  onChange: (c: Categoria) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Categoria)}
      className={CLASSE_SELECT}
      aria-label="Categoria"
    >
      {(Object.keys(CATEGORIA_LABEL) as Categoria[]).map((c) => (
        <option key={c} value={c}>
          {CATEGORIA_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

function Linha({
  item,
  parceiros,
  onSalvar,
  onExcluir,
}: {
  item: ItemPreco;
  parceiros: { id: string; name: string }[];
  onSalvar: (id: string, campos: Partial<ItemPreco>) => Promise<void>;
  onExcluir: (item: ItemPreco) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [hig, setHig] = useState(Number(item.preco_higienizacao ?? 0));
  const [imp, setImp] = useState<number>(Number(item.preco_impermeabilizacao ?? 0));
  const [adic, setAdic] = useState<number>(Number(item.preco_adicional ?? 0));
  const [nome, setNome] = useState(item.nome);
  const [custo, setCusto] = useState<number>(Number(item.custo_parceiro ?? 0));
  const [custoImp, setCustoImp] = useState<number>(
    Number(item.custo_parceiro_impermeabilizacao ?? 0),
  );

  useEffect(() => {
    setHig(Number(item.preco_higienizacao ?? 0));
    setImp(Number(item.preco_impermeabilizacao ?? 0));
    setAdic(Number(item.preco_adicional ?? 0));
    setNome(item.nome);
    setCusto(Number(item.custo_parceiro ?? 0));
    setCustoImp(Number(item.custo_parceiro_impermeabilizacao ?? 0));
  }, [item]);
  const unidade = item.categoria === "tapete" ? "por m²" : "por peça";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid grid-cols-1 items-center gap-2 rounded-xl border border-border/70 bg-card p-3 sm:grid-cols-[auto_1fr_8rem_8rem_8rem_8rem_auto_auto] ${
        isDragging ? "opacity-70 shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Reordenar ${item.nome}`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => {
          if (nome.trim() && nome !== item.nome) void onSalvar(item.id, { nome: nome.trim() });
        }}
        aria-label="Nome do item"
      />

      <div>
        <span className="text-xs text-muted-foreground sm:hidden">Categoria</span>
        <SelectCategoria
          value={item.categoria}
          onChange={(c) => void onSalvar(item.id, { categoria: c })}
        />
      </div>

      <div>
        <span className="text-xs text-muted-foreground sm:hidden">Higienização</span>
        <MoneyInput
          value={hig}
          onValueChange={setHig}
          onBlur={() => {
            if (hig !== Number(item.preco_higienizacao ?? 0)) {
              void onSalvar(item.id, { preco_higienizacao: hig });
            }
          }}
          aria-label="Preço de higienização"
        />
      </div>

      <div>
        <span className="text-xs text-muted-foreground sm:hidden">Impermeabilização</span>
        <MoneyInput
          value={imp}
          onValueChange={setImp}
          onBlur={() => {
            const atual = Number(item.preco_impermeabilizacao ?? 0);
            if (imp !== atual) {
              void onSalvar(item.id, { preco_impermeabilizacao: imp > 0 ? imp : null });
            }
          }}
          aria-label="Preço de impermeabilização"
        />
      </div>

      <div>
        <span className="text-xs text-muted-foreground sm:hidden">
          Adicional pós-fechamento (higienização)
        </span>
        <MoneyInput
          value={adic}
          onValueChange={setAdic}
          onBlur={() => {
            const atual = Number(item.preco_adicional ?? 0);
            if (adic !== atual) void onSalvar(item.id, { preco_adicional: adic > 0 ? adic : null });
          }}
          aria-label="Preço como adicional pós-fechamento"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={item.ativo}
          onCheckedChange={(v) => void onSalvar(item.id, { ativo: v })}
          aria-label="Item ativo"
        />
        <span className="text-xs text-muted-foreground">{item.ativo ? "Ativo" : "Inativo"}</span>
      </div>

      <Button variant="ghost" size="icon" onClick={() => onExcluir(item)} aria-label="Excluir item">
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      <div className="col-span-full flex flex-wrap items-end gap-3 border-t border-border/60 pt-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch
            checked={item.terceirizado}
            onCheckedChange={(v) => void onSalvar(item.id, { terceirizado: v })}
            aria-label="Serviço terceirizado"
          />
          Terceirizado
        </label>
        {item.terceirizado ? (
          <>
            <div className="w-36">
              <span className="text-xs text-muted-foreground">Custo do parceiro {unidade}</span>
              <MoneyInput
                value={custo}
                onValueChange={setCusto}
                onBlur={() => {
                  if (custo !== Number(item.custo_parceiro ?? 0)) {
                    void onSalvar(item.id, { custo_parceiro: custo > 0 ? custo : null });
                  }
                }}
                aria-label="Custo do parceiro"
              />
            </div>
            {item.preco_impermeabilizacao &&
            (item.categoria !== "tapete" || custoImperIgnorado(item)) ? (
              <div className="w-36">
                <span className="text-xs text-muted-foreground">Custo na imper. {unidade}</span>
                <MoneyInput
                  value={custoImp}
                  onValueChange={setCustoImp}
                  onBlur={() => {
                    if (custoImp !== Number(item.custo_parceiro_impermeabilizacao ?? 0)) {
                      void onSalvar(item.id, {
                        custo_parceiro_impermeabilizacao: custoImp > 0 ? custoImp : null,
                      });
                    }
                  }}
                  aria-label="Custo do parceiro na impermeabilização"
                />
              </div>
            ) : null}
            <div className="w-44">
              <span className="text-xs text-muted-foreground">Parceiro</span>
              <select
                value={item.parceiro_id ?? ""}
                onChange={(e) => void onSalvar(item.id, { parceiro_id: e.target.value || null })}
                className={CLASSE_SELECT}
                aria-label="Parceiro"
              >
                <option value="">Sem parceiro</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {!item.custo_parceiro ? (
              <span className="pb-3 text-xs text-muted-foreground">
                Sem custo preenchido: a OS avisa e pede o repasse.
              </span>
            ) : null}
            {custoImperIgnorado(item) ? (
              <span className="pb-3 text-xs text-atencao-foreground">
                Impermeabilização de tapete é feita pela empresa: este custo não é usado (sem
                repasse). Pode apagar.
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function TabelaPrecosConfig() {
  const query = useTabelaPrecos(false);
  const parceiros = useParceiros();
  const [ordem, setOrdem] = useState<ItemPreco[]>([]);
  const [novoNome, setNovoNome] = useState("");
  const [novoHig, setNovoHig] = useState(0);
  const [novoImp, setNovoImp] = useState(0);
  const [novaCategoria, setNovaCategoria] = useState<Categoria>("sofa");
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (query.data) setOrdem(query.data);
  }, [query.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function salvarCampos(id: string, campos: Partial<ItemPreco>) {
    const atual = ordem.find((i) => i.id === id);
    if (!atual) return;
    try {
      await saveItemPreco(
        {
          nome: (campos.nome ?? atual.nome).trim(),
          preco_higienizacao: Number(campos.preco_higienizacao ?? atual.preco_higienizacao ?? 0),
          preco_impermeabilizacao:
            campos.preco_impermeabilizacao !== undefined
              ? campos.preco_impermeabilizacao
              : atual.preco_impermeabilizacao,
          ativo: campos.ativo ?? atual.ativo,
          categoria: campos.categoria ?? atual.categoria,
          preco_adicional:
            campos.preco_adicional !== undefined ? campos.preco_adicional : atual.preco_adicional,
          terceirizado: campos.terceirizado ?? atual.terceirizado,
          custo_parceiro:
            campos.custo_parceiro !== undefined ? campos.custo_parceiro : atual.custo_parceiro,
          custo_parceiro_impermeabilizacao:
            campos.custo_parceiro_impermeabilizacao !== undefined
              ? campos.custo_parceiro_impermeabilizacao
              : atual.custo_parceiro_impermeabilizacao,
          parceiro_id: campos.parceiro_id !== undefined ? campos.parceiro_id : atual.parceiro_id,
        },
        id,
      );
      await query.refetch();
      toast.success("Tabela de preços atualizada.");
    } catch {
      toast.error("Não foi possível salvar essa alteração.");
      return;
    }
    if (
      campos.custo_parceiro !== undefined ||
      campos.custo_parceiro_impermeabilizacao !== undefined ||
      campos.parceiro_id !== undefined
    ) {
      await oferecerAtualizarOs(id);
    }
  }

  /** Custo ou parceiro novo: pergunta se atualiza as OS não concluídas (concluídas ficam). */
  async function oferecerAtualizarOs(id: string) {
    const { data, error } = await supabase.rpc("os_abertas_do_item", { _item: id });
    if (error) return;
    const abertas = data as { linhas?: number; os?: string[] } | null;
    const linhas = Number(abertas?.linhas ?? 0);
    if (!linhas) return;
    const lista = (abertas?.os ?? []).slice(0, 10).join(", ");
    if (
      !window.confirm(
        `${linhas === 1 ? "1 item" : `${linhas} itens`} em OS não concluídas usam este item (OS ${lista}).\n\n` +
          "Atualizar o repasse delas com o custo novo? As OS concluídas e os repasses editados à mão ficam como estão.",
      )
    )
      return;
    const r = await supabase.rpc("atualizar_repasse_os_abertas", { _item: id });
    if (r.error) toast.error(mensagemDeErro(r.error, "Não foi possível atualizar as OS."));
    else toast.success(`Repasse atualizado em ${r.data} ${r.data === 1 ? "item" : "itens"}.`);
  }

  async function excluir(item: ItemPreco) {
    try {
      if (await itemPrecoEmUso(item.id)) {
        await setItemPrecoAtivo(item.id, false);
        await query.refetch();
        toast.info(`"${item.nome}" já foi usado em orçamentos ou OS, então foi apenas desativado.`);
        return;
      }
      await excluirItemPreco(item.id);
      await query.refetch();
      toast.success("Item excluído.");
    } catch {
      toast.error("Não foi possível excluir esse item.");
    }
  }

  async function aoArrastar(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const de = ordem.findIndex((i) => i.id === active.id);
    const para = ordem.findIndex((i) => i.id === over.id);
    if (de < 0 || para < 0) return;
    const nova = arrayMove(ordem, de, para);
    setOrdem(nova);
    try {
      await reordenarItensPreco(nova.map((i) => i.id));
      await query.refetch();
    } catch {
      toast.error("Não foi possível salvar a nova ordem.");
    }
  }

  async function adicionar() {
    if (!novoNome.trim() || novoHig <= 0) {
      toast.error("Informe o nome e o preço de higienização.");
      return;
    }
    try {
      await saveItemPreco({
        nome: novoNome.trim(),
        preco_higienizacao: novoHig,
        preco_impermeabilizacao: novoImp > 0 ? novoImp : null,
        ativo: true,
        categoria: novaCategoria,
      });
      setNovoNome("");
      setNovoHig(0);
      setNovoImp(0);
      setAberto(false);
      await query.refetch();
      toast.success("Item adicionado à tabela.");
    } catch {
      toast.error("Não foi possível adicionar o item.");
    }
  }

  return (
    <section className="card-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tabela de preços</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Preços usados nos orçamentos. Deixe a impermeabilização em branco quando o serviço não é
            oferecido para o item. A categoria decide o desconto do item adicional e o pedido mínimo
            de cadeiras (Configurações → Orçamento). "Adicional" é o preço de higienização quando o
            item entra depois do fechamento (ex.: colchão): fixo e fora dos descontos.
            "Terceirizado": o cliente paga o preço cheio e o custo do parceiro vira repasse (conta a
            pagar ao concluir), fora do faturamento e das comissões. Arraste pela alça para mudar a
            ordem.
          </p>
        </div>
        <Button onClick={() => setAberto((v) => !v)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Adicionar item
        </Button>
      </div>

      {aberto ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-border p-4 sm:grid-cols-[1fr_8rem_9rem_9rem_auto]">
          <div>
            <Label htmlFor="novo-item">Item</Label>
            <Input id="novo-item" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nova-categoria">Categoria</Label>
            <SelectCategoria
              id="nova-categoria"
              value={novaCategoria}
              onChange={setNovaCategoria}
            />
          </div>
          <div>
            <Label>Higienização</Label>
            <MoneyInput value={novoHig} onValueChange={setNovoHig} />
          </div>
          <div>
            <Label>Impermeabilização</Label>
            <MoneyInput value={novoImp} onValueChange={setNovoImp} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => void adicionar()}>Salvar</Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 hidden gap-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[auto_1fr_8rem_8rem_8rem_8rem_auto_auto]">
        <span />
        <span>Item</span>
        <span>Categoria</span>
        <span>Higienização</span>
        <span>Impermeabilização</span>
        <span>Adicional</span>
        <span>Ativo</span>
        <span />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={(e) => void aoArrastar(e)}
      >
        <SortableContext items={ordem.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="mt-2 space-y-2">
            {ordem.map((item) => (
              <Linha
                key={item.id}
                item={item}
                parceiros={parceiros.data ?? []}
                onSalvar={salvarCampos}
                onExcluir={(i) => void excluir(i)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!ordem.length ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum item cadastrado ainda.</p>
      ) : null}
    </section>
  );
}
