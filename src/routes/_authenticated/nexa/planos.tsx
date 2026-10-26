import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { brl, parseNumberBR } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import { TermosNexa } from "@/components/termos/termos-nexa";
import { CHAVE_PLANOS, RECURSOS_PLANO, usePlanos, type Plano } from "@/lib/planos";

export const Route = createFileRoute("/_authenticated/nexa/planos")({
  head: () => ({
    meta: [
      { title: "Planos — Nexa OS" },
      { name: "description", content: "Planos do Nexa OS: mensalidade, comissão e recursos." },
    ],
  }),
  component: PlanosNexa,
});

type Edicao = {
  plano: Plano;
  nome: string;
  descricao: string;
  preco: string;
  comissao: string;
  recursos: Record<string, boolean>;
  ativo: boolean;
  limite: string;
  publico: boolean;
};

function pct(n: number) {
  return `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
}

function PlanosNexa() {
  const qc = useQueryClient();
  const { data: ctx } = useContextoTenant();
  const planos = usePlanos(Boolean(ctx?.souNexa));
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvando, setSalvando] = useState(false);

  if (ctx && !ctx.souNexa) return <EmptyState title="Acesso restrito à Nexa" />;

  async function salvar() {
    if (!edicao) return;
    const preco = edicao.preco.trim() ? parseNumberBR(edicao.preco) : null;
    const comissao = parseNumberBR(edicao.comissao || "0");
    if (preco !== null && (!Number.isFinite(preco) || preco < 0)) {
      toast.error("Mensalidade inválida.");
      return;
    }
    if (!Number.isFinite(comissao) || comissao < 0 || comissao > 100) {
      toast.error("Comissão inválida.");
      return;
    }
    const limite = edicao.limite.trim() ? Math.round(Number(edicao.limite)) : null;
    if (limite !== null && (!Number.isFinite(limite) || limite < 1 || limite > 999)) {
      toast.error("Limite de usuários inválido (vazio = sem limite).");
      return;
    }
    if (edicao.nome.trim().length < 2) {
      toast.error("Informe o nome do plano.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from("planos")
      .update({
        nome: edicao.nome.trim(),
        descricao: edicao.descricao.trim() || null,
        preco_mensal: preco,
        comissao_pct: comissao,
        recursos: edicao.recursos,
        ativo: edicao.ativo,
        limite_usuarios: limite,
        publico: edicao.publico,
      })
      .eq("id", edicao.plano.id);
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Plano atualizado.");
    setEdicao(null);
    void qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
  }

  return (
    <>
      <PageHeader
        title="Planos"
        description="Mensalidade, comissão padrão e recursos de cada plano. A assinatura de cada empresa fica em Empresas e comissões."
      />
      {planos.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !planos.data?.length ? (
        <EmptyState title="Nenhum plano cadastrado" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {planos.data.map((p) => (
            <section key={p.id} className="card-surface space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {p.nome}{" "}
                    {!p.ativo ? <Badge className="ml-1 bg-secondary">inativo</Badge> : null}
                  </p>
                  {p.descricao ? (
                    <p className="text-sm text-muted-foreground">{p.descricao}</p>
                  ) : null}
                </div>
                <p className="shrink-0 font-semibold">
                  {p.preco_mensal === null ? "a definir" : `${brl(p.preco_mensal)}/mês`}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Comissão padrão da Nexa: {pct(p.comissao_pct)} ·{" "}
                {RECURSOS_PLANO.filter((r) => p.recursos[r.chave])
                  .map((r) => r.rotulo)
                  .join(", ") || "sem caixa de entrada, Alice e marketing"}
              </p>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  setEdicao({
                    plano: p,
                    nome: p.nome,
                    descricao: p.descricao ?? "",
                    preco: p.preco_mensal === null ? "" : String(p.preco_mensal).replace(".", ","),
                    comissao: String(p.comissao_pct).replace(".", ","),
                    recursos: { ...p.recursos },
                    ativo: p.ativo,
                    limite: p.limite_usuarios === null ? "" : String(p.limite_usuarios),
                    publico: p.publico,
                  })
                }
              >
                Editar
              </Button>
            </section>
          ))}
        </div>
      )}

      <Dialog open={Boolean(edicao)} onOpenChange={(aberto) => !aberto && setEdicao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plano {edicao?.plano.nome}</DialogTitle>
            <DialogDescription>
              A mensalidade vale para as assinaturas que usam o valor do plano. Mensalidade vazia
              fica "a definir". A comissão é o padrão das empresas novas neste plano; o contrato de
              cada empresa pode ter outro percentual.
            </DialogDescription>
          </DialogHeader>
          {edicao ? (
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label htmlFor="plano-nome">Nome</Label>
                <Input
                  id="plano-nome"
                  className="min-h-11"
                  value={edicao.nome}
                  onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plano-desc">Descrição</Label>
                <Input
                  id="plano-desc"
                  className="min-h-11"
                  value={edicao.descricao}
                  onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="plano-preco">Mensalidade (R$)</Label>
                  <Input
                    id="plano-preco"
                    className="min-h-11"
                    inputMode="decimal"
                    placeholder="a definir"
                    value={edicao.preco}
                    onChange={(e) => setEdicao({ ...edicao, preco: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plano-comissao">Comissão padrão (%)</Label>
                  <Input
                    id="plano-comissao"
                    className="min-h-11"
                    inputMode="decimal"
                    value={edicao.comissao}
                    onChange={(e) => setEdicao({ ...edicao, comissao: e.target.value })}
                  />
                </div>
              </div>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-medium">Recursos</legend>
                <p className="text-xs text-muted-foreground">
                  OS, orçamento com PDF, agenda, técnicos (agenda no WhatsApp), recebimentos,
                  despesas, notas fiscais e exportações estão em todos os planos.
                </p>
                {RECURSOS_PLANO.map((r) => (
                  <label key={r.chave} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={Boolean(edicao.recursos[r.chave])}
                      onChange={(e) =>
                        setEdicao({
                          ...edicao,
                          recursos: { ...edicao.recursos, [r.chave]: e.target.checked },
                        })
                      }
                    />
                    <span>
                      {r.rotulo}
                      <span className="block text-xs text-muted-foreground">{r.telas}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="plano-limite">Limite de usuários (admin e atendente)</Label>
                <Input
                  id="plano-limite"
                  className="min-h-11"
                  inputMode="numeric"
                  placeholder="sem limite"
                  value={edicao.limite}
                  onChange={(e) =>
                    setEdicao({ ...edicao, limite: e.target.value.replace(/\D/g, "") })
                  }
                />
                <p className="text-xs text-muted-foreground">Técnicos e equipe Nexa não contam.</p>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={edicao.publico}
                  onChange={(e) => setEdicao({ ...edicao, publico: e.target.checked })}
                />
                Aparece na tabela pública de preços
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={edicao.ativo}
                  onChange={(e) => setEdicao({ ...edicao, ativo: e.target.checked })}
                />
                Disponível para novas assinaturas
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setEdicao(null)}>
              Cancelar
            </Button>
            <Button className="min-h-11" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TermosNexa />
    </>
  );
}
