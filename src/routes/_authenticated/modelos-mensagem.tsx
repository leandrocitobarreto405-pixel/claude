import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BadgeCheck,
  ChevronRight,
  KeyRound,
  MessageSquareText,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { EditorModelo, type ModeloEmEdicao } from "@/components/modelos/editor-modelo";
import { Finalidades } from "@/components/modelos/finalidades";
import {
  conexaoMetaFn,
  listarModelosFn,
  salvarConexaoMetaFn,
  salvarTextoFn,
  textosDaEmpresaFn,
} from "@/lib/modelos-mensagem.functions";
import {
  FORM_VAZIO,
  TEXTOS,
  preencherTexto,
  previaDoFormulario,
  validarTexto,
  type DefTexto,
} from "@/lib/modelos-mensagem";
import type { LinhaModelo } from "@/lib/meta/modelos.server";
import { usePapel } from "@/lib/tenant";

const CHAVE_CONEXAO = ["modelos", "conexao"] as const;
const CHAVE_LISTA = ["modelos", "lista"] as const;
const CHAVE_TEXTOS = ["modelos", "textos"] as const;

export const Route = createFileRoute("/_authenticated/modelos-mensagem")({
  head: () => ({ meta: [{ title: "Modelos de mensagem — Nexa OS" }] }),
  component: ModelosMensagem,
});

function ModelosMensagem() {
  const { papel } = usePapel();
  const listaFn = useServerFn(listarModelosFn);
  const admin = papel === "admin";
  const lista = useQuery({ queryKey: CHAVE_LISTA, queryFn: () => listaFn(), enabled: admin });
  const qc = useQueryClient();
  const [editando, setEditando] = useState<ModeloEmEdicao | null>(null);

  if (papel && !admin)
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card className="text-center text-sm">Só o administrador vê esta tela.</Card>
      </div>
    );

  const l = lista.data;
  const podeEditar = l?.fonte === "meta";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Modelos de mensagem"
        descricao="Todos os textos que o Nexa envia no WhatsApp: os que precisam de aprovação da Meta e os que não precisam."
      />

      <ConexaoMeta />

      <Card className="gap-2">
        <p className="flex items-start gap-2 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
          <span>
            <b>Precisa de aprovação da Meta:</b> mensagem que começa uma conversa (campanhas,
            pós-venda, reativação, promoção, avisos da equipe). Depois de editar, a Meta analisa de
            novo.
          </span>
        </p>
        <p className="flex items-start gap-2 text-sm">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
          <span>
            <b>Não precisa de aprovação:</b> texto que vai como mensagem comum, quando o cliente
            escreveu nas últimas 24 h, ou o conteúdo que vai dentro do modelo de aviso. Vale na
            hora.
          </span>
        </p>
      </Card>

      <Finalidades aoSalvar={() => void qc.invalidateQueries({ queryKey: CHAVE_LISTA })} />

      <section aria-labelledby="com-aprovacao" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="com-aprovacao" className="flex-1 text-lg font-bold">
            Precisam de aprovação da Meta
          </h2>
          {podeEditar ? (
            <Botao
              variante="contorno"
              onClick={() =>
                setEditando({
                  id: null,
                  status: null,
                  form: FORM_VAZIO,
                  regra: null,
                  naoEditavel: null,
                })
              }
            >
              <Plus /> Novo
            </Botao>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Limite da Meta: modelo aprovado aceita 1 edição por dia e 10 a cada 30 dias. Recusado ou
          pausado, edições à vontade. Em análise, não dá para editar. O contador conta as edições
          feitas pelo Nexa.
        </p>

        {lista.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando os modelos…</p>
        ) : lista.error ? (
          <Card className="text-sm">
            {lista.error instanceof Error ? lista.error.message : "Erro ao carregar."}
          </Card>
        ) : l ? (
          <>
            {l.erro ? (
              <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
                {l.erro}
              </p>
            ) : null}
            {l.fonte === "chatwoot" ? (
              <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
                Lista lida pelo Chatwoot, só para consulta. Configure a conexão com a Meta acima
                para editar e criar modelos pelo app.
              </p>
            ) : null}
            {l.faltando.map((m) => (
              <Card key={m.nome} className="gap-2 border-problema">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-semibold">{m.nome}</p>
                  <Chip tom="problema">Não existe</Chip>
                </div>
                <p className="text-sm text-muted-foreground">
                  O Nexa usa este modelo, mas ele não está na conta do WhatsApp.
                </p>
                {podeEditar ? (
                  <Botao
                    className="self-start"
                    onClick={() =>
                      setEditando({
                        id: null,
                        status: null,
                        form: m.sugestao ?? { ...FORM_VAZIO, nome: m.nome },
                        regra: null,
                        naoEditavel: null,
                      })
                    }
                  >
                    <Plus /> Criar agora
                  </Botao>
                ) : null}
              </Card>
            ))}
            <ul className="flex flex-col gap-2">
              {l.modelos.map((m) => (
                <li key={`${m.nome}-${m.idioma}`}>
                  <LinhaDoModelo
                    m={m}
                    podeEditar={podeEditar}
                    aoEditar={() =>
                      setEditando({
                        id: m.id,
                        status: m.status,
                        form: m.form,
                        regra: m.regra,
                        naoEditavel: m.form.naoEditavel,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            {l.fonte === "nenhuma" && !l.erro ? (
              <Card className="text-sm">Configure a conexão com a Meta para ver os modelos.</Card>
            ) : null}
          </>
        ) : null}
      </section>

      <section aria-labelledby="sem-aprovacao" className="flex flex-col gap-3">
        <h2 id="sem-aprovacao" className="text-lg font-bold">
          Não precisam de aprovação
        </h2>
        <TextosSemAprovacao modelos={l?.modelos ?? []} nomes={l?.nomes ?? {}} />
        <Card className="gap-2 text-sm">
          <p className="font-bold">Outros textos do app</p>
          <Link
            to="/configuracoes"
            search={{ aba: "alice" }}
            className="flex min-h-11 items-center justify-between gap-2 rounded-botao font-semibold text-marca"
          >
            Alice: instruções e respostas frequentes (ela escreve a partir delas)
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </Link>
          <Link
            to="/configuracoes"
            search={{ aba: "mensagem" }}
            className="flex min-h-11 items-center justify-between gap-2 rounded-botao font-semibold text-marca"
          >
            Mensagem padrão da OS e da nota fiscal
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </Link>
          <p className="text-muted-foreground">
            As notas internas que o Nexa escreve no Chatwoot (só a equipe vê, nunca vão para o
            cliente) não são editáveis.
          </p>
        </Card>
      </section>

      <EditorModelo
        aberto={Boolean(editando)}
        modelo={editando}
        aoFechar={() => setEditando(null)}
        aoEnviar={() => {
          setEditando(null);
          void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
        }}
      />
    </div>
  );
}

function LinhaDoModelo({
  m,
  podeEditar,
  aoEditar,
}: {
  m: LinhaModelo;
  podeEditar: boolean;
  aoEditar: () => void;
}) {
  return (
    <Card className="gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{m.nome}</p>
          <p className="text-xs text-muted-foreground">
            {m.categoria === "UTILITY"
              ? "Utilidade"
              : m.categoria === "MARKETING"
                ? "Marketing"
                : m.categoria}{" "}
            · {m.idioma}
            {m.qualidade
              ? ` · qualidade ${m.qualidade === "GREEN" ? "alta" : m.qualidade === "YELLOW" ? "média" : "baixa"}`
              : ""}
          </p>
        </div>
        <Chip tom={m.situacao.tom}>{m.situacao.rotulo}</Chip>
      </div>
      {m.usadoEm ? <p className="text-sm">Usado em: {m.usadoEm}</p> : null}
      {m.status === "REJECTED" ? (
        <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
          Motivo da recusa: {m.motivoRecusa || "a Meta não informou o motivo"}. Corrija e envie de
          novo.
        </p>
      ) : null}
      <p className="whitespace-pre-wrap rounded-card bg-muted p-3 text-sm leading-relaxed">
        {previaDoFormulario(m.form)}
      </p>
      {m.regra.resumo ? <p className="text-xs text-muted-foreground">{m.regra.resumo}</p> : null}
      {!m.regra.pode && m.regra.motivo ? (
        <p className="text-xs text-muted-foreground">
          {m.regra.motivo}
          {m.regra.liberaEm
            ? ` Libera em ${new Date(m.regra.liberaEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`
            : ""}
        </p>
      ) : null}
      {podeEditar ? (
        <Botao
          variante="contorno"
          className="self-start"
          disabled={!m.regra.pode || Boolean(m.form.naoEditavel)}
          onClick={aoEditar}
        >
          Editar
        </Botao>
      ) : null}
      {m.form.naoEditavel ? (
        <p className="text-xs text-muted-foreground">
          Edição pelo app indisponível: {m.form.naoEditavel}.
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- conexão com a Meta
function ConexaoMeta() {
  const qc = useQueryClient();
  const lerFn = useServerFn(conexaoMetaFn);
  const salvarFn = useServerFn(salvarConexaoMetaFn);
  const q = useQuery({ queryKey: CHAVE_CONEXAO, queryFn: () => lerFn() });
  const c = q.data;
  const [aberto, setAberto] = useState(false);
  const [waba, setWaba] = useState("");
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setWaba(c?.waba ?? ""), [c?.waba]);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await salvarFn({ data: { waba, token } });
      setToken("");
      setAberto(false);
      toast.success(`Conexão com a Meta funcionando${r.nome ? ` (${r.nome})` : ""}.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: CHAVE_CONEXAO }),
        qc.invalidateQueries({ queryKey: CHAVE_LISTA }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-marca" aria-hidden />
        <h2 className="flex-1 text-[15px] font-bold">Conexão com a Meta</h2>
        {c ? (
          <Chip tom={c.configurada ? "sucesso" : "atencao"}>
            {c.configurada ? "Configurada" : "Não configurada"}
          </Chip>
        ) : null}
      </div>
      {c?.configurada ? (
        <p className="text-sm">
          {c.nome ? `${c.nome} · ` : ""}conta {c.waba}
          {c.em ? ` · desde ${new Date(c.em).toLocaleDateString("pt-BR")}` : ""}. O token fica
          guardado no servidor e não aparece aqui.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Para editar e criar modelos pelo app, cole o token do usuário do sistema da Meta e o ID da
          conta do WhatsApp Business.
        </p>
      )}
      {aberto ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="meta-waba">ID da conta do WhatsApp Business</Label>
            <Input
              id="meta-waba"
              inputMode="numeric"
              value={waba}
              onChange={(e) => setWaba(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="meta-token">Token de acesso</Label>
            <Input
              id="meta-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="Cole o token aqui"
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O Nexa testa o token na Meta antes de salvar. Depois de salvo, ele não é mostrado de
              novo.
            </p>
          </div>
          <div className="flex gap-2">
            <Botao
              onClick={() => void salvar()}
              disabled={salvando || !waba.trim() || token.trim().length < 20}
            >
              {salvando ? "Testando…" : "Salvar e testar"}
            </Botao>
            <Botao
              variante="neutro"
              onClick={() => {
                setToken("");
                setAberto(false);
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <Botao variante="contorno" className="self-start" onClick={() => setAberto(true)}>
          {c?.configurada ? "Trocar token" : "Configurar"}
        </Botao>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- textos sem aprovação
function TextosSemAprovacao({
  modelos,
  nomes,
}: {
  modelos: LinhaModelo[];
  nomes: Record<string, string>;
}) {
  const lerFn = useServerFn(textosDaEmpresaFn);
  const q = useQuery({ queryKey: CHAVE_TEXTOS, queryFn: () => lerFn() });
  return (
    <ul className="flex flex-col gap-2">
      {TEXTOS.map((def) => (
        <li key={def.chave}>
          <CartaoTexto
            def={def}
            atual={q.data?.[def.chave]?.texto ?? null}
            modelo={modelos.find((m) => def.finalidade && m.nome === nomes[def.finalidade]) ?? null}
          />
        </li>
      ))}
    </ul>
  );
}

function CartaoTexto({
  def,
  atual,
  modelo,
}: {
  def: DefTexto;
  atual: string | null;
  modelo: LinhaModelo | null;
}) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarTextoFn);
  const padrao = def.padrao ?? "";
  const [texto, setTexto] = useState(atual ?? padrao);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setTexto(atual ?? padrao), [atual, padrao]);
  const problemas = texto.trim() ? validarTexto(def, texto) : [];
  const exemplos = Object.fromEntries(def.variaveis.map((v) => [v.nome, v.exemplo]));
  const mudou = texto.trim() !== (atual ?? padrao).trim();

  async function salvar(valor: string | null) {
    setSalvando(true);
    try {
      await salvarFn({ data: { chave: def.chave, texto: valor } });
      await qc.invalidateQueries({ queryKey: CHAVE_TEXTOS });
      toast.success(valor ? "Texto salvo. Vale a partir do próximo envio." : "Voltou ao padrão.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="gap-2">
      <div className="flex items-start gap-2">
        <MessageSquareText className="mt-0.5 size-5 shrink-0 text-marca" aria-hidden />
        <p className="flex-1 font-semibold">{def.titulo}</p>
        <Chip tom={atual ? "sucesso" : "neutro"}>{atual ? "Editado" : "Padrão"}</Chip>
      </div>
      <p className="text-sm text-muted-foreground">{def.quando}</p>
      {!atual && def.padrao === null ? (
        <p className="text-sm">
          Hoje sai o mesmo texto do modelo {modelo?.nome ?? "aprovado"}
          {modelo ? `: "${previaDoFormulario(modelo.form)}"` : ""}. Escreva abaixo para usar um
          texto próprio.
        </p>
      ) : null}
      <Label htmlFor={`txt-${def.chave}`} className="sr-only">
        {def.titulo}
      </Label>
      <Textarea
        id={`txt-${def.chave}`}
        rows={3}
        value={texto}
        placeholder={def.padrao === null ? "Texto próprio (opcional)" : undefined}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {def.variaveis.map((v) => (
          <button
            key={v.nome}
            type="button"
            title={v.descricao}
            onClick={() => setTexto(`${texto}{${v.nome}}`)}
            className="min-h-11 rounded-full border border-border bg-card px-3 text-sm font-semibold text-marca"
          >
            {`{${v.nome}}`} <span className="font-normal text-muted-foreground">{v.descricao}</span>
          </button>
        ))}
      </div>
      {texto.trim() && !problemas.length ? (
        <p className="whitespace-pre-wrap rounded-card bg-marca-claro p-3 text-sm">
          {preencherTexto(texto, exemplos)}
        </p>
      ) : null}
      {problemas.length ? (
        <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
          {problemas.join(" ")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Botao
          disabled={salvando || !mudou || problemas.length > 0 || !texto.trim()}
          onClick={() => void salvar(texto)}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Botao>
        {atual ? (
          <Botao variante="neutro" disabled={salvando} onClick={() => void salvar(null)}>
            Voltar ao padrão
          </Botao>
        ) : null}
      </div>
    </Card>
  );
}
