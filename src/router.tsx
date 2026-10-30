import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { medirConsultas } from "@/lib/ritmo";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Uma nova tentativa só (com o banco lento, três tentativas por tela viram fila).
    defaultOptions: { queries: { retry: 1 } },
  });
  if (typeof window !== "undefined") medirConsultas(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
