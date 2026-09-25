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
import { dateBR } from "@/lib/format";
import { CONTEXTO_TENANT_KEY, trocarEmpresa, useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/nexa/empresas")({
  head: () => ({
    meta: [
      { title: "Empresas e comissões — Nexa OS" },
      {
        name: "description",
        content: "Empresas clientes da Nexa, cadastro e percentual de comissão de cada uma.",
      },
    ],
  }),
  component: EmpresasNexa,
});

type Contrato = {
  id: string;
  empresa_id: string;
  percentual: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

type LinhaEmpresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  ativo: boolean;
  vigente: Contrato | null;
  historico: Contrato[];
};

const HOJE = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function pct(valor: number) {
  return `${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
}

function numero(texto: string): number | null {
  const n = Number(texto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function EmpresasNexa() {
  const queryClient = useQueryClient();
  const { data: ctx } = useContextoTenant();

  const padrao = useQuery({
    queryKey: ["nexa_comissao_padrao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes_plataforma")
        .select("valor")
        .eq("chave", "comissao_percentual_padrao")
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.valor) : 5;
    },
  });

  const empresas = useQuery({
    queryKey: ["nexa_empresas"],
    queryFn: async (): Promise<LinhaEmpresa[]> => {
      const [lista, contratos] = await Promise.all([
        supabase.from("empresas").select("id, nome, cnpj, telefone, ativo").order("nome"),
        supabase
          .from("contratos_comissao")
          .select("id, empresa_id, percentual, vigencia_inicio, vigencia_fim")
          .order("vigencia_inicio", { ascending: false }),
      ]);
      if (lista.error) throw lista.error;
      if (contratos.error) throw contratos.error;
      return (lista.data ?? []).map((e) => {
        const historico = (contratos.data ?? []).filter((c) => c.empresa_id === e.id);
        return { ...e, historico, vigente: historico.find((c) => c.vigencia_fim === null) ?? null };
      });
    },
  });

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [percentual, setPercentual] = useState("");
  const [criando, setCriando] = useState(false);

  const [editando, setEditando] = useState<LinhaEmpresa | null>(null);
  const [novoPct, setNovoPct] = useState("");
  const [inicio, setInicio] = useState(HOJE());
  const [salvando, setSalvando] = useState(false);

  const [padraoTexto, setPadraoTexto] = useState<string | null>(null);

  function atualizar() {
    void queryClient.invalidateQueries({ queryKey: ["nexa_empresas"] });
    void queryClient.invalidateQueries({ queryKey: CONTEXTO_TENANT_KEY });
  }

  async function criar() {
    if (nome.trim().length < 2) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    const pctInformado = percentual.trim() ? numero(percentual) : null;
    if (percentual.trim() && pctInformado === null) {
      toast.error("Percentual de comissão inválido.");
      return;
    }
    setCriando(true);
    const { error } = await supabase.rpc("provisionar_empresa", {
      _nome: nome.trim(),
      ...(cnpj.trim() ? { _cnpj: cnpj.trim() } : {}),
      ...(telefone.trim() ? { _telefone: telefone.trim() } : {}),
      ...(pctInformado !== null ? { _percentual_comissao: pctInformado } : {}),
    });
    setCriando(false);
    if (error) {
      toast.error(`Não foi possível cadastrar: ${error.message}`);
      return;
    }
    toast.success("Empresa cadastrada.");
    setNome("");
    setCnpj("");
    setTelefone("");
    setPercentual("");
    atualizar();
  }

  async function salvarComissao() {
    if (!editando) return;
    const valor = numero(novoPct);
    if (valor === null) {
      toast.error("Percentual inválido.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("definir_comissao_empresa", {
      _empresa_id: editando.id,
      _percentual: valor,
      _inicio: inicio,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível alterar: ${error.message}`);
      return;
    }
    toast.success("Comissão atualizada.");
    setEditando(null);
    atualizar();
  }

  async function salvarPadrao() {
    const valor = numero(padraoTexto ?? "");
    if (valor === null) {
      toast.error("Percentual inválido.");
      return;
    }
    const { error } = await supabase
      .from("configuracoes_plataforma")
      .update({ valor })
      .eq("chave", "comissao_percentual_padrao");
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Percentual padrão atualizado.");
    setPadraoTexto(null);
    void queryClient.invalidateQueries({ queryKey: ["nexa_comissao_padrao"] });
  }

  if (ctx && !ctx.souNexa) {
    return <EmptyState title="Acesso restrito à Nexa" />;
  }

  const lista = empresas.data ?? [];

  return (
    <>
      <PageHeader
        title="Empresas e comissões"
        description="Empresas clientes da Nexa. A comissão incide sobre o valor recebido de serviços realizados por atendentes da Nexa."
      />

      <section className="card-surface mb-6 space-y-4 p-5">
        <h2 className="text-lg font-semibold">Cadastrar empresa</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_140px_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="empresa-nome">Nome</Label>
            <Input id="empresa-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="empresa-cnpj">CNPJ</Label>
            <Input id="empresa-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="empresa-telefone">WhatsApp</Label>
            <Input
              id="empresa-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="empresa-pct">Comissão (%)</Label>
            <Input
              id="empresa-pct"
              inputMode="decimal"
              value={percentual}
              placeholder={padrao.data !== undefined ? String(padrao.data) : ""}
              onChange={(e) => setPercentual(e.target.value)}
            />
          </div>
          <Button onClick={criar} disabled={criando}>
            {criando ? "Cadastrando..." : "Cadastrar"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A empresa nova recebe uma cópia dos catálogos da empresa-modelo (status do CRM, origens,
          tipos de serviço, taxas e parâmetros). Depois, convide os usuários dela em “Usuários”, com
          a empresa aberta.
        </p>
      </section>

      <section className="card-surface mb-6 flex flex-wrap items-end gap-3 p-5">
        <div className="space-y-2">
          <Label htmlFor="pct-padrao">Comissão padrão para empresas novas (%)</Label>
          <Input
            id="pct-padrao"
            className="w-[160px]"
            inputMode="decimal"
            value={padraoTexto ?? (padrao.data !== undefined ? String(padrao.data) : "")}
            onChange={(e) => setPadraoTexto(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={salvarPadrao} disabled={padraoTexto === null}>
          Salvar
        </Button>
      </section>

      {lista.length === 0 ? (
        <EmptyState title="Nenhuma empresa cadastrada" />
      ) : (
        <div className="space-y-3">
          {lista.map((e) => (
            <section
              key={e.id}
              className="card-surface flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {e.nome} {!e.ativo ? <Badge className="ml-1 bg-secondary">inativa</Badge> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[e.cnpj, e.telefone].filter(Boolean).join(" · ") || "sem CNPJ"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-primary/10 text-primary">
                  {e.vigente
                    ? `${pct(e.vigente.percentual)} desde ${dateBR(e.vigente.vigencia_inicio)}`
                    : "sem contrato"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditando(e);
                    setNovoPct(e.vigente ? String(e.vigente.percentual) : "");
                    setInicio(HOJE());
                  }}
                >
                  Alterar comissão
                </Button>
                <Button size="sm" onClick={() => trocarEmpresa(e.id)}>
                  Abrir
                </Button>
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editando)} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comissão — {editando?.nome}</DialogTitle>
            <DialogDescription>
              O novo percentual vale a partir da data escolhida. Meses anteriores continuam com o
              percentual da época.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="novo-pct">Percentual (%)</Label>
              <Input
                id="novo-pct"
                inputMode="decimal"
                value={novoPct}
                onChange={(ev) => setNovoPct(ev.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inicio-pct">A partir de</Label>
              <Input
                id="inicio-pct"
                type="date"
                value={inicio}
                onChange={(ev) => setInicio(ev.target.value)}
              />
            </div>
          </div>
          {editando && editando.historico.length ? (
            <div className="text-sm">
              <p className="mb-1 font-medium">Histórico</p>
              <ul className="space-y-1 text-muted-foreground">
                {editando.historico.map((c) => (
                  <li key={c.id}>
                    {pct(c.percentual)} · {dateBR(c.vigencia_inicio)} até{" "}
                    {c.vigencia_fim ? dateBR(c.vigencia_fim) : "hoje"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarComissao} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
