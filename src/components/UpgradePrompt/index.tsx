import React from "react";
import { SparklesIcon, ShieldAlertIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface UpgradePromptProps {
  feature: string; // человекочитаемое имя возможности
  compact?: boolean;
}

export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  feature,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-md">
        <SparklesIcon className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
        <span>
          <strong className="font-semibold">{feature}</strong> входит в тариф Pro. Оплата пока недоступна (разработка продолжается).
        </span>
      </div>
    );
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 my-4">
      <CardContent className="pt-6 pb-5 px-6">
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex-shrink-0">
            <SparklesIcon className="h-5 w-5 text-amber-500" />
          </div>
          <div className="space-y-1.5 flex-1">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              Возможность «{feature}» доступна в тарифе Pro
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Эта функция относится к расширенному набору возможностей Pro.
            </p>
            <div className="flex items-center gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-400/90 font-medium">
              <ShieldAlertIcon className="h-3.5 w-3.5" />
              <span>Оплата временно недоступна. Все базовые функции (чат, диктовка, встреча, свой ключ) работают бесплатно.</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
