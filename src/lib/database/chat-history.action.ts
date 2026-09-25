import { getDatabase } from "./config";
import { ChatConversation } from "@/types";
import { safeLocalStorage } from "@/lib";

// Legacy localStorage key for migration purposes
const LEGACY_CHAT_HISTORY_KEY = "chat_history";

/**
 * Database conversation type (flattened for SQL)
 */
interface DbConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/**
 * Database message type (flattened for SQL)
 */
interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attached_files: string | null; // JSON string
}

/**
 * Safely parse JSON with error handling
 */
function safeJsonParse<T>(jsonString: string | null, fallback: T): T {
  if (!jsonString) return fallback;
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Failed to parse JSON:", error);
    return fallback;
  }
}

/**
 * Validate conversation data
 */
function validateConversation(conversation: ChatConversation): boolean {
  if (!conversation.id || typeof conversation.id !== "string") {
    console.error("Invalid conversation: missing or invalid id");
    return false;
  }
  if (!conversation.title || typeof conversation.title !== "string") {
    console.error("Invalid conversation: missing or invalid title");
    return false;
  }
  if (!Array.isArray(conversation.messages)) {
    console.error("Invalid conversation: messages is not an array");
    return false;
  }
  return true;
}

/**
 * Validate message data
 */
function validateMessage(message: any): boolean {
  if (!message.id || typeof message.id !== "string") {
    console.error("Invalid message: missing or invalid id");
    return false;
  }
  if (
    !message.role ||
    !["user", "assistant", "system"].includes(message.role)
  ) {
    console.error("Invalid message: missing or invalid role");
    return false;
  }
  if (typeof message.content !== "string") {
    console.error("Invalid message: content must be a string");
    return false;
  }
  if (typeof message.timestamp !== "number" || message.timestamp < 0) {
    console.error("Invalid message: invalid timestamp");
    return false;
  }
  return true;
}

/**
 * Create a new conversation with transaction safety
 */
export async function createConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    await db.execute("BEGIN TRANSACTION");

    // Insert conversation
    await db.execute(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [
        conversation.id,
        conversation.title,
        conversation.createdAt || Date.now(),
        conversation.updatedAt || Date.now(),
      ]
    );

    // Batch insert all valid messages
    const validMessages = orderedByTime(conversation.messages).filter(validateMessage);
    if (validMessages.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < validMessages.length; i += BATCH_SIZE) {
        const batch = validMessages.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        const params: unknown[] = [];
        for (const message of batch) {
          const attachedFilesJson = message.attachedFiles
            ? JSON.stringify(message.attachedFiles)
            : null;
          params.push(
            message.id,
            conversation.id,
            message.role,
            message.content,
            message.timestamp,
            attachedFilesJson
          );
        }
        await db.execute(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files) VALUES ${placeholders}`,
          params
        );
      }
    }

    await db.execute("COMMIT");
    return conversation;
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => {});
    console.error("Failed to create conversation:", error);
    // No rollback delete here: the same id can be created concurrently from
    // another window, and this catch also fires on a UNIQUE violation — which
    // would wipe the conversation the other window had just written.
    throw error;
  }
}

/**
 * Get all conversations with messages in a single optimized query
 */
export async function getAllConversations(): Promise<ChatConversation[]> {
  const db = await getDatabase();

  try {
    // Get all conversations
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations ORDER BY updated_at DESC"
    );

    if (conversations.length === 0) {
      return [];
    }

    // Get all messages for these conversations in chunks of at most 100 IDs (MESSAGES_PER_QUERY)
    // to prevent exceeding SQLite parameter limits when history grows.
    const conversationIds = conversations.map((c) => c.id);
    const MESSAGES_PER_QUERY = 100;
    const allMessages: DbMessage[] = [];
    for (let i = 0; i < conversationIds.length; i += MESSAGES_PER_QUERY) {
      const chunk = conversationIds.slice(i, i + MESSAGES_PER_QUERY);
      const placeholders = chunk.map(() => "?").join(",");
      const chunkMessages = await db.select<DbMessage[]>(
        `SELECT * FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, timestamp ASC`,
        chunk
      );
      allMessages.push(...chunkMessages);
    }

    // Group messages by conversation_id
    const messagesByConversation = new Map<string, DbMessage[]>();
    for (const msg of allMessages) {
      if (!messagesByConversation.has(msg.conversation_id)) {
        messagesByConversation.set(msg.conversation_id, []);
      }
      messagesByConversation.get(msg.conversation_id)!.push(msg);
    }

    // Build result
    return conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages:
        messagesByConversation.get(conv.id)?.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          attachedFiles: safeJsonParse(msg.attached_files, undefined),
        })) || [],
    }));
  } catch (error) {
    console.error("Failed to get all conversations:", error);
    throw error;
  }
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(
  id: string
): Promise<ChatConversation | null> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return null;
  }

  const db = await getDatabase();

  try {
    // Get conversation
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations WHERE id = ?",
      [id]
    );

    if (conversations.length === 0) {
      return null;
    }

    const conv = conversations[0];

    // Get messages
    const messages = await db.select<DbMessage[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
      [id]
    );

    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        attachedFiles: safeJsonParse(msg.attached_files, undefined),
      })),
    };
  } catch (error) {
    console.error(`Failed to get conversation ${id}:`, error);
    return null;
  }
}

/**
 * Update a conversation with transaction safety
 */
export async function updateConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    await db.execute("BEGIN TRANSACTION");

    // Update conversation
    const updateResult = await db.execute(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
      [conversation.title, conversation.updatedAt, conversation.id]
    );

    if (updateResult.rowsAffected === 0) {
      await db.execute("ROLLBACK").catch(() => {});
      throw new Error("Conversation not found");
    }

    // Batch insert/replace valid messages
    const validMessages = orderedByTime(conversation.messages).filter(validateMessage);
    const keptIds: string[] = [];

    if (validMessages.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < validMessages.length; i += BATCH_SIZE) {
        const batch = validMessages.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        const params: unknown[] = [];
        for (const message of batch) {
          const attachedFilesJson = message.attachedFiles
            ? JSON.stringify(message.attachedFiles)
            : null;
          params.push(
            message.id,
            conversation.id,
            message.role,
            message.content,
            message.timestamp,
            attachedFilesJson
          );
          keptIds.push(message.id);
        }
        await db.execute(
          `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, attached_files) VALUES ${placeholders}`,
          params
        );
      }
    }

    if (keptIds.length === 0) {
      await db.execute("DELETE FROM messages WHERE conversation_id = ?", [
        conversation.id,
      ]);
    } else if (keptIds.length <= 900) {
      // Single atomic DELETE with all kept IDs. Chunking `NOT IN` was a critical bug (P0-1):
      // chunk 1 deleted everything outside chunk 1, then chunk 2 deleted chunk 1, wiping all rows.
      // For <= 900 messages, all IDs safely fit within SQLite's 999 parameter limit.
      const placeholders = keptIds.map(() => "?").join(", ");
      await db.execute(
        `DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (${placeholders})`,
        [conversation.id, ...keptIds]
      );
    } else {
      // For large conversations exceeding SQLite's parameter limit (>900 messages), delete the
      // complement by selecting existing message IDs and batch-deleting only the IDs to remove with `IN (...)`.
      // Batching `id IN (...)` is safe because deleting a subset never deletes retained IDs.
      const existingRows = await db.select<{ id: string }[]>(
        "SELECT id FROM messages WHERE conversation_id = ?",
        [conversation.id]
      );
      const keptSet = new Set(keptIds);
      const idsToDelete = existingRows
        .map((r) => r.id)
        .filter((id) => !keptSet.has(id));

      const DELETE_BATCH_SIZE = 100;
      for (let i = 0; i < idsToDelete.length; i += DELETE_BATCH_SIZE) {
        const chunk = idsToDelete.slice(i, i + DELETE_BATCH_SIZE);
        const placeholders = chunk.map(() => "?").join(", ");
        await db.execute(
          `DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders})`,
          [conversation.id, ...chunk]
        );
      }
    }

    await db.execute("COMMIT");
    return conversation;
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => {});
    console.error("Failed to update conversation:", error);
    throw error;
  }
}

/**
 * Oldest first: the messages table stamps `conversations.updated_at` for every
 * inserted row, so the last row decides the value. Newest-first input left
 * conversations looking older than their newest message, and retention then
 * purged a chat that was in active use.
 */
function orderedByTime<T extends { timestamp: number }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Save or update a conversation (upsert operation)
 */
export async function saveConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  try {
    const existing = await getConversationById(conversation.id);

    if (existing) {
      return await updateConversation(conversation);
    } else {
      return await createConversation(conversation);
    }
  } catch (error) {
    console.error("Failed to save conversation:", error);
    throw error;
  }
}

/**
 * Delete a conversation and all its messages
 */
export async function deleteConversation(id: string): Promise<boolean> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return false;
  }

  const db = await getDatabase();

  try {
    const result = await db.execute("DELETE FROM conversations WHERE id = ?", [
      id,
    ]);

    return result.rowsAffected > 0;
  } catch (error) {
    console.error(`Failed to delete conversation ${id}:`, error);
    throw error;
  }
}

/**
 * Delete all conversations and messages
 */
export async function deleteAllConversations(): Promise<void> {
  const db = await getDatabase();

  try {
    // Delete in correct order (messages first due to foreign key)
    await db.execute("DELETE FROM messages");
    await db.execute("DELETE FROM conversations");
  } catch (error) {
    console.error("Failed to delete all conversations:", error);
    throw error;
  }
}

/**
 * Return the user message as the conversation title
 */
export function generateConversationTitle(userMessage: string): string {
  return userMessage.trim();
}

/**
 * Migrate chat history from localStorage to SQLite
 * This function safely moves all existing localStorage chat history to the database
 */
export async function migrateLocalStorageToSQLite(): Promise<{
  success: boolean;
  migratedCount: number;
  error?: string;
}> {
  const migrationKey = "chat_history_migrated_to_sqlite";

  try {
    // Check if migration has already been done
    if (safeLocalStorage.getItem(migrationKey) === "true") {
      return { success: true, migratedCount: 0 };
    }

    // Get existing localStorage data
    const existingData = safeLocalStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
    if (!existingData) {
      // No data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Parse localStorage conversations
    let conversations: ChatConversation[] = [];
    try {
      const parsed = JSON.parse(existingData);
      conversations = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.error("Failed to parse localStorage chat history:", parseError);
      // Mark as migrated anyway to prevent repeated failures
      safeLocalStorage.setItem(migrationKey, "true");
      return {
        success: false,
        migratedCount: 0,
        error: "Failed to parse localStorage data",
      };
    }

    if (conversations.length === 0) {
      // No valid data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Get database instance
    const db = await getDatabase();

    // Migrate each conversation
    let migratedCount = 0;
    let errorCount = 0;

    for (const conversation of conversations) {
      try {
        // Validate conversation data
        if (!conversation?.id || !conversation?.title) {
          console.warn("Skipping invalid conversation:", conversation);
          errorCount++;
          continue;
        }

        // Check if conversation already exists in database
        const existing = await getConversationById(conversation.id);
        if (existing) {
          console.log(
            `Conversation ${conversation.id} already exists, skipping`
          );
          continue;
        }

        // Insert conversation
        await db.execute(
          "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
          [
            conversation.id,
            conversation.title,
            conversation.createdAt || Date.now(),
            conversation.updatedAt || Date.now(),
          ]
        );

        // Insert messages
        if (
          Array.isArray(conversation.messages) &&
          conversation.messages.length > 0
        ) {
          for (const message of conversation.messages) {
            // Validate message
            if (
              !message?.id ||
              !message?.role ||
              typeof message?.content !== "string"
            ) {
              console.warn(
                `Skipping invalid message in conversation ${conversation.id}:`,
                message
              );
              continue;
            }

            const attachedFilesJson = message.attachedFiles
              ? JSON.stringify(message.attachedFiles)
              : null;

            await db.execute(
              "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files) VALUES (?, ?, ?, ?, ?, ?)",
              [
                message.id,
                conversation.id,
                message.role,
                message.content,
                message.timestamp || Date.now(),
                attachedFilesJson,
              ]
            );
          }
        }

        migratedCount++;
      } catch (convError) {
        console.error(
          `Failed to migrate conversation ${conversation?.id}:`,
          convError
        );
        errorCount++;
        // Clean up partially migrated conversation
        await db
          .execute("DELETE FROM conversations WHERE id = ?", [conversation?.id])
          .catch(() => {});
      }
    }

    // Only remove the legacy key and mark complete when every conversation migrated successfully (R26).
    // If any failed, preserve the source so data is not lost from both places.
    if (errorCount === 0) {
      safeLocalStorage.setItem(migrationKey, "true");
      safeLocalStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);
    }
    const message =
      errorCount > 0
        ? `Migrated ${migratedCount}/${conversations.length} conversations (${errorCount} failed)`
        : `Successfully migrated ${migratedCount} conversations`;

    console.log(message);

    return {
      success: errorCount === 0,
      migratedCount,
      error:
        errorCount > 0
          ? `${errorCount} conversations failed to migrate`
          : undefined,
    };
  } catch (error) {
    console.error("Migration failed:", error);
    return {
      success: false,
      migratedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
