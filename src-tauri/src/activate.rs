use crate::api::get_stored_credentials;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_machine_uid::MachineUidExt;
use uuid::Uuid;

fn get_payment_endpoint() -> Result<String, String> {
    if let Ok(endpoint) = env::var("PAYMENT_ENDPOINT") {
        return Ok(endpoint);
    }

    Ok("https://ai-gateway.nullform.cv/v1".to_string())
}

fn get_api_access_key() -> Result<String, String> {
    if let Ok(key) = env::var("API_ACCESS_KEY") {
        return Ok(key);
    }

    Ok("".to_string())
}

// Secure storage file path resolved according to active mode (portable or app data)
fn get_secure_storage_path(_app: &AppHandle) -> Result<PathBuf, String> {
    crate::settings::ensure_secure_storage_path()
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SecureStorage {
    #[serde(default)]
    pub license_key: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub selected_pluely_model: Option<String>,
    /// Произвольные секреты (ключи провайдеров, поисковых сервисов).
    /// Flatten сохраняет обратную совместимость: файл, записанный прежней
    /// версией, читается без изменений, а новые ключи ложатся рядом.
    #[serde(default, flatten)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageItem {
    key: String,
    value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageResult {
    license_key: Option<String>,
    instance_id: Option<String>,
    selected_pluely_model: Option<String>,
}

#[cfg(target_os = "windows")]
mod dpapi {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    const MAGIC_HEADER: &[u8] = b"DPAPI\x01";

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        unsafe {
            CryptProtectData(
                &data_in,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
            .map_err(|e| format!("CryptProtectData failed: {}", e))?;

            if data_out.pbData.is_null() {
                return Err("CryptProtectData produced null output".to_string());
            }

            let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
            let mut result = Vec::with_capacity(MAGIC_HEADER.len() + slice.len());
            result.extend_from_slice(MAGIC_HEADER);
            result.extend_from_slice(slice);

            let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(data_out.pbData as *mut _)));
            Ok(result)
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        if !data.starts_with(MAGIC_HEADER) {
            // Legacy / unencrypted plaintext JSON format: return raw bytes for serde_json
            return Ok(data.to_vec());
        }

        let encrypted = &data[MAGIC_HEADER.len()..];
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        unsafe {
            CryptUnprotectData(
                &data_in,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
            .map_err(|e| format!("CryptUnprotectData failed: {}", e))?;

            if data_out.pbData.is_null() {
                return Err("CryptUnprotectData produced null output".to_string());
            }

            let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
            let result = slice.to_vec();

            let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(data_out.pbData as *mut _)));
            Ok(result)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

/// Reads the secure-storage file, applying DPAPI on Windows.
///
/// Public because `api::get_stored_credentials` needs the same format handling:
/// it must accept the legacy plaintext file AND the encrypted one, and its own
/// local struct dropped the flattened provider keys.
pub fn load_secure_storage(storage_path: &std::path::Path) -> Result<SecureStorage, String> {
    if !storage_path.exists() {
        return Ok(SecureStorage::default());
    }

    let raw = fs::read(storage_path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;
    let decrypted = dpapi::unprotect(&raw)?;
    serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Failed to parse storage file: {}", e))
}

fn save_secure_storage(storage_path: &std::path::Path, storage: &SecureStorage) -> Result<(), String> {
    let content = serde_json::to_vec(storage)
        .map_err(|e| format!("Failed to serialize storage: {}", e))?;
    let protected = dpapi::protect(&content)?;
    fs::write(storage_path, protected)
        .map_err(|e| format!("Failed to write storage file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn secure_storage_save(app: AppHandle, items: Vec<StorageItem>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;
    let mut storage = load_secure_storage(&storage_path)?;

    for item in items {
        match item.key.as_str() {
            "pluely_license_key" => storage.license_key = Some(item.value),
            "pluely_instance_id" => storage.instance_id = Some(item.value),
            "selected_pluely_model" => storage.selected_pluely_model = Some(item.value),
            other => {
                storage.extra.insert(other.to_string(), item.value);
            }
        }
    }

    save_secure_storage(&storage_path, &storage)
}

#[tauri::command]
pub async fn secure_storage_get(app: AppHandle) -> Result<StorageResult, String> {
    let storage_path = get_secure_storage_path(&app)?;
    let storage = load_secure_storage(&storage_path)?;

    Ok(StorageResult {
        license_key: storage.license_key,
        instance_id: storage.instance_id,
        selected_pluely_model: storage.selected_pluely_model,
    })
}

/// Читает один секрет по ключу: сначала известные поля лицензии, затем
/// произвольные секреты. Отсутствие ключа — не ошибка, а `None`.
#[tauri::command]
pub async fn secure_storage_get_item(
    app: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let storage_path = get_secure_storage_path(&app)?;
    let storage = load_secure_storage(&storage_path)?;

    let value = match key.as_str() {
        "pluely_license_key" => storage.license_key,
        "pluely_instance_id" => storage.instance_id,
        "selected_pluely_model" => storage.selected_pluely_model,
        other => storage.extra.get(other).cloned(),
    };

    Ok(value)
}

#[tauri::command]
pub async fn secure_storage_remove(app: AppHandle, keys: Vec<String>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;
    if !storage_path.exists() {
        return Ok(());
    }

    let mut storage = load_secure_storage(&storage_path)?;

    for key in keys {
        match key.as_str() {
            "pluely_license_key" => storage.license_key = None,
            "pluely_instance_id" => storage.instance_id = None,
            "selected_pluely_model" => storage.selected_pluely_model = None,
            other => {
                storage.extra.remove(other);
            }
        }
    }

    save_secure_storage(&storage_path, &storage)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivationRequest {
    license_key: String,
    instance_name: String,
    machine_id: String,
    app_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivationResponse {
    activated: bool,
    error: Option<String>,
    license_key: Option<String>,
    instance: Option<InstanceInfo>,
    is_dev_license: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateResponse {
    pub is_active: bool,
    pub last_validated_at: Option<String>,
    pub is_dev_license: bool,
}

impl ValidateResponse {
    pub fn is_active(&self) -> bool {
        self.is_active
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct InstanceInfo {
    id: String,
    name: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckoutResponse {
    success: Option<bool>,
    checkout_url: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn activate_license_api(
    app: AppHandle,
    license_key: String,
) -> Result<ActivationResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;

    // Generate UUID for instance name
    let instance_name = Uuid::new_v4().to_string();
    let machine_id: String = match app.machine_uid().get_machine_uid() {
        Ok(id) => id.id.unwrap_or_default(),
        Err(_) => String::new(),
    };
    let app_version: String = env!("CARGO_PKG_VERSION").to_string();
    // Prepare activation request
    let activation_request = ActivationRequest {
        license_key: license_key.clone(),
        instance_name: instance_name.clone(),
        machine_id: machine_id.clone(),
        app_version: app_version.clone(),
    };

    // Make HTTP request to activation endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/activate", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&activation_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;

    let activation_response: ActivationResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(activation_response)
}

#[tauri::command]
pub async fn deactivate_license_api(app: AppHandle) -> Result<ActivationResponse, String> {
    // Get payment endpoint and API access key from environment
    let payment_endpoint = get_payment_endpoint()?;
    let api_access_key = get_api_access_key()?;
    let machine_id: String = match app.machine_uid().get_machine_uid() {
        Ok(id) => id.id.unwrap_or_default(),
        Err(_) => String::new(),
    };
    let (license_key, instance_id, _) = get_stored_credentials(&app).await?;
    let app_version: String = env!("CARGO_PKG_VERSION").to_string();
    let deactivation_request = ActivationRequest {
        license_key: license_key.clone(),
        instance_name: instance_id.clone(),
        machine_id: machine_id.clone(),
        app_version: app_version.clone(),
    };
    // Make HTTP request to activation endpoint with authorization header
    let client = reqwest::Client::new();
    let url = format!("{}/deactivate", payment_endpoint);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_access_key))
        .json(&deactivation_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("{}", e);
            if error_msg.contains("url (") {
                // Remove the URL part from the error message
                let parts: Vec<&str> = error_msg.split(" for url (").collect();
                if parts.len() > 1 {
                    format!("Failed to make chat request: {}", parts[0])
                } else {
                    format!("Failed to make chat request: {}", error_msg)
                }
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        })?;
    let deactivation_response: ActivationResponse = response.json().await.map_err(|e| {
        let error_msg = format!("{}", e);
        if error_msg.contains("url (") {
            // Remove the URL part from the error message
            let parts: Vec<&str> = error_msg.split(" for url (").collect();
            if parts.len() > 1 {
                format!("Failed to make chat request: {}", parts[0])
            } else {
                format!("Failed to make chat request: {}", error_msg)
            }
        } else {
            format!("Failed to make chat request: {}", error_msg)
        }
    })?;
    Ok(deactivation_response)
}

#[tauri::command]
pub async fn validate_license_api(_app: AppHandle) -> Result<ValidateResponse, String> {
    // Without server validation, return inactive license
    Ok(ValidateResponse {
        is_active: false,
        last_validated_at: None,
        is_dev_license: false,
    })
}

#[tauri::command]
pub fn mask_license_key_cmd(license_key: String) -> String {
    if license_key.chars().count() <= 8 {
        return "*".repeat(license_key.chars().count());
    }

    // Counted in characters, not bytes: slicing a key that contains any
    // non-ASCII character on a byte offset panics.
    let chars: Vec<char> = license_key.chars().collect();
    let first_four: String = chars[..4].iter().collect();
    let last_four: String = chars[chars.len() - 4..].iter().collect();
    let middle_stars = "*".repeat(chars.len() - 8);

    format!("{}{}{}", first_four, middle_stars, last_four)
}

#[tauri::command]
pub async fn get_checkout_url() -> Result<CheckoutResponse, String> {
    // Payment is disabled/unavailable (placeholder per R29)
    Ok(CheckoutResponse {
        success: Some(false),
        checkout_url: None,
        error: Some("Payment checkout is currently unavailable".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpapi_roundtrip() {
        let plaintext = b"{\"api_key\":\"sk-test-secret-12345\"}";
        let protected = dpapi::protect(plaintext).expect("protect failed");
        #[cfg(target_os = "windows")]
        assert!(protected.starts_with(b"DPAPI\x01"));

        let decrypted = dpapi::unprotect(&protected).expect("unprotect failed");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_dpapi_legacy_passthrough() {
        let legacy_plaintext = b"{\"license_key\":\"legacy-key\"}";
        let result = dpapi::unprotect(legacy_plaintext).expect("legacy unprotect failed");
        assert_eq!(result, legacy_plaintext);
    }

    /// The loader must survive both file formats AND keep the flattened secrets.
    ///
    /// `api::get_stored_credentials` used to do its own `fs::read_to_string` +
    /// `serde_json::from_str` with a local struct that had no `extra` field. Two
    /// consequences, both pinned here:
    ///
    ///  * `read_to_string` cannot read the encrypted file — DPAPI output is
    ///    binary, so UTF-8 decoding fails and every licence call errors;
    ///  * the flattened provider keys that share the file with `license_key`
    ///    were parsed away (and a later save would have dropped them).
    #[test]
    fn test_load_secure_storage_reads_both_formats_and_keeps_extra() {
        let dir = std::env::temp_dir().join(format!(
            "echo-ai-secstore-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secure_storage.json");

        // A file written before v1.2.13: plaintext, with a provider key beside
        // the licence fields.
        let legacy = br#"{"license_key":"lic-1","instance_id":"inst-1",
            "selected_pluely_model":null,
            "ai_provider:nullform-gateway:API_KEY":"sk-secret"}"#;
        std::fs::write(&path, legacy).unwrap();
        let loaded = load_secure_storage(&path).expect("legacy file must load");
        assert_eq!(loaded.license_key.as_deref(), Some("lic-1"));
        assert_eq!(loaded.instance_id.as_deref(), Some("inst-1"));
        assert_eq!(
            loaded.extra.get("ai_provider:nullform-gateway:API_KEY").map(String::as_str),
            Some("sk-secret"),
            "the flattened provider key must survive the read"
        );

        // The same content in the encrypted format written since v1.2.13.
        let protected = dpapi::protect(legacy).expect("protect failed");
        std::fs::write(&path, &protected).unwrap();
        let reloaded = load_secure_storage(&path).expect("encrypted file must load");
        assert_eq!(reloaded.license_key.as_deref(), Some("lic-1"));
        assert_eq!(
            reloaded.extra.get("ai_provider:nullform-gateway:API_KEY").map(String::as_str),
            Some("sk-secret")
        );

        // A save must not drop the extra keys either.
        save_secure_storage(&path, &reloaded).expect("save failed");
        let after = load_secure_storage(&path).expect("reload failed");
        assert_eq!(
            after.extra.get("ai_provider:nullform-gateway:API_KEY").map(String::as_str),
            Some("sk-secret")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Pins the reason `get_stored_credentials` must not use `fs::read_to_string`.
    ///
    /// DPAPI output is binary, so the encrypted file is not valid UTF-8 — the old
    /// reader failed on it and every licence call returned an error. If someone
    /// reintroduces a string read, this test says why it is wrong.
    #[test]
    fn test_encrypted_file_is_not_valid_utf8() {
        let plaintext = br#"{"license_key":"lic-1","instance_id":"inst-1"}"#;
        let protected = dpapi::protect(plaintext).expect("protect failed");

        // The loader handles it...
        let dir = std::env::temp_dir().join(format!(
            "echo-ai-secstore-utf8-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secure_storage.json");
        std::fs::write(&path, &protected).unwrap();
        assert!(
            load_secure_storage(&path).is_ok(),
            "the loader must read the encrypted file"
        );

        // ...while a plain string read cannot.
        #[cfg(target_os = "windows")]
        assert!(
            std::fs::read_to_string(&path).is_err(),
            "DPAPI output must not decode as UTF-8 — this is why the reader cannot use read_to_string"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
