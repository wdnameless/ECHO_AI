import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "./config";
import type {
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Create a new system prompt
 */
export async function createSystemPrompt(
  input: SystemPromptInput
): Promise<SystemPrompt> {
  // Validate and sanitize input
  const name = input.name.trim();
  const prompt = input.prompt.trim();

  if (!name) {
    throw new Error("System prompt name cannot be empty");
  }

  if (!prompt) {
    throw new Error("System prompt text cannot be empty");
  }

  if (isTauri()) {
    return await invoke<SystemPrompt>("db_create_system_prompt", {
      name,
      prompt,
    });
  }

  const db = await getDatabase();

  const result = await db.execute(
    "INSERT INTO system_prompts (name, prompt) VALUES (?, ?)",
    [name, prompt]
  );

  // Get the last inserted row
  const inserted = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [result.lastInsertId]
  );

  if (!inserted[0]) {
    throw new Error("Failed to retrieve created system prompt");
  }

  return inserted[0];
}

/**
 * Get all system prompts
 */
export async function getAllSystemPrompts(): Promise<SystemPrompt[]> {
  if (isTauri()) {
    return await invoke<SystemPrompt[]>("db_get_all_system_prompts");
  }
  const db = await getDatabase();
  return await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts ORDER BY created_at DESC"
  );
}

/**
 * Get a single system prompt by ID
 */
export async function getSystemPromptById(
  id: number
): Promise<SystemPrompt | null> {
  if (isTauri()) {
    return await invoke<SystemPrompt | null>("db_get_system_prompt_by_id", {
      id,
    });
  }
  const db = await getDatabase();
  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );
  return result[0] || null;
}

/**
 * Update a system prompt
 */
export async function updateSystemPrompt(
  id: number,
  input: UpdateSystemPromptInput
): Promise<SystemPrompt> {
  const name = input.name !== undefined ? input.name.trim() : undefined;
  const prompt = input.prompt !== undefined ? input.prompt.trim() : undefined;

  if (name !== undefined && !name) {
    throw new Error("System prompt name cannot be empty");
  }

  if (prompt !== undefined && !prompt) {
    throw new Error("System prompt text cannot be empty");
  }

  if (name === undefined && prompt === undefined) {
    throw new Error("No fields to update");
  }

  if (isTauri()) {
    return await invoke<SystemPrompt>("db_update_system_prompt", {
      id,
      name: name ?? null,
      prompt: prompt ?? null,
    });
  }

  const db = await getDatabase();

  // Build dynamic update query
  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }

  if (prompt !== undefined) {
    updates.push("prompt = ?");
    values.push(prompt);
  }

  values.push(id);

  await db.execute(
    `UPDATE system_prompts SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );

  if (!result[0]) {
    throw new Error("System prompt not found after update");
  }

  return result[0];
}

/**
 * Delete a system prompt
 */
export async function deleteSystemPrompt(id: number): Promise<void> {
  if (isTauri()) {
    await invoke("db_delete_system_prompt", { id });
    return;
  }
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM system_prompts WHERE id = ?", [
    id,
  ]);

  if (result.rowsAffected === 0) {
    throw new Error("System prompt not found");
  }
}
