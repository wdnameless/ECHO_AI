import { useEffect } from "react";
import { useHistoryStore } from "@/stores";
import { ChatConversation } from "@/types/completion";

export type UseHistoryType = UseHistoryReturn;

export interface UseHistoryReturn {
  // State
  conversations: ChatConversation[];
  selectedConversationId: string | null;
  viewingConversation: ChatConversation | null;
  downloadedConversations: Set<string>;
  deleteConfirm: string | null;
  isDownloaded: boolean;
  isAttached: boolean;

  // Actions
  handleViewConversation: (conversation: ChatConversation) => void;
  handleDownloadConversation: (
    conversation: ChatConversation,
    e?: React.MouseEvent
  ) => void;
  handleDeleteConfirm: (conversationId: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  handleAttachToOverlay: (conversationId: string) => void;
  handleDownload: (
    conversation: ChatConversation | null,
    e?: React.MouseEvent
  ) => void;
  search: string;
  setSearch: (search: string) => void;
  // Utilities
  refreshConversations: () => void;
  isLoading: boolean;
}

export function useHistory(): UseHistoryReturn {
  const store = useHistoryStore();

  useEffect(() => {
    store.refreshConversations();
  }, []);

  return store as unknown as UseHistoryReturn;
}
