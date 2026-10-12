import { getAllConversations } from "./chat-history.action";
import type { ChatConversation } from "@/types";

function formatConversationMarkdown(conversation: ChatConversation): string {
  let md = `# ${conversation.title}\n\n`;
  md += `**Created:** ${new Date(conversation.createdAt).toISOString()}\n`;
  md += `**Updated:** ${new Date(conversation.updatedAt).toISOString()}\n`;
  md += `**Messages:** ${conversation.messages?.length ?? 0}\n\n---\n\n`;

  conversation.messages?.forEach((message) => {
    const role = (message.role || "unknown").toUpperCase();
    md += `## ${role}\n\n${message.content}\n\n`;
  });

  return md.trim();
}

/**
 * Export conversation history in markdown or JSON format.
 * Supports exporting all conversations or a subset by conversationIds.
 */
export async function exportHistory(
  format: "md" | "json",
  conversationIds?: string[]
): Promise<Blob> {
  const all = await getAllConversations();
  const target = conversationIds
    ? all.filter((c) => conversationIds.includes(c.id))
    : all;

  if (format === "json") {
    return new Blob([JSON.stringify(target, null, 2)], {
      type: "application/json",
    });
  }

  const markdown = target.map(formatConversationMarkdown).join("\n\n---\n\n");
  return new Blob([markdown], {
    type: "text/markdown",
  });
}

/**
 * Trigger browser download for a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
