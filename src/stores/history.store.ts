import { create } from "zustand";
import { registerStoreReset } from "./reset";
import {
  getAllConversations,
  deleteConversation,
  DOWNLOAD_SUCCESS_DISPLAY_MS,
  downloadBlob,
  generateConversationMarkdown,
} from "@/lib";
import { ChatConversation } from "@/types/completion";

export interface HistoryState {
  conversations: ChatConversation[];
  selectedConversationId: string | null;
  viewingConversation: ChatConversation | null;
  downloadedConversations: Set<string>;
  deleteConfirm: string | null;
  isDownloaded: boolean;
  isAttached: boolean;
  search: string;
  isLoading: boolean;

  setConversations: (
    updater:
      | ChatConversation[]
      | ((prev: ChatConversation[]) => ChatConversation[])
  ) => void;
  setSearch: (search: string) => void;
  setSelectedConversationId: (id: string | null) => void;
  setViewingConversation: (conversation: ChatConversation | null) => void;
  handleViewConversation: (conversation: ChatConversation) => void;
  handleDownloadConversation: (
    conversation: ChatConversation,
    e?: React.MouseEvent
  ) => void;
  handleDeleteConfirm: (conversationId: string) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
  handleAttachToOverlay: (conversationId: string) => void;
  handleDownload: (
    conversation: ChatConversation | null,
    e?: React.MouseEvent
  ) => void;
  refreshConversations: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  viewingConversation: null,
  downloadedConversations: new Set(),
  deleteConfirm: null,
  isDownloaded: false,
  isAttached: false,
  search: "",
  isLoading: false,

  setConversations: (updater) => {
    const next =
      typeof updater === "function" ? updater(get().conversations) : updater;
    set({ conversations: next });
  },

  setSearch: (search: string) => set({ search }),

  setSelectedConversationId: (id: string | null) =>
    set({ selectedConversationId: id }),

  setViewingConversation: (conversation: ChatConversation | null) =>
    set({ viewingConversation: conversation }),

  handleViewConversation: (conversation: ChatConversation) => {
    set({ viewingConversation: conversation });
  },

  handleDownloadConversation: (
    conversation: ChatConversation,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();

    set((state) => ({
      downloadedConversations: new Set(state.downloadedConversations).add(
        conversation.id
      ),
    }));

    try {
      const markdown = generateConversationMarkdown(conversation);
      const blob = new Blob([markdown], { type: "text/markdown" });
      const sanitized = conversation.title
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
      downloadBlob(blob, `${sanitized.substring(0, 16)}.md`);
    } catch (error) {
      console.error("Failed to download conversation:", error);
      set((state) => {
        const next = new Set(state.downloadedConversations);
        next.delete(conversation.id);
        return { downloadedConversations: next };
      });
      return;
    }

    setTimeout(() => {
      set((state) => {
        const next = new Set(state.downloadedConversations);
        next.delete(conversation.id);
        return { downloadedConversations: next };
      });
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  },

  handleDeleteConfirm: (conversationId: string) => {
    set({ deleteConfirm: conversationId });
  },

  confirmDelete: async () => {
    const { deleteConfirm } = get();
    if (!deleteConfirm) return;

    try {
      set({
        selectedConversationId: null,
        viewingConversation: null,
      });
      await deleteConversation(deleteConfirm);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== deleteConfirm),
      }));

      window.dispatchEvent(
        new CustomEvent("conversationDeleted", {
          detail: deleteConfirm,
        })
      );
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    } finally {
      set({ deleteConfirm: null });
    }
  },

  cancelDelete: () => {
    set({ deleteConfirm: null });
  },

  handleAttachToOverlay: (conversationId: string) => {
    localStorage.setItem(
      "pluely-conversation-selected",
      JSON.stringify({ id: conversationId, timestamp: Date.now() })
    );
    set({ isAttached: true });
    setTimeout(() => {
      set({ isAttached: false });
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  },

  handleDownload: (
    conversation: ChatConversation | null,
    e?: React.MouseEvent
  ) => {
    if (conversation) {
      get().handleDownloadConversation(conversation, e);
      set({ isDownloaded: true });
      setTimeout(() => {
        set({ isDownloaded: false });
      }, DOWNLOAD_SUCCESS_DISPLAY_MS);
    }
  },

  refreshConversations: async () => {
    try {
      set({ isLoading: true });
      const loaded = await getAllConversations();
      set({ conversations: loaded });
    } catch (error) {
      console.error("Failed to load conversations:", error);
      set({ conversations: [] });
    } finally {
      set({ isLoading: false });
    }
  },
}));

export const initialHistoryState: HistoryState = useHistoryStore.getState();

export const resetHistoryStore = () => {
  useHistoryStore.setState(
    {
      ...initialHistoryState,
      downloadedConversations: new Set(),
    },
    true
  );
};

registerStoreReset(resetHistoryStore);
