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
  useTabelaPrecos,
  type ItemPreco,
} from "@/lib/precos";

function Linha({
  item,
  onSalvar,
  onExcluir,
}: {
  item: ItemPreco;
  onSalvar: (id: string, campos: Partial<ItemPreco>) => Promise<void>;
  onExcluir: (item: ItemPreco) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [hig, setHig] = useState(Number(item.preco_higienizacao ?? 0));
  const [imp, setImp] = useState<number>(Number(item.preco_impermeabilizacao ?? 0));
  const [nome, setNome] = useState(item.nome);

  useEffect(() => {
    setHig(Number(item.preco_higienizacao ?? 0));
    setImp(Number(item.preco_impermeabilizacao ?? 0));
    setNome(item.nome);
  }, [item]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid grid-cols-1 items-center gap-2 rounded-xl border border-border/70 bg-card p-3 sm:grid-cols-[auto_1fr_9rem_9rem_auto_auto] ${
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
    </div>
  );
}

export function TabelaPrecosConfig() {
  const query = useTabelaPrecos(false);
  const [ordem, setOrdem] = useState<ItemPreco[]>([]);
  const [novoNome, setNovoNome] = useState("");
  const [novoHig, setNovoHig] = useState(0);
  const [novoImp, setNovoImp] = useState(0);
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
        },
        id,
      );
      await query.refetch();
      toast.success("Tabela de preços atualizada.");
    } catch {
      toast.error("Não foi possível salvar essa alteração.");
    }
  }

  async function excluir(item: ItemPreco) {
    try {
      if (await itemPrecoEmUso(item.id)) {
        await setItemPrecoAtivo(item.id, false);
        await query.refetch();
        toast.info(`"${item.nome}" já foi usado em orçamentos, então foi apenas desativado.`);
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
            oferecido para o item. Arraste pela alça para mudar a ordem.
          </p>
        </div>
        <Button onClick={() => setAberto((v) => !v)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Adicionar item
        </Button>
      </div>

      {aberto ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-border p-4 sm:grid-cols-[1fr_9rem_9rem_auto]">
          <div>
            <Label htmlFor="novo-item">Item</Label>
            <Input id="novo-item" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
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

      <div className="mt-4 hidden gap-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[auto_1fr_9rem_9rem_auto_auto]">
        <span />
        <span>Item</span>
        <span>Higienização</span>
        <span>Impermeabilização</span>
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
              <Linha key={item.id} item={item} onSalvar={salvarCampos} onExcluir={(i) => void excluir(i)} />
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
