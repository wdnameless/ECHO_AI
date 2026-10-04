import { useState, useEffect, useRef } from "react";
import {
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useWindowResize } from "@/hooks";
import {
  PortableUpdateNotice,
  useIsPortable,
  checkForUpdateForLayout,
  installUpdateForLayout,
} from "./PortableUpdateNotice";

export * from "./PortableUpdateNotice";

type UpdateState =
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error"
  | "uptodate"
  | "failed";

interface DownloadProgress {
  downloaded: number;
  contentLength: number;
  percentage: number;
}

export const Updater = () => {
  const [updateState, setUpdateState] = useState<UpdateState>("uptodate");
  const [update, setUpdate] = useState<Update | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    contentLength: 0,
    percentage: 0,
  });

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [manualClose, setManualClose] = useState(false);

  // Keeps notice visible in popover when running from a portable directory.
  const isPortable = useIsPortable();
  const { resizeWindow } = useWindowResize();

  const checkForUpdates = async () => {
    try {
      setErrorMessage(null);
      setUpdateState("checking");

      const foundUpdate = await checkForUpdateForLayout();
      if (foundUpdate) {
        setUpdate(foundUpdate);
        setUpdateState("available");
      } else {
        setUpdateState("uptodate");
      }
    } catch (err: unknown) {
      console.error("Failed to check for updates:", err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setUpdateState("error");
    }
  };

  const downloadAndInstall = async () => {
    if (!update) return;

    try {
      setErrorMessage(null);
      setUpdateState("downloading");
      setProgress({ downloaded: 0, contentLength: 0, percentage: 0 });

      const shouldRelaunch = await installUpdateForLayout(update, (event) => {
        switch (event.event) {
          case "Started":
            setProgress((prev) => ({
              ...prev,
              contentLength: event.data.contentLength || 0,
            }));
            break;

          case "Progress":
            setProgress((prev) => {
              const downloaded = prev.downloaded + event.data.chunkLength;
              const percentage =
                prev.contentLength > 0
                  ? Math.round((downloaded / prev.contentLength) * 100)
                  : 0;

              return {
                downloaded,
                contentLength: prev.contentLength,
                percentage,
              };
            });
            break;

          case "Finished":
            setUpdateState("installing");
            break;
        }
      });

      setUpdateState("ready");

      if (shouldRelaunch) {
        // Auto-relaunch after a short delay to show success state
        setTimeout(async () => {
          await relaunch();
        }, 2000);
      }
    } catch (err: unknown) {
      console.error("Failed to download/install update:", err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setUpdateState("failed");
      // Keep the popover open so user can try again
      setIsPopoverOpen(true);
    }
  };

  // Check for updates on component mount
  useEffect(() => {
    checkForUpdates();
  }, []);

  // Handle window resizing when popover opens/closes
  const initialMount = useRef(true);
  const heightBeforeOpenRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (isPopoverOpen) {
      heightBeforeOpenRef.current = window.innerHeight;
      resizeWindow(true);
    } else {
      const prevHeight = heightBeforeOpenRef.current;
      if (prevHeight !== null && prevHeight > 54) {
        // Keep the height the user had instead of letting close path collapse it
        return;
      }
      resizeWindow(false);
    }
  }, [isPopoverOpen, resizeWindow]);

  // Helper functions for button state
  const getButtonContent = () => {
    switch (updateState) {
      case "downloading":
        return (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Downloading... {progress.percentage}%
          </>
        );
      case "installing":
        return (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Installing...
          </>
        );
      case "ready":
        return (
          <>
            <CheckCircle className="mr-2 h-4 w-4" />
            Ready - Restarting...
          </>
        );
      case "error":
      case "failed":
        return (
          <>
            <AlertCircle className="mr-2 h-4 w-4" />
            Try Again
          </>
        );
      default:
        return (
          <>
            <Download className="mr-2 h-4 w-4" />
            Download & Install Update
          </>
        );
    }
  };

  const getButtonDisabled = () => {
    return ["downloading", "installing", "ready"].includes(updateState);
  };

  const getButtonOnClick = () => {
    return updateState === "error" ? checkForUpdates : downloadAndInstall;
  };

  // Handle popover open/close with manual control
  const handlePopoverOpenChange = (open: boolean) => {
    // Prevent closing during active operations unless manually triggered
    const isActiveOperation = ["downloading", "installing", "ready"].includes(
      updateState
    );

    if (open) {
      setIsPopoverOpen(true);
      setManualClose(false);
    } else if (!isActiveOperation || manualClose) {
      setIsPopoverOpen(false);
      setManualClose(false);
    }
  };

  // Handle manual trigger click
  const handleTriggerClick = () => {
    setManualClose(!isPopoverOpen);
    setIsPopoverOpen(!isPopoverOpen);
  };

  // Only show updater when there's an update available or during active operations
  if (updateState === "uptodate") {
    return null;
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          onClick={handleTriggerClick}
          className="cursor-pointer"
          disabled={updateState === "checking"}
          title={
            updateState === "error"
              ? "Update check failed"
              : `Update available: ${update?.version ?? ""}`
          }
          aria-label={
            updateState === "error"
              ? "Update check failed"
              : `Update available: ${update?.version ?? ""}`
          }
        >
          {updateState === "checking" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : updateState === "error" ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className="select-none w-screen p-0 border overflow-hidden border-input/50"
        sideOffset={8}
      >
        <ScrollArea className="panel-fill-md">
          <div className="p-6 space-y-4">
            {/* Update Header */}
            <div className="border-b border-input/50 pb-2">
              <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                {updateState === "error" ? "Update Error" : "Update Available"}
              </h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {updateState === "error"
                  ? "Failed to check or download updates. Please try again."
                  : `A new version (${update?.version}) is available. Here's what's new:`}
              </p>
            </div>

            {isPortable && <PortableUpdateNotice />}

            {/* Release Notes */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {update?.body ? (
                <Markdown>{update.body}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Release notes not available for this version.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Fixed Download Section */}
        <div className="border-t border-input/50 p-4 space-y-3">
          {errorMessage && (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs text-destructive leading-relaxed"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </p>
          )}
          <Button
            onClick={getButtonOnClick()}
            disabled={getButtonDisabled()}
            className="w-full"
            variant={updateState === "failed" || updateState === "error" ? "destructive" : "default"}
          >
            {getButtonContent()}
          </Button>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Having trouble downloading?{" "}
              <a
                href={"https://github.com/wdnameless/ECHO_AI/releases"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 underline inline-flex items-center gap-1"
              >
                Download manually
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
