// Configurações › Documentos: Drive ou PDF direto no app, textos dos PDFs e PDF de exemplo.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePdfCompartilhavel } from "@/lib/compartilhar-pdf";
import { useInvalidarDocumentos } from "@/lib/documentos-hooks";
import {
  CHAVE_CONFIG_DOCUMENTOS,
  lerConfigDocumentosFn,
  pdfExemploFn,
  salvarConfigDocumentosFn,
} from "@/lib/documentos.functions";
import type { ConfigDocumentos, ModoDocumento } from "@/lib/pdf/textos-padrao";

type ChaveTexto =
  "validade" | "cancelamento" | "beneficios" | "garantia_os" | "termo" | "agradecimento";
type ChaveNumero = "garantia_meses" | "visitas_gratuitas" | "pct_manutencao" | "valor_km";

const TEXTOS: Array<{ chave: ChaveTexto; rotulo: string; ajuda: string; linhas: number }> = [
  {
    chave: "validade",
    rotulo: "Validade do orçamento",
    ajuda: "Vai em “Observação”, logo abaixo do pagamento.",
    linhas: 2,
  },
  {
    chave: "beneficios",
    rotulo: "Benefícios da impermeabilização",
    ajuda: "Só aparece se a OS tiver impermeabilização.",
    linhas: 5,
  },
  {
    chave: "garantia_os",
    rotulo: "Garantia na OS",
    ajuda:
      "Só aparece se a OS tiver impermeabilização. Só higienização não leva texto de garantia.",
    linhas: 10,
  },
  {
    chave: "cancelamento",
    rotulo: "Cancelamento e remarcação",
    ajuda: "Vai em “Observação importante”, em toda OS.",
    linhas: 8,
  },
  {
    chave: "termo",
    rotulo: "Termo de garantia",
    ajuda: "Texto do PDF do termo (OS com impermeabilização, depois do serviço concluído).",
    linhas: 14,
  },
  {
    chave: "agradecimento",
    rotulo: "Agradecimento",
    ajuda: "Frase final, centralizada.",
    linhas: 2,
  },
];

const NUMEROS: Array<{ chave: ChaveNumero; rotulo: string; passo: string }> = [
  { chave: "garantia_meses", rotulo: "Meses de garantia", passo: "1" },
  { chave: "visitas_gratuitas", rotulo: "Visitas técnicas gratuitas", passo: "1" },
  { chave: "pct_manutencao", rotulo: "% da manutenção fora da garantia", passo: "1" },
  { chave: "valor_km", rotulo: "Deslocamento (R$ por km)", passo: "0.5" },
];

const MODOS: Array<{ id: ModoDocumento; titulo: string; descricao: string }> = [
  {
    id: "drive",
    titulo: "Modelos do Google Drive",
    descricao: "Como hoje: documento gerado a partir dos modelos do Drive.",
  },
  {
    id: "pdf",
    titulo: "PDF direto no app",
    descricao: "Botão “Baixar PDF” na OS, com os dados e os textos daqui. Nada fica salvo.",
  },
];

export function DocumentosPdf() {
  const qc = useQueryClient();
  const invalidarDocumentos = useInvalidarDocumentos();
  const ler = useServerFn(lerConfigDocumentosFn);
  const salvarFn = useServerFn(salvarConfigDocumentosFn);
  const exemploFn = useServerFn(pdfExemploFn);
  const q = useQuery({ queryKey: [...CHAVE_CONFIG_DOCUMENTOS], queryFn: () => ler() });
  const [c, setC] = useState<ConfigDocumentos | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pdf = usePdfCompartilhavel();

  useEffect(() => {
    if (q.data) setC(q.data.config);
  }, [q.data]);

  if (!c || !q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const padrao = q.data.padrao;

  async function salvar(novo: ConfigDocumentos, aviso: string) {
    setSalvando(true);
    try {
      await salvarFn({ data: novo });
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...CHAVE_CONFIG_DOCUMENTOS] }),
        invalidarDocumentos(),
      ]);
      toast.success(aviso);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  function escolherModo(modo: ModoDocumento) {
    if (!c || modo === c.modo) return;
    const novo = { ...c, modo };
    setC(novo);
    void salvar(
      novo,
      modo === "pdf" ? "Documentos: PDF direto no app." : "Documentos: modelos do Google Drive.",
    );
  }

  return (
    <div className="grid gap-5">
      <section className="card-surface space-y-3 p-5">
        <h2 className="text-base font-semibold">Como gerar o documento da OS</h2>
        <div
          role="radiogroup"
          aria-label="Como gerar o documento da OS"
          className="grid gap-2 sm:grid-cols-2"
        >
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={c.modo === m.id}
              disabled={salvando}
              onClick={() => escolherModo(m.id)}
              className={cn(
                "min-h-11 rounded-lg border p-3 text-left transition-colors",
                c.modo === m.id ? "border-marca bg-marca-claro" : "border-border bg-card",
              )}
            >
              <span className="block text-sm font-bold">{m.titulo}</span>
              <span className="block text-xs text-muted-foreground">{m.descricao}</span>
            </button>
          ))}
        </div>
        {c.modo === "pdf" ? (
          <p className="text-xs text-muted-foreground">
            O cabeçalho usa os dados de Configurações › Empresa › Dados nos documentos.
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Textos do PDF</h2>
          <p className="text-xs text-muted-foreground">
            Linha em branco separa parágrafos · “- ” no começo vira item de lista · “## ” vira
            subtítulo · **entre asteriscos** fica em negrito. Variáveis: {"{empresa}"}{" "}
            {"{telefone}"} {"{endereco}"} {"{email}"} {"{meses}"} {"{visitas}"} {"{pct_manutencao}"}{" "}
            {"{valor_km}"}.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {NUMEROS.map((n) => (
            <div key={n.chave} className="space-y-2">
              <Label htmlFor={`doc-${n.chave}`}>{n.rotulo}</Label>
              <Input
                id={`doc-${n.chave}`}
                type="number"
                inputMode="decimal"
                step={n.passo}
                min={0}
                className="min-h-11"
                value={String(c[n.chave])}
                onChange={(e) => setC({ ...c, [n.chave]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>

        {TEXTOS.map((t) => (
          <div key={t.chave} className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor={`doc-${t.chave}`}>{t.rotulo}</Label>
              {c[t.chave] !== padrao[t.chave] ? (
                <button
                  type="button"
                  className="min-h-11 px-2 text-xs font-semibold text-marca underline"
                  onClick={() => setC({ ...c, [t.chave]: padrao[t.chave] })}
                >
                  Voltar ao texto padrão
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t.ajuda}</p>
            <Textarea
              id={`doc-${t.chave}`}
              rows={t.linhas}
              value={c[t.chave]}
              onChange={(e) => setC({ ...c, [t.chave]: e.target.value })}
            />
          </div>
        ))}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Botao
            disabled={salvando}
            onClick={() => void salvar(c, "Textos dos documentos salvos.")}
          >
            {salvando ? "Salvando…" : "Salvar textos"}
          </Botao>
          <Botao
            variante="contorno"
            disabled={pdf.gerando}
            onClick={() => void pdf.gerar(() => exemploFn({ data: { tipo: "os", config: c } }))}
          >
            {pdf.gerando ? "Gerando…" : "Ver PDF de exemplo"}
          </Botao>
          <Botao
            variante="neutro"
            disabled={pdf.gerando}
            onClick={() => void pdf.gerar(() => exemploFn({ data: { tipo: "termo", config: c } }))}
          >
            Termo de exemplo
          </Botao>
          {pdf.pronto ? (
            <Botao variante="contorno" onClick={() => void pdf.compartilharPronto()}>
              Compartilhar {pdf.pronto.name}
            </Botao>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          O exemplo usa dados fictícios e os textos da tela, mesmo antes de salvar.
        </p>
      </section>
    </div>
  );
}
