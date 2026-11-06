import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  BellRing,
  ListChecks,
  MessageSquare,
  Phone,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/nexa/meta-teste")({
  head: () => ({ meta: [{ title: "WhatsApp Cloud: teste — Nexa OS" }] }),
  component: MetaTeste,
});

type Evento = {
  tipo: string;
  contato: string | null;
  texto: string | null;
  status: string | null;
  wa_message_id: string | null;
  recebido_em: string;
};

type Resposta = {
  ok?: boolean;
  erro?: string;
  meta?: unknown;
  eventos?: Evento[];
  token_invalido?: boolean;
  token_ausente?: boolean;
  valido?: boolean;
  vence_em?: string | null;
  escopos?: string[];
  inscrito?: boolean | null;
};

async function chamar(corpo: Record<string, unknown>): Promise<Resposta> {
  const { data, error } = await supabase.functions.invoke("nexa-meta-teste", { body: corpo });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const r = ctx ? ((await ctx.json().catch(() => null)) as Resposta | null) : null;
    return { ok: false, erro: r?.erro ?? "Não foi possível falar com o servidor." };
  }
  return data as Resposta;
}

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Painel Nexa › WhatsApp Cloud: teste. Chamadas do app Nexa OS com o NÚMERO DE TESTE da Meta
 * (+1 555 188-4259), para a Análise do app: mensagem de texto e de modelo
 * (whatsapp_business_messaging), modelos e números do WABA (whatsapp_business_management).
 */
function MetaTeste() {
  const [para, setPara] = useState("");
  const [texto, setTexto] = useState("Hello from Nexa OS! This is a test message.");
  const [modelo, setModelo] = useState("hello_world");
  const [novoModelo, setNovoModelo] = useState("nexa_os_teste");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [saida, setSaida] = useState<{ titulo: string; corpo: unknown } | null>(null);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  // Situação do token de teste: aviso claro em vez de quebrar.
  const [token, setToken] = useState<Resposta | null>(null);
  // Inscrição do app no WABA de teste: null = ainda não consultada.
  const [inscrito, setInscrito] = useState<boolean | null>(null);

  useEffect(() => {
    void chamar({ acao: "verificar_token" }).then(setToken);
  }, []);

  async function rodar(titulo: string, corpo: Record<string, unknown>) {
    setOcupado(titulo);
    const r = await chamar(corpo);
    setOcupado(null);
    if (r.eventos) setEventos(r.eventos);
    if (typeof r.inscrito === "boolean") setInscrito(r.inscrito);
    if (r.token_invalido || r.token_ausente) setToken(r);
    setSaida({ titulo, corpo: r.ok === false ? { erro: r.erro } : (r.meta ?? r) });
    if (r.ok === false) toast.error(r.erro ?? "Erro.");
    else toast.success(`${titulo}: ok`);
  }

  const destinoOk = /^[0-9]{10,15}$/.test(para.replace(/\D/g, ""));
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo="Painel Nexa"
        titulo="WhatsApp Cloud: teste"
        descricao="Chamadas do app Nexa OS com o número de teste da Meta. Nunca usa número de cliente."
      />

      {token && (token.token_invalido || token.token_ausente || token.ok === false) ? (
        <p
          role="alert"
          className="rounded-md bg-problema px-3 py-2 text-sm font-medium text-problema-foreground"
        >
          {token.erro ?? "Token de teste inválido."}
        </p>
      ) : token?.valido ? (
        <p className="rounded-md bg-marca-claro px-3 py-2 text-sm text-marca">
          Token de teste válido
          {token.vence_em
            ? ` até ${new Date(token.vence_em).toLocaleDateString("pt-BR")}`
            : " (sem vencimento)"}
          {token.escopos?.length ? ` · ${token.escopos.join(", ")}` : ""}
        </p>
      ) : null}

      <Card className="gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tom="atencao">Número de teste da Meta</Chip>
          <span className="font-semibold">+1 555 188-4259</span>
        </div>
        <p className="text-muted-foreground">
          Phone Number ID 1547429628435173 · WABA 3641269396036529. O destino precisa estar na lista
          de números autorizados do app (API Setup, “To”).
        </p>
      </Card>

      <Card className="gap-3">
        <p className="text-[15px] font-bold">whatsapp_business_messaging</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mt-para">Enviar para (com DDI, só números)</Label>
          <Input
            id="mt-para"
            inputMode="tel"
            placeholder="5511999999999"
            value={para}
            onChange={(e) => setPara(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mt-texto">Texto (precisa da janela de 24 h aberta)</Label>
          <Input id="mt-texto" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao
            disabled={!destinoOk || !texto.trim() || Boolean(ocupado)}
            onClick={() => void rodar("Enviar texto", { acao: "enviar_texto", para, texto })}
          >
            <Send /> Enviar texto
          </Botao>
          <Input
            aria-label="Modelo"
            className="w-44"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
          />
          <Botao
            variante="contorno"
            disabled={!destinoOk || Boolean(ocupado)}
            onClick={() =>
              void rodar("Enviar modelo", {
                acao: "enviar_modelo",
                para,
                modelo,
                idioma: modelo === "hello_world" ? "en_US" : "pt_BR",
              })
            }
          >
            <Send /> Enviar modelo
          </Botao>
        </div>
      </Card>

      <Card className="gap-3">
        <p className="text-[15px] font-bold">whatsapp_business_management</p>
        <div className="flex flex-wrap gap-2">
          <Botao
            variante="contorno"
            disabled={Boolean(ocupado)}
            onClick={() => void rodar("Listar modelos", { acao: "listar_modelos" })}
          >
            <ListChecks /> Listar modelos
          </Botao>
          <Botao
            variante="contorno"
            disabled={Boolean(ocupado)}
            onClick={() => void rodar("Listar números", { acao: "listar_numeros" })}
          >
            <Phone /> Listar números
          </Botao>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mt-novo">Criar modelo de teste</Label>
            <Input
              id="mt-novo"
              className="w-56"
              value={novoModelo}
              onChange={(e) => setNovoModelo(e.target.value)}
            />
          </div>
          <Botao
            variante="contorno"
            disabled={!/^[a-z0-9_]+$/.test(novoModelo) || Boolean(ocupado)}
            onClick={() => void rodar("Criar modelo", { acao: "criar_modelo", nome: novoModelo })}
          >
            <PlusCircle /> Criar modelo
          </Botao>
        </div>
      </Card>

      <Card className="gap-3">
        <p className="text-[15px] font-bold">Webhook: inscrição do app no WABA de teste</p>
        <p className="text-sm text-muted-foreground">
          A Meta só manda as mensagens ao webhook se o app Nexa OS estiver inscrito no WABA. Mexe só
          no WABA de teste 3641269396036529.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Botao
            variante="contorno"
            disabled={Boolean(ocupado)}
            onClick={() => void rodar("Ver inscrição", { acao: "ver_inscricao" })}
          >
            <Search /> Ver inscrição
          </Botao>
          {inscrito === true ? (
            <Chip tom="sucesso">Nexa OS inscrito</Chip>
          ) : inscrito === false ? (
            <>
              <Chip tom="problema">Nexa OS não inscrito</Chip>
              <Botao
                disabled={Boolean(ocupado)}
                onClick={() => void rodar("Inscrever app", { acao: "inscrever_app" })}
              >
                <BellRing /> Inscrever
              </Botao>
            </>
          ) : null}
        </div>
      </Card>

      <Card className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[15px] font-bold">Mensagens recebidas (webhook)</p>
          <Botao
            variante="neutro"
            disabled={Boolean(ocupado)}
            onClick={() => void rodar("Mensagens", { acao: "mensagens" })}
          >
            <RefreshCw /> Atualizar
          </Botao>
        </div>
        {!eventos ? (
          <p className="text-sm text-muted-foreground">Toque em Atualizar.</p>
        ) : eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada recebido ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eventos.map((e, i) => (
              <li
                key={`${e.wa_message_id}-${e.tipo}-${e.status}-${i}`}
                className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <MessageSquare
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">
                    {e.tipo === "mensagem" ? `+${e.contato ?? "?"}` : `Status: ${e.status ?? "?"}`}
                  </span>
                  {e.texto ? <span className="break-words">{e.texto}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {hora(e.recebido_em)}
                </span>
                {e.tipo === "mensagem" && e.contato ? (
                  <Botao variante="neutro" onClick={() => setPara(e.contato ?? "")}>
                    Responder
                  </Botao>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {saida ? (
        <Card className="gap-2">
          <p className="text-sm font-bold">Resposta da Meta · {saida.titulo}</p>
          <pre className="max-h-80 overflow-auto rounded-md bg-secondary p-3 text-xs">
            {JSON.stringify(saida.corpo, null, 2)}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}
