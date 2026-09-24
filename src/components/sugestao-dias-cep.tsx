import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateBR, timeBR, weekdayPT } from "@/lib/format";
import { sugerirDiasPorCep } from "@/lib/routes.functions";

type Props = {
  /** CEP inicial (só dígitos ou formatado); usado quando a tela já tem um CEP. */
  cepInicial?: string;
  /** Esconde o campo de CEP quando o CEP vem de outro formulário. */
  ocultarCampo?: boolean;
  titulo?: string;
  onEscolher: (dia: string) => void;
};

/** Sugere os dias já agendados mais próximos de um CEP (próximos 30 dias). */
export function SugestaoDiasCep({
  cepInicial,
  ocultarCampo = false,
  titulo = "Sugerir dia pelo CEP do cliente",
  onEscolher,
}: Props) {
  const [cep, setCep] = useState(cepInicial ?? "");
  const sugerir = useServerFn(sugerirDiasPorCep);
  const mutation = useMutation({
    mutationFn: (valor: string) => sugerir({ data: { cep: valor } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível sugerir dias."),
  });

  useEffect(() => {
    if (ocultarCampo) setCep(cepInicial ?? "");
  }, [cepInicial, ocultarCampo]);

  const digitos = cep.replace(/\D/g, "").slice(0, 8);
  const mascarado = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
  const resultado = mutation.data;

  return (
    <section className="card-surface mb-6 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {ocultarCampo ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{titulo}</p>
            <p className="text-xs text-muted-foreground">
              {digitos.length === 8 ? `CEP ${mascarado}` : "Informe o CEP do cliente acima."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="cep-sugestao">{titulo}</Label>
            <Input
              id="cep-sugestao"
              value={mascarado}
              onChange={(e) => setCep(e.target.value)}
              placeholder="00000-000"
              inputMode="numeric"
              className="w-[160px]"
            />
          </div>
        )}
        <Button
          type="button"
          onClick={() => mutation.mutate(digitos)}
          disabled={digitos.length !== 8 || mutation.isPending}
        >
          <MapPin className="size-4" /> {mutation.isPending ? "Procurando..." : "Sugerir dias"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Mostra os 3 dias com atendimento mais perto desse endereço nos próximos 30 dias.
        </p>
      </div>

      {resultado ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">CEP {resultado.address}</p>
          {resultado.days.length === 0 ? (
            <p className="text-sm">Nenhum atendimento agendado nesse período.</p>
          ) : (
            <ul className="space-y-2">
              {resultado.days.map((d) => (
                <li key={d.date}>
                  <button
                    type="button"
                    onClick={() => onEscolher(d.date)}
                    className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
                  >
                    <p className="font-medium capitalize">
                      {weekdayPT(d.date)}, {dateBR(d.date)} · {d.km.toFixed(1).replace(".", ",")} km
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Mais perto: {d.nearestCustomer}
                      {d.nearestNeighborhood ? ` (${d.nearestNeighborhood})` : ""} · {d.stops}{" "}
                      atendimento(s) das {timeBR(d.firstTime)} às {timeBR(d.lastTime)} ·{" "}
                      {d.technicianName}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {resultado.failures.length ? (
            <p className="text-xs text-muted-foreground">{resultado.failures.join(" ")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
