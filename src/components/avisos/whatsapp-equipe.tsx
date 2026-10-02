import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, Chip, LinhaSwitch } from "@/components/nexa";
import { configAvisosWhatsapp, salvarAvisosWhatsapp } from "@/lib/avisos.functions";
import { cn } from "@/lib/utils";

const CHAVE = ["avisos", "whatsapp"] as const;
const ESPERAS: { valor: number | null; rotulo: string }[] = [
  { valor: null, rotulo: "Não avisar" },
  { valor: 10, rotulo: "10 min" },
  { valor: 15, rotulo: "15 min" },
  { valor: 30, rotulo: "30 min" },
  { valor: 60, rotulo: "1 hora" },
];

/**
 * Avisos no WhatsApp da equipe. Começa desligado; só o admin liga. Os avisos vão para um único
 * celular da equipe e nunca para cliente (o servidor recusa número que seja de cliente).
 */
export function WhatsappEquipe() {
  const qc = useQueryClient();
  const lerFn = useServerFn(configAvisosWhatsapp);
  const salvarFn = useServerFn(salvarAvisosWhatsapp);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn() });
  const c = q.data;
  const [ligado, setLigado] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [modelo, setModelo] = useState("nexa_aviso");
  const [espera, setEspera] = useState<number | null>(null);
  const [resumo, setResumo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!c) return;
    setLigado(c.ligado);
    setTelefone(c.telefone ?? "");
    setModelo(c.modelo ?? "nexa_aviso");
    setEspera(c.esperaMinutos);
    setResumo(c.resumoDiario);
  }, [c]);

  if (!c) return null;
  const admin = c.admin;

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({
        data: { ligado, telefone, modelo, esperaMinutos: espera, resumoDiario: resumo },
      });
      await qc.invalidateQueries({ queryKey: CHAVE });
      toast.success(ligado ? "Salvo. Os próximos avisos vão para o WhatsApp." : "Salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Collapsible className="rounded-card border border-border bg-card">
      <CollapsibleTrigger className="group flex min-h-14 w-full items-center gap-3 rounded-card px-4 text-left">
        <MessageCircle className="size-5 text-marca" aria-hidden />
        <span className="flex-1 text-[15px] font-bold">Avisos no WhatsApp da equipe</span>
        <Chip tom={c.ligado ? "sucesso" : "neutro"}>{c.ligado ? "Ligado" : "Desligado"}</Chip>
        <ChevronDown
          aria-hidden
          className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t border-border p-4">
          <p className="text-sm text-muted-foreground">
            Os avisos vão para um celular da equipe. Nunca vão para cliente: se o número for de um
            cliente, o Nexa não salva e não envia.
          </p>
          {c.numeroBloqueado ? (
            <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
              O celular configurado está na base de clientes, então nenhum aviso é enviado. Troque
              pelo celular de alguém da equipe que não seja cliente.
            </p>
          ) : null}
          {c.ultimoErro ? (
            <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
              Último erro de envio: {c.ultimoErro}
            </p>
          ) : c.ligado ? (
            <p className="text-sm text-muted-foreground">
              Enviados nas últimas 24 h: {c.enviadosHoje}
            </p>
          ) : null}

          <LinhaSwitch
            id="aviso-ligado"
            titulo="Receber avisos no WhatsApp"
            descricao="Problemas no pós-venda, campanhas e as opções abaixo."
            checked={ligado}
            onCheckedChange={setLigado}
            disabled={!admin}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="aviso-telefone">Celular da equipe</Label>
              <Input
                id="aviso-telefone"
                inputMode="tel"
                placeholder="11 98888-7777"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                disabled={!admin}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="aviso-modelo">Modelo aprovado na Meta</Label>
              <Input
                id="aviso-modelo"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                disabled={!admin}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={!admin}>
            <legend className="mb-1 text-sm font-bold">
              Cliente esperando a equipe há mais de
            </legend>
            <div className="flex flex-wrap gap-2">
              {ESPERAS.map((o) => {
                const sel = espera === o.valor;
                return (
                  <button
                    key={o.rotulo}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setEspera(o.valor)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm font-semibold",
                      sel
                        ? "border-marca bg-marca text-marca-foreground"
                        : "border-border bg-card text-foreground",
                    )}
                  >
                    {o.rotulo}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <LinhaSwitch
            id="aviso-resumo"
            titulo="Resumo do dia às 9h"
            descricao="Serviços de hoje, atrasados, sem técnico e clientes esperando."
            checked={resumo}
            onCheckedChange={setResumo}
            disabled={!admin}
          />

          {admin ? (
            <Botao onClick={() => void salvar()} disabled={salvando} className="self-start">
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          ) : (
            <p className="text-sm text-muted-foreground">Só o administrador muda estas opções.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
