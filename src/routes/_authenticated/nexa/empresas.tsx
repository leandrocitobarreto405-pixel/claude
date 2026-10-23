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
import { CONTEXTO_TENANT_KEY, useContextoTenant } from "@/lib/tenant";
import { useTrocarEmpresa } from "@/lib/documentos-hooks";
import { useServerFn } from "@tanstack/react-start";
import {
  CHAVE_IMPLANTACOES_NEXA,
  ImplantacaoDaEmpresa,
} from "@/components/implantacao/implantacao-nexa";
import { implantacoesNexaFn } from "@/lib/implantacao.functions";
import {
  CHAVE_NUMERACAO_OS,
  definirProximoNumeroOsFn,
  numeracaoOsNexaFn,
  proximoNumero,
  type NumeracaoOs,
} from "@/lib/numeracao-os.functions";
import { ESTADOS } from "@/lib/implantacao";
import { AssinaturaEmpresa } from "@/components/assinatura/assinatura-empresa";
import { avisosFimGratis, resumoAssinatura, usePlanos, type Assinatura } from "@/lib/planos";

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
  cidade: string | null;
  estado: string | null;
  ativo: boolean;
  vigente: Contrato | null;
  historico: Contrato[];
  assinatura: Assinatura | null;
  assinaturas: Assinatura[];
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
  const trocarEmpresa = useTrocarEmpresa();
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
      const [lista, contratos, assinaturas] = await Promise.all([
        supabase
          .from("empresas")
          .select("id, nome, cnpj, telefone, cidade, estado, ativo")
          .order("nome"),
        supabase
          .from("contratos_comissao")
          .select("id, empresa_id, percentual, vigencia_inicio, vigencia_fim")
          .order("vigencia_inicio", { ascending: false }),
        supabase
          .from("assinaturas")
          .select(
            "id, empresa_id, plano_id, valor_mensal, status, vigencia_inicio, vigencia_fim, gratis_ate, proximo_vencimento, contrato_pdf_path, contrato_pdf_em",
          )
          .order("vigencia_inicio", { ascending: false }),
      ]);
      if (lista.error) throw lista.error;
      if (contratos.error) throw contratos.error;
      if (assinaturas.error) throw assinaturas.error;
      return (lista.data ?? []).map((e) => {
        const historico = (contratos.data ?? []).filter((c) => c.empresa_id === e.id);
        const daEmpresa = ((assinaturas.data ?? []) as Assinatura[]).filter(
          (a) => a.empresa_id === e.id,
        );
        return {
          ...e,
          historico,
          vigente: historico.find((c) => c.vigencia_fim === null) ?? null,
          assinaturas: daEmpresa,
          assinatura: daEmpresa.find((a) => a.vigencia_fim === null) ?? null,
        };
      });
    },
  });

  const implantacoesFn = useServerFn(implantacoesNexaFn);
  const implantacoes = useQuery({
    queryKey: CHAVE_IMPLANTACOES_NEXA,
    queryFn: () => implantacoesFn(),
    enabled: Boolean(ctx?.souNexa),
  });

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [percentual, setPercentual] = useState("");
  const [criando, setCriando] = useState(false);

  const [editando, setEditando] = useState<LinhaEmpresa | null>(null);
  const [assinando, setAssinando] = useState<LinhaEmpresa | null>(null);
  const planos = usePlanos(Boolean(ctx?.souNexa));
  const [novoPct, setNovoPct] = useState("");
  const [inicio, setInicio] = useState(HOJE());
  const [salvando, setSalvando] = useState(false);

  const [padraoTexto, setPadraoTexto] = useState<string | null>(null);

  const numeracaoFn = useServerFn(numeracaoOsNexaFn);
  const definirNumeroFn = useServerFn(definirProximoNumeroOsFn);
  const numeracao = useQuery({
    queryKey: CHAVE_NUMERACAO_OS,
    queryFn: () => numeracaoFn(),
    enabled: Boolean(ctx?.souNexa),
  });
  const [numerando, setNumerando] = useState<{ empresa: LinhaEmpresa; atual: NumeracaoOs } | null>(
    null,
  );
  const [novoNumero, setNovoNumero] = useState("");
  const [salvandoNumero, setSalvandoNumero] = useState(false);

  async function salvarNumero() {
    if (!numerando) return;
    const n = Number(novoNumero.replace(/\D/g, ""));
    if (!Number.isFinite(n) || n < 1) {
      toast.error("Informe o próximo número de OS.");
      return;
    }
    setSalvandoNumero(true);
    try {
      await definirNumeroFn({ data: { empresaId: numerando.empresa.id, proximo: n } });
      toast.success(`Próxima OS da ${numerando.empresa.nome}: ${String(n).padStart(4, "0")}.`);
      setNumerando(null);
      void queryClient.invalidateQueries({ queryKey: CHAVE_NUMERACAO_OS });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setSalvandoNumero(false);
    }
  }

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
    const { data: novaId, error } = await supabase.rpc("provisionar_empresa", {
      _nome: nome.trim(),
      ...(cnpj.trim() ? { _cnpj: cnpj.trim() } : {}),
      ...(telefone.trim() ? { _telefone: telefone.trim() } : {}),
      ...(pctInformado !== null ? { _percentual_comissao: pctInformado } : {}),
    });
    if (error) {
      setCriando(false);
      toast.error(`Não foi possível cadastrar: ${error.message}`);
      return;
    }
    if (novaId && (cidade.trim() || estado)) {
      const local = await supabase
        .from("empresas")
        .update({ cidade: cidade.trim() || null, estado: estado || null })
        .eq("id", novaId as string);
      if (local.error) toast.error(`Cidade e estado não foram salvos: ${local.error.message}`);
    }
    setCriando(false);
    toast.success("Empresa cadastrada.");
    setNome("");
    setCidade("");
    setEstado("");
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
  const avisosGratis = avisosFimGratis(lista, planos.data ?? [], HOJE());

  return (
    <>
      <PageHeader
        title="Empresas e comissões"
        description="Empresas clientes da Nexa. A comissão incide sobre o valor recebido de serviços realizados por atendentes da Nexa."
      />

      {avisosGratis.length > 0 && (
        <section
          role="status"
          className="mb-6 space-y-1 rounded-md bg-atencao px-4 py-3 text-sm text-atencao-foreground"
        >
          {avisosGratis.map((aviso) => (
            <p key={aviso} className="font-medium">
              {aviso}
            </p>
          ))}
        </section>
      )}

      <section className="card-surface mb-6 space-y-4 p-5">
        <h2 className="text-lg font-semibold">Cadastrar empresa</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_120px_auto] lg:items-end">
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
            <Label htmlFor="empresa-cidade">Cidade</Label>
            <Input id="empresa-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="empresa-estado">Estado</Label>
            <select
              id="empresa-estado"
              className="min-h-11 w-full rounded-botao border border-input bg-card px-3 text-sm text-foreground"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="">Escolha</option>
              {ESTADOS.map((uf) => (
                <option key={uf.sigla} value={uf.sigla}>
                  {uf.nome} ({uf.sigla})
                </option>
              ))}
            </select>
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
          A empresa nova recebe as listas da empresa-modelo (status do CRM, origens, tipos de
          serviço) e os textos da OS e da nota. Taxas, margens e metas ela preenche: a tela
          “Configuração da empresa” mostra o que falta. Ela começa em implantação, com a Alice e os
          envios desligados, até você tocar em “Liberar empresa”.
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
                  {[e.cnpj, e.telefone, e.cidade && e.estado ? `${e.cidade}/${e.estado}` : null]
                    .filter(Boolean)
                    .join(" · ") || "sem CNPJ"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const n = numeracao.data?.find((x) => x.empresaId === e.id);
                  return n ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNumerando({ empresa: e, atual: n });
                        setNovoNumero(String(n.proximoDefinido ?? Number(n.proximo)));
                      }}
                    >
                      Próxima OS: {n.proximo}
                    </Button>
                  ) : null;
                })()}
                <Badge className="bg-secondary text-foreground">
                  {resumoAssinatura(e.assinatura, planos.data ?? [])}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setAssinando(e)}>
                  Assinatura
                </Button>
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
              {(() => {
                const imp = implantacoes.data?.find((i) => i.empresaId === e.id);
                return imp ? (
                  <ImplantacaoDaEmpresa dados={imp} />
                ) : implantacoes.isLoading ? (
                  <p className="w-full text-sm text-muted-foreground">Conferindo a configuração…</p>
                ) : null;
              })()}
            </section>
          ))}
        </div>
      )}

      <AssinaturaEmpresa
        empresa={assinando}
        vigente={assinando ? (lista.find((x) => x.id === assinando.id)?.assinatura ?? null) : null}
        historico={assinando ? (lista.find((x) => x.id === assinando.id)?.assinaturas ?? []) : []}
        planos={planos.data ?? []}
        aoFechar={() => setAssinando(null)}
        aoSalvar={() => {
          setAssinando(null);
          atualizar();
        }}
      />

      <Dialog open={Boolean(numerando)} onOpenChange={(aberto) => !aberto && setNumerando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Próximo número de OS — {numerando?.empresa.nome}</DialogTitle>
            <DialogDescription>
              A próxima OS recebe o maior entre o maior número já usado + 1 e este campo. Só pode
              aumentar e nunca fica abaixo do maior número já usado
              {numerando?.atual.maiorUsado != null
                ? ` (${String(numerando.atual.maiorUsado).padStart(4, "0")})`
                : ""}
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="proximo-os">Próximo número de OS</Label>
            <Input
              id="proximo-os"
              inputMode="numeric"
              className="min-h-11"
              value={novoNumero}
              onChange={(ev) => setNovoNumero(ev.target.value)}
            />
            {numerando ? (
              <p className="text-sm text-muted-foreground">
                Hoje a próxima seria {numerando.atual.proximo}. Com este valor, a próxima OS será{" "}
                <strong>
                  {proximoNumero(
                    numerando.atual.maiorUsado,
                    Number(novoNumero.replace(/\D/g, "")) || null,
                  )}
                </strong>
                .
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNumerando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarNumero} disabled={salvandoNumero}>
              {salvandoNumero ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
