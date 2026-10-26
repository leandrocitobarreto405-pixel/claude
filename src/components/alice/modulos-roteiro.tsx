// Configurações › Alice: módulos do roteiro por serviço (colchão, sofá, impermeabilização…). O
// prompt vira o núcleo, sempre carregado; cada módulo é carregado pela Alice quando ela identifica
// o serviço. Sem módulos, ela lê o prompt inteiro, como antes.
import { PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { chaveDoTitulo, MAX_MODULOS, type ModuloRoteiro } from "@/lib/alice/modulos";

export function ModulosRoteiro({
  modulos,
  nomeAlice,
  aoMudar,
}: {
  modulos: ModuloRoteiro[];
  nomeAlice: string;
  aoMudar: (m: ModuloRoteiro[]) => void;
}) {
  const mudar = (i: number, patch: Partial<ModuloRoteiro>) =>
    aoMudar(modulos.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  function adicionar() {
    let chave = "novo_modulo";
    for (let n = 2; modulos.some((m) => m.chave === chave); n++) chave = `novo_modulo_${n}`;
    aoMudar([...modulos, { chave, titulo: "Novo módulo", texto: "" }]);
  }
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="grid gap-1">
        <p className="text-sm font-semibold">Módulos por serviço</p>
        <p className="text-xs text-muted-foreground">
          Com módulos, o prompt acima é o núcleo (sempre lido) e cada módulo é lido pela {nomeAlice}{" "}
          só quando ela identifica o serviço (ex.: colchão, sofá, impermeabilização). Fica mais
          barato e ela não esquece regras. Sem módulos, ela lê o prompt inteiro.
        </p>
      </div>
      {modulos.map((m, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border bg-background p-3">
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1">
              <Label htmlFor={`modulo-titulo-${i}`} className="text-xs">
                Título
              </Label>
              <Input
                id={`modulo-titulo-${i}`}
                value={m.titulo}
                onChange={(e) => {
                  const titulo = e.target.value;
                  // Módulo novo: a chave acompanha o título; os que já existem mantêm a chave.
                  mudar(
                    i,
                    m.chave.startsWith("novo_modulo")
                      ? { titulo, chave: chaveDoTitulo(titulo) }
                      : { titulo },
                  );
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label={`Remover o módulo ${m.titulo}`}
              onClick={() => aoMudar(modulos.filter((_, k) => k !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Chave: {m.chave}</p>
          <Textarea
            aria-label={`Texto do módulo ${m.titulo}`}
            rows={8}
            value={m.texto}
            onChange={(e) => mudar(i, { texto: e.target.value })}
          />
        </div>
      ))}
      {modulos.length < MAX_MODULOS ? (
        <Button variant="outline" className="min-h-11 self-start" onClick={adicionar}>
          <PlusCircle className="mr-2 size-4" /> Adicionar módulo
        </Button>
      ) : null}
    </div>
  );
}
