// Painel Nexa › Empresas: assinatura da empresa (plano, valor, status, período grátis) e o PDF do
// contrato assinado, usado só no Nexa Gestão (decisões A, B e C).
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, parseNumberBR } from "@/lib/format";
import {
  STATUS_ASSINATURA,
  fimDoTeste,
  mensalidade,
  periodoGratis,
  type Assinatura,
  type Plano,
  type StatusAssinatura,
} from "@/lib/planos";

const HOJE = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const MESES_CONSULTORIA = 3;

export function AssinaturaEmpresa({
  empresa,
  vigente,
  historico,
  planos,
  aoFechar,
  aoSalvar,
}: {
  empresa: { id: string; nome: string } | null;
  vigente: Assinatura | null;
  historico: Assinatura[];
  planos: Plano[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [plano, setPlano] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState<StatusAssinatura>("ativa");
  const [inicio, setInicio] = useState(HOJE());
  const [gratisAte, setGratisAte] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [testeAte, setTesteAte] = useState("");

  useEffect(() => {
    if (!empresa) return;
    const atual = vigente ? planos.find((p) => p.id === vigente.plano_id) : undefined;
    setPlano(atual?.codigo ?? "");
    setValor(vigente?.valor_mensal != null ? String(vigente.valor_mensal).replace(".", ",") : "");
    setStatus(vigente?.status ?? "ativa");
    setInicio(vigente?.vigencia_inicio ?? HOJE());
    setGratisAte(vigente?.gratis_ate ?? "");
    setVencimento(vigente?.proximo_vencimento ?? "");
    setTesteAte(vigente?.status === "trial" ? (vigente.gratis_ate ?? "") : "");
  }, [empresa, vigente, planos]);

  /** Cobrança (isenta) e "em teste até": gravam na hora, na assinatura vigente. */
  async function cobranca(p: { isenta?: boolean; teste?: string | null }) {
    if (!empresa || !vigente) return;
    setSalvando(true);
    const { error } = await supabase.rpc("definir_cobranca", {
      _empresa_id: empresa.id,
      _isenta: p.isenta ?? null,
      _mudar_teste: p.teste !== undefined,
      _teste_ate: p.teste ?? null,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success(
      p.isenta !== undefined
        ? p.isenta
          ? "Empresa isenta: não gera fatura nem fica em atraso."
          : "Empresa volta a ser cobrada."
        : p.teste
          ? `Em teste até ${dateBR(p.teste)}.`
          : "Teste encerrado: assinatura ativa.",
    );
    aoSalvar();
  }

  const escolhido = planos.find((p) => p.codigo === plano);
  const nexaGestao = plano === "nexa_gestao";

  function consultoria() {
    const g = periodoGratis(inicio, MESES_CONSULTORIA);
    setStatus("trial");
    setGratisAte(g.gratisAte);
    setVencimento(g.vencimento);
  }

  async function salvar() {
    if (!empresa) return;
    if (!escolhido) {
      toast.error("Escolha o plano.");
      return;
    }
    const v = valor.trim() ? parseNumberBR(valor) : null;
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      toast.error("Mensalidade inválida.");
      return;
    }
    if (gratisAte && gratisAte < inicio) {
      toast.error("O período grátis termina antes do início.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("definir_assinatura", {
      _empresa_id: empresa.id,
      _plano: escolhido.codigo,
      _inicio: inicio,
      _valor: v,
      _status: status,
      _gratis_ate: gratisAte || null,
      _proximo_vencimento: vencimento || null,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Assinatura salva.");
    aoSalvar();
  }

  async function enviarContrato(arquivo: File) {
    if (!empresa || !vigente) {
      toast.error("Salve a assinatura antes de anexar o contrato.");
      return;
    }
    if (arquivo.type !== "application/pdf") {
      toast.error("Envie o contrato em PDF.");
      return;
    }
    setEnviando(true);
    const caminho = `${empresa.id}/contrato-${Date.now()}.pdf`;
    const envio = await supabase.storage
      .from("contratos")
      .upload(caminho, arquivo, { contentType: "application/pdf" });
    if (envio.error) {
      setEnviando(false);
      toast.error(`Não foi possível enviar: ${envio.error.message}`);
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("assinaturas")
      .update({
        contrato_pdf_path: caminho,
        contrato_pdf_em: new Date().toISOString(),
        contrato_pdf_por: u.user?.id ?? null,
      })
      .eq("id", vigente.id);
    setEnviando(false);
    if (error) {
      toast.error(`O arquivo subiu, mas não foi ligado à assinatura: ${error.message}`);
      return;
    }
    toast.success("Contrato anexado.");
    aoSalvar();
  }

  async function verContrato() {
    if (!vigente?.contrato_pdf_path) return;
    const { data, error } = await supabase.storage
      .from("contratos")
      .createSignedUrl(vigente.contrato_pdf_path, 120);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o contrato.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <Dialog open={Boolean(empresa)} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assinatura — {empresa?.nome}</DialogTitle>
          <DialogDescription>
            Com a mesma data de início, corrige a assinatura atual. Com data posterior, a atual
            termina na véspera e começa outra. A comissão da Nexa é o contrato de comissão da
            empresa (botão "Alterar comissão").
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {vigente ? (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">Cobrança</p>
                <div role="radiogroup" aria-label="Cobrança" className="grid grid-cols-2 gap-2">
                  {(
                    [
                      [false, "Cobrar"],
                      [true, "Isenta"],
                    ] as const
                  ).map(([isenta, rotulo]) => (
                    <button
                      key={rotulo}
                      type="button"
                      role="radio"
                      aria-checked={Boolean(vigente.isenta) === isenta}
                      disabled={salvando}
                      onClick={() =>
                        Boolean(vigente.isenta) !== isenta && void cobranca({ isenta })
                      }
                      className={
                        Boolean(vigente.isenta) === isenta
                          ? "min-h-11 rounded-botao border border-marca bg-marca-claro text-sm font-semibold"
                          : "min-h-11 rounded-botao border border-border bg-card text-sm"
                      }
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Isenta nunca gera fatura nem fica em atraso (fora do MRR).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ass-teste">Em teste até</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="ass-teste"
                    type="date"
                    className="min-h-11 w-auto"
                    value={testeAte}
                    onChange={(e) => setTesteAte(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={salvando}
                    onClick={() => setTesteAte(fimDoTeste(HOJE(), "30d"))}
                  >
                    30 dias
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={salvando}
                    onClick={() => setTesteAte(fimDoTeste(HOJE(), "3m"))}
                  >
                    3 meses
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={salvando || !testeAte}
                    onClick={() => void cobranca({ teste: testeAte })}
                  >
                    Aplicar teste
                  </Button>
                  {vigente.status === "trial" ? (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={salvando}
                      onClick={() => void cobranca({ teste: null })}
                    >
                      Encerrar teste
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Em teste: grátis até a data; o primeiro vencimento é no dia seguinte.
                </p>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="ass-plano">Plano</Label>
            <select
              id="ass-plano"
              className="min-h-11 w-full rounded-botao border border-input bg-card px-3 text-sm text-foreground"
              value={plano}
              onChange={(e) => setPlano(e.target.value)}
            >
              <option value="">Escolha</option>
              {planos
                .filter((p) => p.ativo || p.codigo === plano)
                .map((p) => (
                  <option key={p.id} value={p.codigo}>
                    {p.nome}
                    {p.preco_mensal === null ? " (a definir)" : ` (${brl(p.preco_mensal)})`}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ass-valor">Mensalidade própria (R$)</Label>
              <Input
                id="ass-valor"
                className="min-h-11"
                inputMode="decimal"
                placeholder="a do plano"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ass-status">Situação</Label>
              <select
                id="ass-status"
                className="min-h-11 w-full rounded-botao border border-input bg-card px-3 text-sm text-foreground"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusAssinatura)}
              >
                {(Object.keys(STATUS_ASSINATURA) as StatusAssinatura[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_ASSINATURA[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ass-inicio">Início do contrato</Label>
            <Input
              id="ass-inicio"
              type="date"
              className="min-h-11"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </div>
          <Button variant="outline" className="min-h-11" onClick={consultoria}>
            Cliente da consultoria: {MESES_CONSULTORIA} meses grátis desde o início
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ass-gratis">Grátis até</Label>
              <Input
                id="ass-gratis"
                type="date"
                className="min-h-11"
                value={gratisAte}
                onChange={(e) => setGratisAte(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ass-venc">Próximo vencimento</Label>
              <Input
                id="ass-venc"
                type="date"
                className="min-h-11"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </div>
          </div>

          {nexaGestao ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Contrato assinado (PDF)</p>
              {vigente?.contrato_pdf_path ? (
                <p className="text-sm text-muted-foreground">
                  Anexado
                  {vigente.contrato_pdf_em
                    ? ` em ${dateBR(vigente.contrato_pdf_em.slice(0, 10))}`
                    : ""}
                  .{" "}
                  <button type="button" className="underline" onClick={verContrato}>
                    Ver contrato
                  </button>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum contrato anexado.</p>
              )}
              <Input
                type="file"
                accept="application/pdf"
                className="min-h-11"
                disabled={enviando || !vigente}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void enviarContrato(f);
                  e.target.value = "";
                }}
              />
              {!vigente ? (
                <p className="text-xs text-muted-foreground">Salve a assinatura antes de anexar.</p>
              ) : null}
            </div>
          ) : null}

          {historico.length > 1 ? (
            <div className="text-sm">
              <p className="mb-1 font-medium">Histórico</p>
              <ul className="space-y-1 text-muted-foreground">
                {historico.map((h) => (
                  <li key={h.id}>
                    {planos.find((p) => p.id === h.plano_id)?.nome ?? "plano"} ·{" "}
                    {STATUS_ASSINATURA[h.status]} · {dateBR(h.vigencia_inicio)} até{" "}
                    {h.vigencia_fim ? dateBR(h.vigencia_fim) : "hoje"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
