import { GithubIcon } from "@/components";
import { Button } from "@/components/ui/button";
import { GlobeIcon, ExternalLinkIcon } from "lucide-react";

export const AuthorBanner = () => {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm select-none">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">Echo AI</span>
          <span className="text-[10px] font-medium bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
            nullform.cv edition
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Autonomous real-time AI copilot with Vulkan GPU STT, live subtitles, and adaptive self-evolution.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={() => window.open("https://nullform.cv", "_blank")}
        >
          <GlobeIcon className="w-3.5 h-3.5 text-primary" />
          <span>nullform.cv</span>
          <ExternalLinkIcon className="w-3 h-3 opacity-60" />
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={() => window.open("https://github.com/wdnameless/pluely", "_blank")}
        >
          <GithubIcon className="w-3.5 h-3.5" />
          <span>GitHub Repo</span>
          <ExternalLinkIcon className="w-3 h-3 opacity-60" />
        </Button>
      </div>
    </div>
  );
};

export default AuthorBanner;
