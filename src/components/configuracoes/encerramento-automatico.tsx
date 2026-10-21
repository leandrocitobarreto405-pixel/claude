// Configurações › Mensagens › Encerramento automático de conversas paradas (começa desligado).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, LinhaSwitch } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfigEncerramento } from "@/lib/caixa-encerramento";
import {
  CHAVE_ENCERRAMENTO,
  lerEncerramentoFn,
  previaEncerramentoFn,
  salvarEncerramentoFn,
} from "@/lib/caixa-encerramento.functions";

export function EncerramentoAutomatico() {
  const qc = useQueryClient();
  const ler = useServerFn(lerEncerramentoFn);
  const previaFn = useServerFn(previaEncerramentoFn);
  const salvarFn = useServerFn(salvarEncerramentoFn);
  const q = useQuery({ queryKey: [...CHAVE_ENCERRAMENTO], queryFn: () => ler() });
  const [c, setC] = useState<ConfigEncerramento | null>(null);
  const [previa, setPrevia] = useState<{ equipe: number; alice: number; total: number } | null>(
    null,
  );
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (q.data) setC(q.data);
  }, [q.data]);
  useEffect(() => setPrevia(null), [c?.horas, c?.incluirAlice]);

  if (!c) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  async function verPrevia() {
    if (!c) return;
    setOcupado(true);
    try {
      setPrevia(await previaFn({ data: c }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível calcular.");
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    if (!c) return;
    setOcupado(true);
    try {
      await salvarFn({ data: c });
      await qc.invalidateQueries({ queryKey: [...CHAVE_ENCERRAMENTO] });
      toast.success(
        c.ligado
          ? `Encerramento automático ligado: ${c.horas} h sem mensagem.`
          : "Encerramento automático desligado.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Conversa sem nenhuma mensagem há mais de N horas vai para Encerradas no app e fica resolvida
        no Chatwoot. Se o cliente escrever de novo, ela reabre sozinha. Roda a cada poucos minutos,
        até 100 conversas por vez.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="enc-horas">Horas sem mensagem</Label>
          <Input
            id="enc-horas"
            type="number"
            inputMode="numeric"
            min={1}
            max={720}
            className="min-h-11"
            value={String(c.horas)}
            onChange={(e) => setC({ ...c, horas: Number(e.target.value) })}
          />
        </div>
      </div>
      <LinhaSwitch
        id="enc-alice"
        titulo="Incluir as conversas que estão com a Alice"
        descricao="Desligado: só as conversas com a equipe. Ligado: as da Alice também."
        checked={c.incluirAlice}
        onCheckedChange={(v) => setC({ ...c, incluirAlice: v })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="contorno" disabled={ocupado} onClick={() => void verPrevia()}>
          Quantas seriam encerradas agora?
        </Botao>
        {previa ? (
          <span className="text-sm">
            <strong>{previa.total}</strong> conversa{previa.total === 1 ? "" : "s"} ({previa.equipe}{" "}
            com a equipe{c.incluirAlice ? `, ${previa.alice} com a Alice` : ""}).
          </span>
        ) : null}
      </div>
      <LinhaSwitch
        id="enc-ligado"
        titulo="Encerramento automático ligado"
        descricao="Começa desligado. Veja a prévia antes de ligar."
        checked={c.ligado}
        onCheckedChange={(v) => setC({ ...c, ligado: v })}
      />
      <Botao disabled={ocupado} onClick={() => void salvar()} className="sm:w-auto">
        {ocupado ? "Salvando…" : "Salvar"}
      </Botao>
    </div>
  );
}
