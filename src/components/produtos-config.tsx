import { useState } from "react";
import { toast } from "sonner";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { brl, parseNumberBR } from "@/lib/format";
import { saveSetting } from "@/lib/data";
import {
  PRODUTO_TIPO_LABEL,
  custoPorLitro,
  saveProduto,
  setProdutoAtivo,
  useControleInsumos,
  useProdutos,
  type Produto,
  type ProdutoTipo,
} from "@/lib/produtos";

/** Liga/desliga o controle de consumo de produtos por serviço. */
export function ControleInsumosCard() {
  const { ativo, refetch } = useControleInsumos();
  const [salvando, setSalvando] = useState(false);

  async function alternar(valor: boolean) {
    setSalvando(true);
    try {
      await saveSetting("controle_insumos_ativo", valor);
      await refetch();
      toast.success(
        valor
          ? "Controle de produtos ativado. O técnico informará a quantidade usada ao concluir o serviço."
          : "Controle de produtos desativado.",
      );
    } catch {
      toast.error("Não foi possível salvar essa opção.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="card-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Controlar consumo de produtos por serviço</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ativando esta opção, o técnico informará a quantidade de produto utilizada ao concluir
            cada serviço, permitindo calcular o custo real e a margem de lucro de cada OS.
          </p>
        </div>
        <Switch checked={ativo} disabled={salvando} onCheckedChange={alternar} />
      </div>
    </section>
  );
}

/** Cadastro de produtos, separado por tipo de serviço. */
export function ProdutosConfig() {
  const query = useProdutos(null, false);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);

  const produtos = query.data ?? [];
  const grupos: Array<{ tipo: ProdutoTipo; titulo: string }> = [
    { tipo: "higienizacao", titulo: "Produtos de Higienização" },
    { tipo: "impermeabilizacao", titulo: "Produtos de Impermeabilização" },
  ];

  function novo() {
    setEditando(null);
    setAberto(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Estes produtos aparecem para o técnico ao concluir o serviço, filtrados pelo tipo da OS.
        </p>
        <Button onClick={novo}>
          <PlusCircle className="mr-2 size-4" /> Adicionar produto
        </Button>
      </div>

      {aberto ? (
        <ProdutoForm
          produto={editando}
          onCancel={() => setAberto(false)}
          onSaved={() => {
            setAberto(false);
            void query.refetch();
          }}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {grupos.map((g) => {
          const lista = produtos.filter((p) => p.tipo_servico === g.tipo);
          return (
            <section key={g.tipo} className="card-surface overflow-x-auto p-4">
              <h2 className="mb-3 text-lg font-semibold">{g.titulo}</h2>
              {lista.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
              ) : (
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-secondary text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 font-medium">Embalagem</th>
                      <th className="px-3 py-2 font-medium">Preço pago</th>
                      <th className="px-3 py-2 font-medium">Custo por ml</th>
                      <th className="px-3 py-2 font-medium">Custo por litro</th>
                      <th className="px-3 py-2 font-medium">Ativo</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-2">{p.nome}</td>
                        <td className="px-3 py-2">
                          {Number(p.volume_embalagem_ml).toLocaleString("pt-BR")} ml
                        </td>
                        <td className="px-3 py-2">{brl(p.preco_pago)}</td>
                        <td className="px-3 py-2">
                          R${" "}
                          {Number(p.custo_por_ml ?? 0)
                            .toFixed(4)
                            .replace(".", ",")}
                        </td>
                        <td className="px-3 py-2">{brl(custoPorLitro(p))}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={p.ativo}
                            onChange={async (e) => {
                              try {
                                await setProdutoAtivo(p.id, e.target.checked);
                                void query.refetch();
                              } catch {
                                toast.error("Não foi possível alterar o produto.");
                              }
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditando(p);
                              setAberto(true);
                            }}
                          >
                            Editar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProdutoForm({
  produto,
  onCancel,
  onSaved,
}: {
  produto: Produto | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(produto?.nome ?? "");
  const [tipo, setTipo] = useState<ProdutoTipo>(produto?.tipo_servico ?? "higienizacao");
  const [volume, setVolume] = useState(
    produto ? String(produto.volume_embalagem_ml).replace(".", ",") : "",
  );
  const [unidade, setUnidade] = useState<"ml" | "L">("ml");
  const [preco, setPreco] = useState(produto ? String(produto.preco_pago).replace(".", ",") : "");
  const [ativo, setAtivo] = useState(produto?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  const volumeMl = parseNumberBR(volume) * (unidade === "L" ? 1000 : 1);
  const precoNum = parseNumberBR(preco);
  const porMl = volumeMl > 0 ? precoNum / volumeMl : 0;

  async function salvar() {
    if (nome.trim().length < 2) {
      toast.error("Informe o nome do produto.");
      return;
    }
    if (volumeMl <= 0) {
      toast.error("Informe o volume da embalagem.");
      return;
    }
    if (precoNum <= 0) {
      toast.error("Informe o preço pago.");
      return;
    }
    setSalvando(true);
    try {
      await saveProduto(
        {
          nome: nome.trim(),
          tipo_servico: tipo,
          volume_embalagem_ml: volumeMl,
          preco_pago: precoNum,
          estoque_atual_ml: produto?.estoque_atual_ml ?? volumeMl,
          ativo,
        },
        produto?.id ?? null,
      );
      toast.success(produto ? "Produto atualizado." : "Produto cadastrado.");
      onSaved();
    } catch {
      toast.error("Não foi possível salvar o produto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="card-surface space-y-4 p-5">
      <h3 className="text-base font-semibold">
        {produto ? `Editar ${produto.nome}` : "Novo produto"}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="produto-nome">Nome do produto</Label>
          <Input
            id="produto-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Alve Fresh"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="produto-tipo">Tipo de serviço</Label>
          <select
            id="produto-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as ProdutoTipo)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="higienizacao">{PRODUTO_TIPO_LABEL.higienizacao}</option>
            <option value="impermeabilizacao">{PRODUTO_TIPO_LABEL.impermeabilizacao}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="produto-volume">Volume da embalagem</Label>
          <div className="flex gap-2">
            <Input
              id="produto-volume"
              inputMode="decimal"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder="Ex.: 5"
            />
            <select
              aria-label="Unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as "ml" | "L")}
              className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="ml">ml</option>
              <option value="L">L</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="produto-preco">Preço pago (R$)</Label>
          <Input
            id="produto-preco"
            inputMode="decimal"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
        <p>
          Custo por ml: <strong>R$ {porMl.toFixed(4).replace(".", ",")}</strong> · Custo por litro:{" "}
          <strong>{brl(porMl * 1000)}</strong>
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="produto-ativo">Ativo</Label>
          <Switch id="produto-ativo" checked={ativo} onCheckedChange={setAtivo} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar produto"}
        </Button>
      </div>
    </section>
  );
}
