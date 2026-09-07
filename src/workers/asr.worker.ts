/**
 * Dedicated Web Worker for WebSocket streaming to pluely-asr sidecar.
 * Offloads WebSocket connection management, reconnect timer, and binary audio streaming
 * off the main UI thread to prevent lost segments during main thread contention.
 */

export interface AsrWorkerInitMsg {
  type: "init";
  wsUrl: string;
  language: string;
}

export interface AsrWorkerAudioMsg {
  type: "audio";
  buffer: ArrayBuffer;
}

export interface AsrWorkerFinalizeMsg {
  type: "finalize";
}

export interface AsrWorkerCloseMsg {
  type: "close";
}

export type AsrWorkerInMessage =
  | AsrWorkerInitMsg
  | AsrWorkerAudioMsg
  | AsrWorkerFinalizeMsg
  | AsrWorkerCloseMsg;

export interface AsrWorkerTextEvent {
  type: "text";
  text: string;
}

export interface AsrWorkerOpenEvent {
  type: "open";
}

export interface AsrWorkerCloseEvent {
  type: "close";
}

export interface AsrWorkerErrorEvent {
  type: "error";
  message?: string;
}

export type AsrWorkerOutMessage =
  | AsrWorkerTextEvent
  | AsrWorkerOpenEvent
  | AsrWorkerCloseEvent
  | AsrWorkerErrorEvent;

let ws: WebSocket | null = null;
let language = "en";

function closeSocket() {
  if (ws) {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
}

self.onmessage = (e: MessageEvent<AsrWorkerInMessage>) => {
  const data = e.data;
  if (!data) return;

  switch (data.type) {
    case "init": {
      closeSocket();
      language = data.language || "en";
      try {
        ws = new WebSocket(data.wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          try {
            ws?.send(JSON.stringify({ type: "config", language }));
          } catch {
            // ignore
          }
          self.postMessage({ type: "open" } satisfies AsrWorkerOutMessage);
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") return;
          try {
            const msg = JSON.parse(ev.data);
            if (
              msg.type === "text" &&
              typeof msg.text === "string" &&
              msg.text.trim()
            ) {
              self.postMessage({
                type: "text",
                text: msg.text.trim(),
              } satisfies AsrWorkerOutMessage);
            } else if (msg.type === "error") {
              self.postMessage({
                type: "error",
                message: msg.message,
              } satisfies AsrWorkerOutMessage);
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onclose = () => {
          ws = null;
          self.postMessage({ type: "close" } satisfies AsrWorkerOutMessage);
        };

        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            // ignore
          }
          ws = null;
          self.postMessage({ type: "error" } satisfies AsrWorkerOutMessage);
        };
      } catch (err) {
        self.postMessage({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        } satisfies AsrWorkerOutMessage);
      }
      break;
    }

    case "audio": {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data.buffer);
        } catch {
          // ignore
        }
      }
      break;
    }

    case "finalize": {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "finalize" }));
        } catch {
          // ignore
        }
        setTimeout(() => {
          closeSocket();
          self.postMessage({ type: "close" } satisfies AsrWorkerOutMessage);
        }, 400);
      } else {
        closeSocket();
        self.postMessage({ type: "close" } satisfies AsrWorkerOutMessage);
      }
      break;
    }

    case "close": {
      closeSocket();
      break;
    }
  }
};
