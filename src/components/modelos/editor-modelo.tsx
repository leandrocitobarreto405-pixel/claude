import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao } from "@/components/nexa";
import { enviarModeloFn } from "@/lib/modelos-mensagem.functions";
import {
  LIMITES,
  previaDoFormulario,
  quantasVariaveis,
  validarFormulario,
  type BotaoForm,
  type CategoriaModelo,
  type FormModelo,
  type RegraEdicao,
} from "@/lib/modelos-mensagem";
import { cn } from "@/lib/utils";

const SELECT =
  "min-h-11 w-full rounded-botao border border-input bg-card px-3 text-sm text-foreground disabled:opacity-60";

const CATEGORIAS: { valor: CategoriaModelo; rotulo: string; dica: string }[] = [
  { valor: "MARKETING", rotulo: "Marketing", dica: "ofertas, promoções, campanhas" },
  { valor: "UTILITY", rotulo: "Utilidade", dica: "pós-venda, confirmação, avisos" },
];

export type ModeloEmEdicao = {
  id: string | null;
  status: string | null;
  form: FormModelo;
  regra: RegraEdicao | null;
  naoEditavel: string | null;
};

/** Criar ou editar um modelo e enviar para a análise da Meta. */
export function EditorModelo({
  aberto,
  modelo,
  aoFechar,
  aoEnviar,
}: {
  aberto: boolean;
  modelo: ModeloEmEdicao | null;
  aoFechar: () => void;
  aoEnviar: () => void;
}) {
  const enviarFn = useServerFn(enviarModeloFn);
  const [f, setF] = useState<FormModelo | null>(modelo?.form ?? null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => setF(modelo?.form ?? null), [modelo]);

  const n = f ? quantasVariaveis(f.corpo) : 0;
  const problemas = useMemo(() => (f ? validarFormulario(f) : []), [f]);
  if (!modelo || !f) return null;
  const editando = Boolean(modelo.id);
  const aprovado = modelo.status === "APPROVED";
  const bloqueio = modelo.naoEditavel
    ? `Este modelo não pode ser editado pelo app: ${modelo.naoEditavel}. Edite no WhatsApp Manager.`
    : modelo.regra && !modelo.regra.pode
      ? modelo.regra.motivo
      : null;
  const muda = (p: Partial<FormModelo>) => setF({ ...f, ...p });
  const mudaBotao = (i: number, b: BotaoForm) =>
    muda({ botoes: f.botoes.map((x, j) => (j === i ? b : x)) });

  async function enviar() {
    if (!f) return;
    const aviso = editando
      ? aprovado
        ? "Enviar a edição para a Meta? Ela analisa de novo (o modelo continua valendo enquanto isso). Modelo aprovado: no máximo 1 edição por dia e 10 por mês."
        : "Enviar a edição para a análise da Meta?"
      : "Criar o modelo e enviar para a análise da Meta?";
    if (!window.confirm(aviso)) return;
    setEnviando(true);
    try {
      const r = await enviarFn({ data: { id: modelo?.id ?? null, form: f } });
      toast.success(
        editando && aprovado
          ? "Edição enviada. Enquanto a Meta revisa, o modelo continua valendo."
          : r.status === "APPROVED"
            ? "Aprovado pela Meta."
            : "Enviado. A Meta costuma responder em minutos (às vezes até 24 h).",
      );
      if (!r.chatwootAtualizado)
        toast.message("O Chatwoot atualiza a lista de modelos sozinho em alguns minutos.");
      aoEnviar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <SheetTitle className="font-titulo text-2xl">
          {editando ? "Editar modelo" : "Novo modelo"}
        </SheetTitle>
        <SheetDescription>
          Precisa de aprovação da Meta. O texto novo só passa a valer depois de aprovado.
        </SheetDescription>

        <div className="mt-4 flex flex-col gap-4">
          {bloqueio ? (
            <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
              {bloqueio}
            </p>
          ) : null}
          {modelo.regra?.resumo ? (
            <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
              {modelo.regra.resumo}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-1">
              <Label htmlFor="mod-nome">Nome</Label>
              <Input
                id="mod-nome"
                value={f.nome}
                disabled={editando}
                placeholder="ex.: promocao_agenda"
                onChange={(e) => muda({ nome: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mod-idioma">Idioma</Label>
              <Input
                id="mod-idioma"
                value={f.idioma}
                disabled={editando}
                onChange={(e) => muda({ idioma: e.target.value })}
              />
            </div>
          </div>
          {editando ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              A Meta não deixa mudar o nome nem o idioma. Para isso, crie um modelo novo.
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="mod-cat">Categoria</Label>
            <select
              id="mod-cat"
              className={SELECT}
              value={f.categoria}
              disabled={editando && aprovado}
              onChange={(e) => muda({ categoria: e.target.value as CategoriaModelo })}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo} ({c.dica})
                </option>
              ))}
              {f.categoria === "AUTHENTICATION" ? (
                <option value="AUTHENTICATION">Autenticação</option>
              ) : null}
            </select>
            {editando && aprovado ? (
              <p className="text-xs text-muted-foreground">
                Categoria de modelo aprovado não muda (regra da Meta).
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="mod-cab">Título (opcional)</Label>
            <Input
              id="mod-cab"
              value={f.cabecalho}
              maxLength={LIMITES.cabecalho}
              onChange={(e) => muda({ cabecalho: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="mod-corpo">Texto da mensagem</Label>
              <span className="text-xs text-muted-foreground">
                {f.corpo.length}/{LIMITES.corpo}
              </span>
            </div>
            <Textarea
              id="mod-corpo"
              rows={6}
              value={f.corpo}
              onChange={(e) => muda({ corpo: e.target.value })}
            />
            <Botao
              variante="neutro"
              className="self-start"
              onClick={() =>
                muda({ corpo: `${f.corpo}{{${n + 1}}}`, exemplos: [...f.exemplos.slice(0, n), ""] })
              }
            >
              <Plus /> Variável {`{{${n + 1}}}`}
            </Botao>
          </div>

          {n > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold">Exemplos (a Meta exige)</legend>
              {Array.from({ length: n }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-sm font-semibold">{`{{${i + 1}}}`}</span>
                  <Input
                    aria-label={`Exemplo para {{${i + 1}}}`}
                    value={f.exemplos[i] ?? ""}
                    placeholder={i === 0 ? "ex.: Carla" : "ex.: 20%"}
                    onChange={(e) => {
                      const ex = [...f.exemplos];
                      ex[i] = e.target.value;
                      muda({ exemplos: ex });
                    }}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="mod-rodape">Rodapé (opcional)</Label>
            <Input
              id="mod-rodape"
              value={f.rodape}
              maxLength={LIMITES.rodape}
              onChange={(e) => muda({ rodape: e.target.value })}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold">Botões (opcional)</legend>
            {f.botoes.map((b, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-botao border border-border p-3">
                <div className="flex gap-2">
                  <select
                    aria-label="Tipo do botão"
                    className={cn(SELECT, "w-40")}
                    value={b.tipo}
                    onChange={(e) => {
                      const t = e.target.value;
                      mudaBotao(
                        i,
                        t === "URL"
                          ? { tipo: "URL", texto: b.texto, url: "" }
                          : t === "PHONE_NUMBER"
                            ? { tipo: "PHONE_NUMBER", texto: b.texto, telefone: "" }
                            : { tipo: "QUICK_REPLY", texto: b.texto },
                      );
                    }}
                  >
                    <option value="QUICK_REPLY">Resposta rápida</option>
                    <option value="URL">Link</option>
                    <option value="PHONE_NUMBER">Ligar</option>
                  </select>
                  <Input
                    aria-label="Texto do botão"
                    value={b.texto}
                    maxLength={LIMITES.botao}
                    placeholder="Texto do botão"
                    onChange={(e) => mudaBotao(i, { ...b, texto: e.target.value })}
                  />
                  <Botao
                    variante="neutro"
                    tamanho="icone"
                    aria-label={`Tirar o botão ${b.texto}`}
                    onClick={() => muda({ botoes: f.botoes.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Botao>
                </div>
                {b.tipo === "URL" ? (
                  <Input
                    aria-label="Link do botão"
                    placeholder="https://..."
                    value={b.url}
                    onChange={(e) => mudaBotao(i, { ...b, url: e.target.value })}
                  />
                ) : b.tipo === "PHONE_NUMBER" ? (
                  <Input
                    aria-label="Telefone do botão"
                    inputMode="tel"
                    placeholder="+55 11 98888-7777"
                    value={b.telefone}
                    onChange={(e) => mudaBotao(i, { ...b, telefone: e.target.value })}
                  />
                ) : null}
              </div>
            ))}
            {f.botoes.length < LIMITES.botoes ? (
              <Botao
                variante="neutro"
                className="self-start"
                onClick={() => muda({ botoes: [...f.botoes, { tipo: "QUICK_REPLY", texto: "" }] })}
              >
                <Plus /> Botão
              </Botao>
            ) : null}
          </fieldset>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">Prévia</span>
            <p className="whitespace-pre-wrap rounded-card bg-marca-claro p-3 text-sm leading-relaxed">
              {previaDoFormulario(f) || "…"}
            </p>
            {f.botoes.length ? (
              <div className="flex flex-wrap gap-2">
                {f.botoes.map((b, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-marca"
                  >
                    {b.texto || "…"}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {problemas.length ? (
            <ul className="flex flex-col gap-1 rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
              {problemas.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          ) : null}

          <Botao
            tamanho="grande"
            larguraTotal
            disabled={enviando || problemas.length > 0 || Boolean(bloqueio)}
            onClick={() => void enviar()}
          >
            {enviando ? "Enviando…" : "Enviar para aprovação"}
          </Botao>
        </div>
      </SheetContent>
    </Sheet>
  );
}
