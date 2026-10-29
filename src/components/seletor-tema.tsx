// Escolha do tema (Claro / Escuro / Automático): no topo (ícone com menu) e no painel "Mais" do
// celular (três botões). A troca vale na hora, sem recarregar; ver src/lib/tema.ts.
import { useEffect, useState } from "react";
import { Moon, Smartphone, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { aplicarTema, lerTema, type Tema } from "@/lib/tema";
import { cn } from "@/lib/utils";

const OPCOES: Array<{ valor: Tema; rotulo: string; Icone: typeof Sun }> = [
  { valor: "claro", rotulo: "Claro", Icone: Sun },
  { valor: "escuro", rotulo: "Escuro", Icone: Moon },
  { valor: "automatico", rotulo: "Automático", Icone: Smartphone },
];

function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTema] = useState<Tema>("automatico");
  useEffect(() => setTema(lerTema()), []);
  return [
    tema,
    (t) => {
      aplicarTema(t);
      setTema(t);
    },
  ];
}

/** Topo: ícone do tema atual que abre as três opções. */
export function SeletorTema({ className }: { className?: string }) {
  const [tema, escolher] = useTema();
  const Atual = OPCOES.find((o) => o.valor === tema)!.Icone;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-11 shrink-0", className)}
          aria-label="Tema: claro, escuro ou automático"
        >
          <Atual className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={tema} onValueChange={(v) => escolher(v as Tema)}>
          {OPCOES.map(({ valor, rotulo, Icone }) => (
            <DropdownMenuRadioItem key={valor} value={valor} className="min-h-11 gap-2">
              <Icone className="size-4" aria-hidden />
              {rotulo}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Automático segue o tema do aparelho.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Painel "Mais" do celular (fundo azul-marinho): as três opções lado a lado. */
export function SeletorTemaPainel() {
  const [tema, escolher] = useTema();
  return (
    <div className="flex flex-col gap-1.5 px-3">
      <p className="text-xs font-medium text-navy-foreground/70">Tema</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-navy-foreground/8 p-1">
        {OPCOES.map(({ valor, rotulo, Icone }) => (
          <button
            key={valor}
            type="button"
            aria-pressed={tema === valor}
            onClick={() => escolher(valor)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-navy-foreground/80",
              tema === valor && "bg-navy-foreground text-navy-deep",
            )}
          >
            <Icone className="size-4" aria-hidden />
            {rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
