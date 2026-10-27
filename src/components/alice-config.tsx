import { ModulosRoteiro } from "@/components/alice/modulos-roteiro";
import { CAMPOS_ROTEIRO } from "@/lib/alice/campos-roteiro";
import { useEffect, useState } from "react";
import { AlicePosAtendimento } from "@/components/alice-pos-atendimento";
import { MedidorFranquia } from "@/components/alice/franquia-medidor";
import { useUsoAlice } from "@/lib/alice/uso-alice";
import { textoDepoisDaFranquia } from "@/lib/alice/franquia";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AvisoNaoLiberada } from "@/components/implantacao/aviso-liberacao";
import { useLiberada } from "@/lib/implantacao-cliente";
import { Bot, CheckCircle2, CircleAlert, Trash2, Upload } from "lucide-react";
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
  salvarMidiaAlice,
  situacaoAlice,
  type CampoMidia,
  type ConfigAlice,
} from "@/lib/alice.functions";

const CHAVE = ["alice_situacao"];
const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const EXEMPLO_INSTRUCOES = `Cole aqui o prompt completo da empresa (quem ela é, regras, etapas do atendimento,
textos-modelo, objeções, follow-up, quando transferir). Exemplo curto:
- Toda mensagem termina com uma pergunta, uma só.
- Sempre peça foto do estofado e o CEP antes do preço.
- Pedido de desconto além do Pix: transfira para a vendedora.`;

const MIDIAS: Array<{ campo: CampoMidia; rotulo: string; aceita: string }> = [
  { campo: "video_higienizacao", rotulo: "Vídeo da higienização", aceita: "video/mp4,video/3gpp" },
  {
    campo: "video_impermeabilizacao",
    rotulo: "Vídeo da impermeabilização",
    aceita: "video/mp4,video/3gpp",
  },
  {
    campo: "audio_higienizacao",
    rotulo: "Áudio explicando a higienização",
    aceita: "audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,.ogg,.opus,.mp3,.m4a",
  },
  {
    campo: "audio_impermeabilizacao",
    rotulo: "Áudio explicando a impermeabilização",
    aceita: "audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,.ogg,.opus,.mp3,.m4a",
  },
];

/** Tipo aceito pelo Storage (o navegador às vezes não informa o de .opus/.ogg). */
function tipoDoArquivo(f: File): string {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (f.type) return f.type === "audio/x-m4a" ? "audio/mp4" : f.type;
  if (ext === "ogg" || ext === "opus") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp4") return "video/mp4";
  return "application/octet-stream";
}

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
  const liberada = useLiberada();
  const qc = useQueryClient();
  const situacaoFn = useServerFn(situacaoAlice);
  const salvarFn = useServerFn(salvarAlice);
  const salvarMidiaFn = useServerFn(salvarMidiaAlice);
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
  const { data: uso } = useUsoAlice();
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
  const numero = (v: string) => Number(v.replace(",", "."));

  async function enviarMidia(campoMidia: CampoMidia, arquivo: File | null) {
    if (!s) return;
    setOcupado(true);
    try {
      let caminho: string | null = null;
      if (arquivo) {
        if (arquivo.size > 16 * 1024 * 1024)
          throw new Error("O WhatsApp aceita arquivos de até 16 MB.");
        const ext = (arquivo.name.split(".").pop() ?? "bin")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        caminho = `${s.empresaId}/${campoMidia}-${Date.now()}.${ext || "bin"}`;
        const { error } = await supabase.storage
          .from("alice-midias")
          .upload(caminho, arquivo, { contentType: tipoDoArquivo(arquivo), upsert: false });
        if (error) throw new Error(`Não foi possível enviar o arquivo: ${error.message}`);
      }
      await salvarMidiaFn({ data: { campo: campoMidia, caminho } });
      toast.success(arquivo ? "Arquivo salvo." : "Arquivo removido.");
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o arquivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrirMidia(caminho: string) {
    const { data, error } = await supabase.storage
      .from("alice-midias")
      .createSignedUrl(caminho, 600);
    if (error || !data) {
      toast.error("Não foi possível abrir o arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

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
            disabled={ocupado || (!s.config.ativo && (!pronto || !liberada))}
          >
            {s.config.ativo ? "Desligar" : "Ligar a Alice"}
          </Button>
        </div>

        <AvisoNaoLiberada oque="A Alice fica desligada" />
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
        {uso ? <MedidorFranquia uso={uso} /> : null}

        <div className="mt-4 grid gap-1 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
          <p>
            <strong>Assumir uma conversa:</strong> é só responder o cliente, pelo WhatsApp do
            celular ou pelo Chatwoot, que a Alice sai na hora. Também dá para tocar em “Assumir” na
            lista “Alice atendendo agora” (Início e Repescagens).
          </p>
          <p>
            <strong>Comandos no Chatwoot</strong> (sempre como <em>nota privada</em>, que o cliente
            não vê): <code>#parar</code> tira a Alice da conversa; <code>#desligar</code> desliga a
            IA para o cliente (nem follow-up, nem pós-venda); <code>#alice</code> devolve a conversa
            para ela. Funciona com barra também (<code>/parar</code>).
          </p>
          <p>No WhatsApp do celular não mande comando: tudo que sai de lá chega ao cliente.</p>
        </div>
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
        </div>
        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-1">
            <Label htmlFor="alice-pix">Desconto no Pix (%)</Label>
            <Input
              id="alice-pix"
              value={String(form.desconto_pix_percentual).replace(".", ",")}
              readOnly
              disabled
            />
            <p className="text-xs text-muted-foreground">
              Muda em Configurações › Regras de orçamento › Pagamento (vale para tudo).
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-parcelas">Cartão: até quantas vezes sem juros</Label>
            <Input
              id="alice-parcelas"
              inputMode="numeric"
              value={String(form.parcelas_max)}
              onChange={(e) => campo("parcelas_max", numero(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-validade">Validade do orçamento (dias)</Label>
            <Input
              id="alice-validade"
              inputMode="numeric"
              value={String(form.validade_orcamento_dias)}
              onChange={(e) => campo("validade_orcamento_dias", numero(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-raio">Raio de atendimento (km da base)</Label>
            <Input
              id="alice-raio"
              inputMode="decimal"
              placeholder="Sem limite"
              value={form.raio_km === null ? "" : String(form.raio_km)}
              onChange={(e) =>
                campo("raio_km", e.target.value.trim() ? numero(e.target.value) || null : null)
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-inicio">Mensagens ativas a partir das (h)</Label>
            <Input
              id="alice-inicio"
              inputMode="numeric"
              value={String(form.hora_inicio)}
              onChange={(e) => campo("hora_inicio", numero(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alice-fim">…até as (h)</Label>
            <Input
              id="alice-fim"
              inputMode="numeric"
              value={String(form.hora_fim)}
              onChange={(e) => campo("hora_fim", numero(e.target.value) || 21)}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          O orçamento da Alice sai com esses números (total ÷ parcelas; total com o desconto do
          Pix). Fora do raio, ela passa o cliente para a equipe. Follow-ups só no horário das
          mensagens ativas.
        </p>
        <div className="space-y-1">
          <Label htmlFor="alice-descricao">O que a empresa faz</Label>
          <Input
            id="alice-descricao"
            maxLength={300}
            value={form.descricao_negocio}
            onChange={(e) => campo("descricao_negocio", e.target.value)}
            placeholder="Ex.: empresa de higienização e impermeabilização de estofados"
          />
          <p className="text-xs text-muted-foreground">
            Uma frase. A {form.nome || "Alice"} se apresenta como atendente de uma &quot;
            {form.descricao_negocio || "empresa de prestação de serviços"}&quot;.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alice-instrucoes">
            {form.modulos.length ? "Núcleo do prompt" : "Prompt"} da {form.nome || "Alice"}{" "}
            (instruções da empresa)
          </Label>
          <Textarea
            id="alice-instrucoes"
            rows={20}
            value={form.instrucoes}
            onChange={(e) => campo("instrucoes", e.target.value)}
            placeholder={EXEMPLO_INSTRUCOES}
          />
          <p className="text-xs text-muted-foreground">
            A tabela de preços, o Pix, as parcelas e o histórico do cliente ela já lê do sistema.
            Aqui vai o jeito de vender. Em branco, ela usa um roteiro padrão simples.
          </p>
        </div>
        <ModulosRoteiro
          modulos={form.modulos}
          nomeAlice={form.nome || "Alice"}
          aoMudar={(m) => campo("modulos", m)}
        />
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Dados da empresa usados no roteiro</p>
          <p className="-mt-2 text-xs text-muted-foreground">
            No texto do prompt, {"{nome_empresa}"} vira o nome cadastrado da empresa e estes
            marcadores viram o que estiver preenchido aqui. Marcador usado e vazio: a Alice não liga
            até preencher.
          </p>
          {CAMPOS_ROTEIRO.map((c) => {
            const usado = [
              form.instrucoes,
              form.perguntas_frequentes,
              ...form.modulos.map((m) => m.texto),
            ]
              .join("\n")
              .includes(c.marcador);
            return (
              <div key={c.chave} className="space-y-1">
                <Label htmlFor={`alice-${c.chave}`}>
                  {c.rotulo} <code className="text-xs font-normal">{c.marcador}</code>
                </Label>
                <Input
                  id={`alice-${c.chave}`}
                  maxLength={c.max}
                  inputMode={c.chave === "anos_experiencia" ? "numeric" : undefined}
                  value={form[c.chave]}
                  onChange={(e) => campo(c.chave, e.target.value)}
                  placeholder={`Ex.: ${c.exemplo}`}
                />
                {usado && !form[c.chave].trim() ? (
                  <p className="text-xs text-problema-foreground">O roteiro usa este campo.</p>
                ) : null}
              </div>
            );
          })}
        </div>
        {uso?.trava ? (
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Depois da franquia</p>
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.continuar_apos_franquia}
                onChange={(e) => campo("continuar_apos_franquia", e.target.checked)}
              />
              <span>Continuar depois da franquia, até o teto do mês</span>
            </label>
            {form.continuar_apos_franquia ? (
              <div className="space-y-1">
                <Label htmlFor="alice-teto">Teto do excedente no mês (R$)</Label>
                <Input
                  id="alice-teto"
                  inputMode="decimal"
                  value={
                    form.teto_excedente_reais === null ? "" : String(form.teto_excedente_reais)
                  }
                  onChange={(e) => {
                    const v = e.target.value.replace(",", ".").trim();
                    campo("teto_excedente_reais", v === "" ? null : Number(v) || 0);
                  }}
                  placeholder="Ex.: 70"
                />
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {textoDepoisDaFranquia(uso, form.continuar_apos_franquia, form.teto_excedente_reais)}{" "}
              O excedente entra na próxima fatura; nada é cobrado fora dela.
            </p>
          </div>
        ) : null}
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Follow-up</p>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.cadencia_followup}
              onChange={(e) => campo("cadencia_followup", e.target.checked)}
            />
            <span>
              Sequência de toques garantida pelo sistema (10 min, 40 min, dia seguinte 10h e 14h, D2
              16h)
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.followup_modelos}
              onChange={(e) => campo("followup_modelos", e.target.checked)}
            />
            <span>
              Fora da janela de 24 h do WhatsApp, mandar o modelo aprovado pela Meta (desligado: o
              toque vira tarefa da equipe)
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.oferta_followup_ligada}
              onChange={(e) => campo("oferta_followup_ligada", e.target.checked)}
            />
            <span>Oferta do último follow-up (D2 16h, só depois do orçamento)</span>
          </label>
          {form.oferta_followup_ligada ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="alice-oferta-tipo">Desconto em</Label>
                <select
                  id="alice-oferta-tipo"
                  className={SELECT_CLASS}
                  value={form.oferta_followup_tipo}
                  onChange={(e) =>
                    campo("oferta_followup_tipo", e.target.value === "reais" ? "reais" : "pct")
                  }
                >
                  <option value="pct">% sobre o orçamento</option>
                  <option value="reais">R$ sobre o orçamento</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="alice-oferta-valor">
                  {form.oferta_followup_tipo === "reais" ? "Valor (R$)" : "Percentual (%)"}
                </Label>
                <Input
                  id="alice-oferta-valor"
                  inputMode="decimal"
                  value={
                    form.oferta_followup_valor === null ? "" : String(form.oferta_followup_valor)
                  }
                  onChange={(e) => {
                    const v = e.target.value.replace(",", ".").trim();
                    campo("oferta_followup_valor", v === "" ? null : Number(v) || 0);
                  }}
                  placeholder={form.oferta_followup_tipo === "reais" ? "Ex.: 30" : "Ex.: 10"}
                />
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Qualquer mensagem do cliente cancela os toques e a sequência recomeça da última resposta
            da {form.nome || "Alice"}. Nenhum toque sai se a equipe assumiu ou escreveu, se já tem
            OS, visita ou agendamento, se o lead foi ganho, perdido ou adiado, ou se o cliente pediu
            para não receber. A oferta só sai com valor preenchido e vale até o dia seguinte.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alice-tecido">Tecido padrão quando não identificado</Label>
          <select
            id="alice-tecido"
            className={SELECT_CLASS}
            value={form.tecido_nao_identificado}
            onChange={(e) =>
              campo(
                "tecido_nao_identificado",
                e.target.value as ConfigAlice["tecido_nao_identificado"],
              )
            }
          >
            <option value="equipe">Passar para a equipe (padrão)</option>
            <option value="B">Seguir com a classe B</option>
            <option value="A">Seguir com a classe A</option>
            <option value="C">Seguir com a classe C</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Quando o cliente não sabe o tecido e a foto não deixa claro. Com uma classe, a{" "}
            {form.nome || "Alice"} segue o orçamento sem falar de classe com o cliente e pode dizer
            que o técnico confere o tecido no local. Só vale com a classe de tecido ligada nas
            regras de orçamento.
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
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.transcrever_audio}
                onChange={(e) => campo("transcrever_audio", e.target.checked)}
              />
              <span>
                Transcrever os áudios dos clientes (Google Speech-to-Text). Desligado, a Alice pede
                para o cliente escrever.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.descadastro_resposta}
                onChange={(e) => campo("descadastro_resposta", e.target.checked)}
              />
              <span>
                Confirmar o descadastro de marketing: quando o cliente pede para não receber mais
                promoções, a Alice responde uma vez &quot;Pronto, você não vai mais receber nossas
                promoções 💙&quot;. O contato sai do marketing mesmo com isto desligado.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.clientes_antigos_com_equipe}
                onChange={(e) => campo("clientes_antigos_com_equipe", e.target.checked)}
              />
              <span>
                Cliente antigo vai direto para a equipe (cadastrado em Clientes ou com serviço
                feito): a Alice não responde e deixa uma nota no Chatwoot.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.agenda_automatica}
                onChange={(e) => campo("agenda_automatica", e.target.checked)}
              />
              <span>
                Deixar a Alice consultar a agenda para sugerir dias (fase 2). Ela ainda não reserva:
                o agendamento continua com a equipe.
              </span>
            </label>
            <div className="space-y-1">
              <Label htmlFor="alice-espera-midia">Espera depois do vídeo/áudio (segundos)</Label>
              <Input
                id="alice-espera-midia"
                inputMode="numeric"
                value={String(form.espera_apos_midia_segundos)}
                onChange={(e) => campo("espera_apos_midia_segundos", Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                O resto da resposta (ex.: o orçamento) espera esse tempo. Se o cliente escrever
                antes, sai na hora. 0 = tudo junto.
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

      <section className="card-surface grid gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold">Vídeos e áudios padrão</h2>
          <p className="text-sm text-muted-foreground">
            A {form.nome || "Alice"} manda estes arquivos quando o roteiro pede (vídeo antes do
            orçamento, áudio explicando o serviço). Até 16 MB cada. Áudio de voz: prefira
            .ogg/.opus.
          </p>
        </div>
        <ul className="grid gap-2">
          {MIDIAS.map((m) => {
            const atual = s.midias[m.campo];
            return (
              <li
                key={m.campo}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{m.rotulo}</p>
                  {atual ? (
                    <button
                      type="button"
                      className="truncate text-xs text-primary underline"
                      onClick={() => void abrirMidia(atual)}
                    >
                      {atual.split("/").pop()}
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nenhum arquivo.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm" disabled={ocupado}>
                    <label className="cursor-pointer">
                      <Upload className="size-4" />
                      {atual ? "Trocar" : "Enviar"}
                      <input
                        type="file"
                        accept={m.aceita}
                        className="hidden"
                        disabled={ocupado}
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          e.target.value = "";
                          if (f) void enviarMidia(m.campo, f);
                        }}
                      />
                    </label>
                  </Button>
                  {atual ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ocupado}
                      aria-label={`Remover ${m.rotulo}`}
                      onClick={() => void enviarMidia(m.campo, null)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <AlicePosAtendimento />

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
