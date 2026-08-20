import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getHumanizerSettings,
  setHumanizerSettings,
} from "@/config/humanizer.rules";
import type { HumanizerSettings } from "@/config/humanizer.rules";

export function HumanizerSettings() {
  const [settings, setSettings] = useState<HumanizerSettings>({
    enabled: false,
    interviewMode: false,
    customStyle: "",
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getHumanizerSettings());
    setLoading(false);
  }, []);

  const handleSave = useCallback(() => {
    setHumanizerSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  return (
    <div id="humanizer-settings" className="space-y-3">
      <Header
        title="Humanizer"
        description="Make answers sound like a real person - no AI traces"
        isMainTitle
        rightSlot={
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, enabled: v }))
              }
            />
            <span className="text-sm text-muted-foreground">
              {settings.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        }
      />
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Interview mode</p>
          <p className="text-xs text-muted-foreground">
            Answer as the candidate, 150-220 words, grounded in resume &amp; job
          </p>
        </div>
        <Switch
          checked={settings.interviewMode}
          onCheckedChange={(v) =>
            setSettings((s) => ({ ...s, interviewMode: v }))
          }
        />
      </div>
      <Textarea
        value={settings.customStyle}
        onChange={(e) =>
          setSettings((s) => ({ ...s, customStyle: e.target.value }))
        }
        placeholder="My speaking style (e.g. short sentences, direct, a bit informal, use examples from my projects)..."
        className="min-h-[100px]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        {saved && <span className="text-xs text-green-500">Saved</span>}
      </div>
    </div>
  );
}
