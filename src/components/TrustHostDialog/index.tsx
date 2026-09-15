import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface TrustHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: string;
  secrets: string[];
  onTrustAndSend: () => void;
  onSendWithoutKey: () => void;
  onCancel: () => void;
}

export const TrustHostDialog = ({
  open,
  onOpenChange,
  host,
  secrets,
  onTrustAndSend,
  onSendWithoutKey,
  onCancel,
}: TrustHostDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive font-semibold">
            Внимание: запрос на внешний хост
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-2 text-sm text-foreground/80">
            <div>
              Приложение собирается отправить запрос на недоверенный хост:
              <div className="font-mono text-xs bg-muted p-2 rounded mt-1 break-all text-foreground">
                {host}
              </div>
            </div>
            {secrets.length > 0 ? (
              <div>
                В запросе содержатся следующие секретные переменные:
                <ul className="list-disc list-inside font-mono text-xs text-destructive mt-1">
                  {secrets.map((secret) => (
                    <li key={secret}>{secret}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Заголовки авторизации или ключи в этом запросе не обнаружены.
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSendWithoutKey}
          >
            Отправить без ключа
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onTrustAndSend}
          >
            Доверять и отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
