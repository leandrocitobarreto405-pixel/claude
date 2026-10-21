// Configurações › Empresa › Dados nos documentos: nome, contatos, slogan, rodapé, logo e
// assinatura dos PDFs (OS, orçamento e termo), com prévia do PDF na própria tela.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, LinhaSwitch } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useContextoTenant } from "@/lib/tenant";
import {
  enviarAssinatura,
  enviarLogo,
  useImagemEmpresa,
  useInvalidarImagensEmpresa,
} from "@/lib/empresa-logo";
import {
  CHAVE_DADOS_EMPRESA,
  lerDadosEmpresaFn,
  pdfExemploFn,
  salvarDadosEmpresaFn,
  type DadosEmpresaForm,
} from "@/lib/documentos.functions";
import { usePdfCompartilhavel } from "@/lib/compartilhar-pdf";

type ChaveTexto = Exclude<
  keyof DadosEmpresaForm,
  "logoPath" | "assinaturaPath" | "mostrarAssinatura" | "fraseRodape"
>;

const CAMPOS: Array<{ chave: ChaveTexto; rotulo: string; placeholder?: string; tipo?: string }> = [
  { chave: "nome", rotulo: "Nome da empresa" },
  {
    chave: "slogan",
    rotulo: "Slogan (abaixo do nome)",
    placeholder: "Limpeza & Higienização de Ambientes",
  },
  {
    chave: "atividade",
    rotulo: "Atividade (rodapé: NOME | atividade)",
    placeholder: "Limpeza de Estofados",
  },
  { chave: "cnpj", rotulo: "CNPJ", placeholder: "00.000.000/0000-00" },
  { chave: "email", rotulo: "E-mail", tipo: "email" },
  { chave: "telefone", rotulo: "WhatsApp", tipo: "tel" },
  { chave: "telefone2", rotulo: "Segundo telefone", tipo: "tel" },
  { chave: "instagram", rotulo: "Instagram", placeholder: "@suaempresa" },
  { chave: "endereco", rotulo: "Endereço", placeholder: "Rua, número - bairro - cidade - UF" },
  { chave: "assinante", rotulo: "Quem assina", placeholder: "Nome de quem assina os documentos" },
];

function Imagem({
  caminho,
  alt,
  altura,
  xadrez,
}: {
  caminho: string | null;
  alt: string;
  altura: string;
  xadrez?: boolean;
}) {
  const img = useImagemEmpresa(caminho);
  if (!caminho || !img.data)
    return (
      <div
        className={`flex ${altura} w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground`}
      >
        {caminho ? "carregando…" : "sem imagem"}
      </div>
    );
  return (
    <img
      src={img.data}
      alt={alt}
      className={`${altura} max-w-44 shrink-0 rounded-md border border-border object-contain p-1 ${xadrez ? "bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:12px_12px]" : "bg-white"}`}
    />
  );
}

export function DadosEmpresa() {
  const qc = useQueryClient();
  const invalidarImagens = useInvalidarImagensEmpresa();
  const { data: ctx } = useContextoTenant();
  const empresaId = ctx?.ativa?.empresa.id ?? null;
  const ler = useServerFn(lerDadosEmpresaFn);
  const salvar = useServerFn(salvarDadosEmpresaFn);
  const exemploFn = useServerFn(pdfExemploFn);
  const dados = useQuery({ queryKey: [...CHAVE_DADOS_EMPRESA, empresaId], queryFn: () => ler() });
  const [form, setForm] = useState<DadosEmpresaForm | null>(null);
  const [enviando, setEnviando] = useState<"logo" | "assinatura" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [previa, setPrevia] = useState<{ url: string; tipo: string } | null>(null);
  const [gerandoPrevia, setGerandoPrevia] = useState(false);
  const previaRef = useRef<HTMLDivElement>(null);
  const pdf = usePdfCompartilhavel();

  useEffect(() => {
    if (dados.data) setForm(dados.data);
  }, [dados.data]);
  useEffect(
    () => () => {
      if (previa) URL.revokeObjectURL(previa.url);
    },
    [previa],
  );

  async function gravar(f: DadosEmpresaForm, aviso: string) {
    await salvar({ data: f });
    await qc.invalidateQueries({ queryKey: [...CHAVE_DADOS_EMPRESA] });
    toast.success(aviso);
  }

  async function trocarImagem(qual: "logo" | "assinatura", arquivo: File | undefined) {
    if (!arquivo || !form || !empresaId) return;
    setEnviando(qual);
    try {
      const caminho =
        qual === "logo"
          ? await enviarLogo(empresaId, arquivo)
          : await enviarAssinatura(empresaId, arquivo);
      const novo =
        qual === "logo" ? { ...form, logoPath: caminho } : { ...form, assinaturaPath: caminho };
      await gravar(novo, qual === "logo" ? "Logo salva." : "Assinatura salva.");
      setForm(novo);
      void invalidarImagens();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a imagem.");
    } finally {
      setEnviando(null);
    }
  }

  async function tirarImagem(qual: "logo" | "assinatura") {
    if (!form) return;
    try {
      const novo =
        qual === "logo" ? { ...form, logoPath: null } : { ...form, assinaturaPath: null };
      await gravar(novo, qual === "logo" ? "Logo retirada." : "Assinatura retirada.");
      setForm(novo);
      void invalidarImagens();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  async function salvarDados() {
    if (!form) return;
    setSalvando(true);
    try {
      await gravar(form, "Dados da empresa salvos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function verPrevia(tipo: "orcamento" | "os") {
    if (!form) return;
    setGerandoPrevia(true);
    try {
      const a = await exemploFn({ data: { tipo, empresa: form } });
      const bin = atob(a.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPrevia({ url, tipo: tipo === "orcamento" ? "Orçamento" : "OS" });
      setTimeout(
        () => previaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar a prévia.");
    } finally {
      setGerandoPrevia(false);
    }
  }

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <section className="card-surface space-y-5 p-5">
      <p className="text-sm text-muted-foreground">
        Aparecem nos PDFs da OS, do orçamento e do termo de garantia: logo, nome e slogan no topo;
        CNPJ, frase, Instagram e contatos no rodapé. Campo vazio não aparece. O nome e o WhatsApp
        também são os que a Alice usa.
      </p>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Logo</p>
        <div className="flex flex-wrap items-center gap-3">
          <Imagem caminho={form.logoPath} alt="Logo da empresa" altura="h-20" />
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-input px-4 text-sm font-medium">
            {enviando === "logo" ? "Enviando…" : form.logoPath ? "Trocar logo" : "Adicionar logo"}
            <input
              type="file"
              accept="image/*,.heic,.heif,.pdf,application/pdf"
              className="sr-only"
              disabled={Boolean(enviando) || !empresaId}
              onChange={(e) => {
                void trocarImagem("logo", e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {form.logoPath ? (
            <Botao variante="neutro" onClick={() => void tirarImagem("logo")}>
              Tirar logo
            </Botao>
          ) : null}
          <p className="w-full text-xs text-muted-foreground">
            JPG, PNG, WebP, HEIC ou PDF: vira PNG na hora. Também é o avatar da empresa no app.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div
            key={c.chave}
            className={c.chave === "endereco" ? "space-y-2 sm:col-span-2" : "space-y-2"}
          >
            <Label htmlFor={`empresa-${c.chave}`}>{c.rotulo}</Label>
            <Input
              id={`empresa-${c.chave}`}
              type={c.tipo ?? "text"}
              className="min-h-11"
              placeholder={c.placeholder}
              value={form[c.chave]}
              onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })}
            />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="empresa-fraseRodape">Frase do rodapé</Label>
          <Textarea
            id="empresa-fraseRodape"
            rows={2}
            placeholder="Ex.: um versículo ou o lema da empresa"
            value={form.fraseRodape}
            onChange={(e) => setForm({ ...form, fraseRodape: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Assinatura</p>
        <div className="flex flex-wrap items-center gap-3">
          <Imagem caminho={form.assinaturaPath} alt="Assinatura" altura="h-14" xadrez />
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-input px-4 text-sm font-medium">
            {enviando === "assinatura"
              ? "Enviando…"
              : form.assinaturaPath
                ? "Trocar assinatura"
                : "Adicionar assinatura"}
            <input
              type="file"
              accept="image/*,.heic,.heif"
              className="sr-only"
              disabled={Boolean(enviando) || !empresaId}
              onChange={(e) => {
                void trocarImagem("assinatura", e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {form.assinaturaPath ? (
            <Botao variante="neutro" onClick={() => void tirarImagem("assinatura")}>
              Tirar assinatura
            </Botao>
          ) : null}
          <p className="w-full text-xs text-muted-foreground">
            PNG com fundo transparente fica melhor. Sai com a data e o nome de quem assina.
          </p>
        </div>
        <LinhaSwitch
          id="empresa-mostrar-assinatura"
          titulo="Mostrar assinatura e data no fim do documento"
          checked={form.mostrarAssinatura}
          onCheckedChange={(v) => setForm({ ...form, mostrarAssinatura: v })}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Botao disabled={salvando} onClick={() => void salvarDados()}>
          {salvando ? "Salvando…" : "Salvar dados"}
        </Botao>
        <Botao
          variante="contorno"
          disabled={gerandoPrevia}
          onClick={() => void verPrevia("orcamento")}
        >
          {gerandoPrevia ? "Gerando…" : "Prévia do orçamento"}
        </Botao>
        <Botao variante="contorno" disabled={gerandoPrevia} onClick={() => void verPrevia("os")}>
          Prévia da OS
        </Botao>
      </div>
      <p className="text-xs text-muted-foreground">
        A prévia usa dados fictícios e os campos da tela, mesmo antes de salvar.
      </p>

      {previa ? (
        <div ref={previaRef} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Prévia: {previa.tipo} de exemplo</p>
            <Botao
              variante="neutro"
              disabled={pdf.gerando}
              onClick={() =>
                void pdf.gerar(() =>
                  exemploFn({
                    data: { tipo: previa.tipo === "OS" ? "os" : "orcamento", empresa: form },
                  }),
                )
              }
            >
              Abrir / compartilhar
            </Botao>
          </div>
          <iframe
            title={`Prévia do ${previa.tipo}`}
            src={previa.url}
            className="h-[70vh] w-full rounded-md border border-border bg-white"
          />
        </div>
      ) : null}
    </section>
  );
}
