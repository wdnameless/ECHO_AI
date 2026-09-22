import { useState } from "react";
import { TYPE_PROVIDER } from "@/types";
import { AI_PROVIDERS } from "@/config";
import { useApp } from "@/contexts";
import {
  getCustomAiProviders,
  addCustomAiProvider,
  updateCustomAiProvider,
  removeCustomAiProvider,
  validateCurl,
} from "@/lib";
import {
  extractLiteralSecret,
  removeSecret,
  saveSecret,
  secretKey,
} from "@/lib/storage/secret-store";

export function useCustomAiProviders() {
  const { loadData, selectedAIProvider } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState<TYPE_PROVIDER>({
    id: "",
    streaming: false,
    responseContentPath: "",
    isCustom: true,
    curl: "",
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  /**
   * Provider that still has to be made active, with the values the form collected.
   *
   * The selection cannot happen here: `onSetSelectedAIProvider` rejects an id that
   * is not yet in `allAiProviders`, and that list only catches up after React
   * re-renders with the reloaded data. The consumer applies this once the list has
   * caught up.
   */
  const [pendingSelect, setPendingSelect] = useState<{
    id: string;
    variables: Record<string, string>;
  } | null>(null);

  const handleEdit = (providerId: string) => {
    const customProviders = getCustomAiProviders();
    const provider = customProviders.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
    });
    setEditingProvider(providerId);
    setShowForm(!showForm);
    setErrors({});
  };

  const handleAutoFill = (providerId: string) => {
    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
      curl: provider.curl,
    });

    setErrors({});
  };

  const handleDelete = (providerId: string) => {
    setDeleteConfirm(providerId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const success = removeCustomAiProvider(deleteConfirm);
      if (success) {
        // The key lives in the backend store, not in the provider record:
        // without this it stayed there with nothing left to reference it.
        await removeSecret(secretKey.aiProvider(deleteConfirm)).catch(() => {});
        setDeleteConfirm(null);
        loadData(); // Refresh data
      }
    } catch (error) {
      console.error("Error deleting custom provider:", error);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  /**
   * Persists the provider form.
   *
   * The visual form deliberately keeps `{{API_KEY}}` / `{{MODEL}}` placeholders in
   * the curl: values typed into the form are stored as secrets and provider
   * variables, never as plaintext inside a template that lives in localStorage.
   * Returns the id of the saved provider, or null when validation failed.
   */
  const handleSave = async (values?: { apiKey?: string; model?: string }) => {
    // Validate form
    const newErrors: { [key: string]: string } = {};

    if (!formData.curl.trim()) {
      newErrors.curl = "Curl command is required";
    } else {
      const validation = validateCurl(formData.curl, ["TEXT"]);
      if (!validation.isValid) {
        newErrors.curl = validation.message || "";
      }
    }

    if (!formData.responseContentPath?.trim()) {
      newErrors.responseContentPath = "Response content path is required";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return null;
    }

    // A key pasted into the raw curl must not reach storage in plaintext either:
    // pull it out and let the template keep the placeholder.
    const { curl: sanitizedCurl, secret: literalKey } = extractLiteralSecret(
      formData.curl
    );
    const key = (values?.apiKey?.trim() || literalKey || "").trim();
    const model = values?.model?.trim() ?? "";
    // Only a template that asks for {{MODEL}} gets the value as a variable. When
    // the model is a literal in the curl, that literal stays the single source of
    // truth — a stale variable would otherwise silently override it at request time.
    const variables: Record<string, string> =
      model && sanitizedCurl.includes("{{MODEL}}") ? { MODEL: model } : {};

    try {
      if (editingProvider) {
        // Update existing provider
        const success = updateCustomAiProvider(editingProvider, {
          curl: sanitizedCurl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        });

        if (success) {
          if (key) {
            await saveSecret(secretKey.aiProvider(editingProvider), key);
          } else {
            // An emptied field means "remove the key", not "keep the old one".
            await removeSecret(secretKey.aiProvider(editingProvider));
          }
          if (selectedAIProvider.provider === editingProvider) {
            setPendingSelect({ id: editingProvider, variables });
          }
          setEditingProvider(null);
          setShowForm(false);
          setFormData({
            id: "",
            streaming: false,
            responseContentPath: "",
            isCustom: true,
            curl: "",
          });
          loadData(); // Refresh data
          return editingProvider;
        }
        return null;
      } else {
        // Create new provider
        const newProvider = {
          curl: sanitizedCurl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        };

        // A provider without an id never made it into storage.
        const savedId = addCustomAiProvider(newProvider)?.id ?? null;
        if (!savedId) return null;

        if (key) {
          await saveSecret(secretKey.aiProvider(savedId), key);
        }
        // Adding a provider means "use this provider": otherwise the app keeps
        // answering through the previous one and the user sees errors that
        // belong to a provider they are no longer looking at.
        setPendingSelect({ id: savedId, variables });
        setShowForm(false);
        setFormData({
          id: "",
          streaming: false,
          responseContentPath: "",
          isCustom: true,
          curl: "",
        });
        loadData(); // Refresh data
        return savedId;
      }
    } catch (error) {
      console.error("Error saving custom provider:", error);
      return null;
    }
  };

  return {
    errors,
    setErrors,
    showForm,
    setShowForm,
    editingProvider,
    setEditingProvider,
    deleteConfirm,
    formData,
    setFormData,
    handleSave,
    pendingSelect,
    clearPendingSelect: () => setPendingSelect(null),
    handleAutoFill,
    handleEdit,
    handleDelete,
    confirmDelete,
    cancelDelete,
  };
}
