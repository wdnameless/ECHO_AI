import { useState } from "react";
import { Button } from "@/components";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ANALYTICS_EVENTS, captureEvent } from "@/lib";

interface CheckoutResponse {
  success?: boolean;
  checkout_url?: string;
  error?: string;
}

/**
 * Экран предложения апгрейда.
 *
 * Платёжный механизм ещё не подключён (R29), поэтому успешный ответ с
 * checkout_url — единственный случай, когда открывается оплата. Если бэкенд
 * сообщает, что оплата недоступна, интерфейс говорит об этом прямо, вместо
 * молчаливого бездействия кнопки: пользователь не должен думать, что покупка
 * состоялась или что приложение сломано.
 */
export const GetLicense = ({
  setState,
  buttonText,
  buttonClassName = "",
}: {
  setState?: React.Dispatch<React.SetStateAction<boolean>>;
  buttonText?: string;
  buttonClassName?: string;
}) => {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGetLicenseKey = async () => {
    setIsCheckoutLoading(true);
    setNotice(null);

    try {
      const response: CheckoutResponse = await invoke("get_checkout_url");

      if (response.success && response.checkout_url) {
        await openUrl(response.checkout_url);
        setState?.(false);
        return;
      }

      setNotice(
        response.error ||
          "Оплата пока недоступна. Pro-возможности появятся, когда подключим платежи."
      );
    } catch (err) {
      console.error("Failed to get checkout URL:", err);
      setNotice(
        "Оплата пока недоступна. Pro-возможности появятся, когда подключим платежи."
      );
    } finally {
      setIsCheckoutLoading(false);
      await captureEvent(ANALYTICS_EVENTS.GET_LICENSE);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleGetLicenseKey}
        disabled={isCheckoutLoading}
        size="sm"
        className={buttonClassName}
      >
        {isCheckoutLoading ? "Loading..." : buttonText || "Get License"}
      </Button>

      {notice && (
        <p
          role="status"
          className="text-[11px] leading-snug text-muted-foreground"
        >
          {notice}
        </p>
      )}
    </div>
  );
};
