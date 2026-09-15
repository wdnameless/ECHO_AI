import { useCallback, useEffect, useRef, useState } from "react";
import { TrustHostDialog } from "@/components/TrustHostDialog";
import {
  setHostTrustPrompt,
  type HostTrustDecision,
  type HostTrustRequest,
} from "@/lib/host-trust-gate";

/**
 * S2: мост между шлюзом доверия хостов и диалогом подтверждения.
 *
 * Шлюз вызывается из сетевого слоя (вне React-дерева), поэтому связь идёт
 * через подписку: шлюз ставит запрос в очередь, компонент показывает диалог
 * и резолвит промис решением пользователя.
 *
 * Монтируется один раз в корне приложения.
 */
export const HostTrustProvider = () => {
  const [pending, setPending] = useState<HostTrustRequest | null>(null);
  const resolverRef = useRef<((decision: HostTrustDecision) => void) | null>(null);

  const settle = useCallback((decision: HostTrustDecision) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(decision);
  }, []);

  useEffect(() => {
    const unsubscribe = setHostTrustPrompt(
      (request) =>
        new Promise<HostTrustDecision>((resolve) => {
          resolverRef.current = resolve;
          setPending(request);
        })
    );
    return () => {
      unsubscribe();
      // При размонтировании закрываем висящий запрос отказом, чтобы
      // промис не остался навсегда неразрешённым.
      resolverRef.current?.("deny");
      resolverRef.current = null;
    };
  }, []);

  return (
    <TrustHostDialog
      open={pending !== null}
      host={pending?.host ?? ""}
      secrets={pending?.secrets ?? []}
      onOpenChange={(open) => {
        if (!open) settle("deny");
      }}
      onTrustAndSend={() => settle("trust")}
      onSendWithoutKey={() => settle("without-secrets")}
      onCancel={() => settle("deny")}
    />
  );
};
