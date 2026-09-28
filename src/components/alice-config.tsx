import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import {
  MODELOS_ALICE,
  ligarAlice,
  salvarAlice,
  situacaoAlice,
  type ConfigAlice,
} from "@/lib/alice.functions";

const CHAVE = ["alice_situacao"];
const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const EXEMPLO_INSTRUCOES = `Exemplos do que escrever aqui (o jeito da empresa vender):
- Atendemos Florianópolis, São José e Palhoça; fora disso, taxa de deslocamento de R$ 30.
- Sempre peça foto do estofado e pergunte se tem pet ou criança em casa.
- Secagem de 6 a 8 horas; a impermeabilização tem garantia de 1 ano.
- Pagamento: Pix com 5% de desconto ou cartão em até 6x sem juros.
- Horários de visita: segunda a sábado, 8h às 17h.`;

type Execucao = {
  id: string;
  created_at: string;
  mensagens_enviadas: string[];
  ferramentas: Array<{ nome: string }>;
  custo_usd: number;
  erro: string | null;
  lead: { lead_name: string | null } | null;
};

export function AliceConfig() {
  const qc = useQueryClient();
  const situacaoFn = useServerFn(situacaoAlice);
  const salvarFn = useServerFn(salvarAlice);
  const ligarFn = useServerFn(ligarAlice);
  const query = useQuery({ queryKey: CHAVE, queryFn: () => situacaoFn({}) });
  const execucoes = useQuery({
    queryKey: ["alice_execucoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_execucoes")
        .select(
          "id, created_at, mensagens_enviadas, ferramentas, custo_usd, erro, lead:crm_lead_id ( lead_name )",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Execucao[];
    },
  });
  const [form, setForm] = useState<ConfigAlice | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (query.data) setForm(query.data.config);
  }, [query.data]);

  const s = query.data;
  if (!s || !form) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  const pronto = s.iaNoServidor && s.roboNoChatwoot && s.caixas > 0;

  async function salvar() {
    if (!form) return;
    setOcupado(true);
    try {
      const { ativo: _ativo, ...dados } = form;
      await salvarFn({ data: dados });
      toast.success("Configuração da Alice salva.");
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function alternar() {
    if (!s) return;
    const ligar = !s.config.ativo;
    if (!ligar && !window.confirm("Desligar a Alice? As conversas com ela voltam para a equipe."))
      return;
    setOcupado(true);
    try {
      await ligarFn({ data: { ativo: ligar } });
      toast.success(ligar ? "Alice ligada: ela atende as conversas novas." : "Alice desligada.");
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setOcupado(false);
    }
  }

  const campo = <K extends keyof ConfigAlice>(k: K, v: ConfigAlice[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <div className="grid max-w-4xl gap-6 [&>*]:min-w-0">
      <section className="card-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{form.nome || "Alice"}: vendedora de IA</h2>
              <p className="text-sm text-muted-foreground">
                {s.config.ativo
                  ? "Ligada: atende as conversas novas do WhatsApp."
                  : "Desligada: as conversas vão direto para a equipe."}
              </p>
            </div>
          </div>
          <Button
            onClick={() => void alternar()}
            disabled={ocupado || (!s.config.ativo && !pronto)}
          >
            {s.config.ativo ? "Desligar" : "Ligar a Alice"}
          </Button>
        </div>

        <ul className="mt-4 grid gap-1 text-sm">
          <Requisito ok={s.iaNoServidor} texto="Chave da IA (Anthropic) configurada no servidor" />
          <Requisito
            ok={s.roboNoChatwoot}
            texto="Robô da Alice criado no Chatwoot (Nexa → Chatwoot)"
          />
          <Requisito
            ok={s.caixas > 0}
            texto={`Caixa de entrada do WhatsApp ligada à empresa (${s.caixas})`}
          />
        </ul>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Numero rotulo="Respostas (7 dias)" valor={String(s.ultimos7dias.respostas)} />
          <Numero
            rotulo="Custo da IA (7 dias)"
            valor={`US$ ${s.ultimos7dias.custoUsd.toFixed(2)}`}
          />
          <Numero rotulo="Passadas à equipe" valor={String(s.ultimos7dias.passagens)} />
          <Numero rotulo="Falhas" valor={String(s.ultimos7dias.erros)} />
        </div>

        <p className="mt-4 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Para <strong>assumir</strong> uma conversa, é só escrever nela pelo Chatwoot: a Alice sai
          na hora. Para <strong>devolver</strong> à Alice, marque a conversa como “Pendente” no
          Chatwoot.
        </p>
      </section>

      <section className="card-surface grid gap-4 p-5 [&>*]:min-w-0">
        <h2 className="text-lg font-semibold">Como a {form.nome || "Alice"} vende</h2>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-1">
            <Label htmlFor="alice-nome">Nome</Label>
            <Input
              id="alice-nome"
              value={form.nome}
              onChange={(e) => campo("nome", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-desconto">Desconto máximo que ela pode dar (%)</Label>
            <Input
              id="alice-desconto"
              inputMode="decimal"
              value={String(form.desconto_max_percentual)}
              onChange={(e) =>
                campo("desconto_max_percentual", Number(e.target.value.replace(",", ".")) || 0)
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alice-instrucoes">Instruções de venda da empresa</Label>
          <Textarea
            id="alice-instrucoes"
            rows={12}
            value={form.instrucoes}
            onChange={(e) => campo("instrucoes", e.target.value)}
            placeholder={EXEMPLO_INSTRUCOES}
          />
          <p className="text-xs text-muted-foreground">
            A tabela de preços, as formas de pagamento e a agenda ela já lê do sistema. Aqui vai o
            jeito de vender: área atendida, regras, argumentos, o que perguntar, quando chamar a
            equipe.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alice-faq">Perguntas frequentes e respostas</Label>
          <Textarea
            id="alice-faq"
            rows={8}
            value={form.perguntas_frequentes}
            onChange={(e) => campo("perguntas_frequentes", e.target.value)}
            placeholder={
              "P: Quanto tempo demora para secar?\nR: De 6 a 8 horas, com a janela aberta."
            }
          />
        </div>

        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Ajustes avançados</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-1">
              <Label htmlFor="alice-modelo">Modelo de IA</Label>
              <select
                id="alice-modelo"
                className={SELECT_CLASS}
                value={form.modelo}
                onChange={(e) => campo("modelo", e.target.value)}
              >
                {MODELOS_ALICE.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alice-esforco">Capricho nas respostas</Label>
              <select
                id="alice-esforco"
                className={SELECT_CLASS}
                value={form.esforco}
                onChange={(e) => campo("esforco", e.target.value as ConfigAlice["esforco"])}
              >
                <option value="low">Rápido (mais barato)</option>
                <option value="medium">Equilibrado (recomendado)</option>
                <option value="high">Caprichado (mais lento e caro)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alice-espera">Espera antes de responder (segundos)</Label>
              <Input
                id="alice-espera"
                inputMode="numeric"
                value={String(form.espera_segundos)}
                onChange={(e) => campo("espera_segundos", Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Junta mensagens seguidas do cliente numa resposta só.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alice-limite">Máximo de respostas por conversa</Label>
              <Input
                id="alice-limite"
                inputMode="numeric"
                value={String(form.limite_respostas_conversa)}
                onChange={(e) => campo("limite_respostas_conversa", Number(e.target.value) || 40)}
              />
              <p className="text-xs text-muted-foreground">
                Passando disso, a conversa vai para a equipe.
              </p>
            </div>
          </div>
        </details>

        <div>
          <Button onClick={() => void salvar()} disabled={ocupado}>
            Salvar
          </Button>
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-3 text-lg font-semibold">Últimas respostas da {form.nome || "Alice"}</h2>
        {!execucoes.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma resposta ainda.</p>
        ) : (
          <ul className="grid gap-3">
            {execucoes.data.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {dateTimeBR(e.created_at)} · {e.lead?.lead_name ?? "—"} · US${" "}
                  {Number(e.custo_usd).toFixed(4)}
                  {e.ferramentas?.length ? ` · ${e.ferramentas.map((f) => f.nome).join(", ")}` : ""}
                </p>
                {e.erro ? (
                  <p className="mt-1 text-amber-900">{e.erro}</p>
                ) : (
                  e.mensagens_enviadas.map((m, i) => (
                    <p key={i} className="mt-1 whitespace-pre-wrap break-words">
                      {m}
                    </p>
                  ))
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Requisito({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{texto}</span>
    </li>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
