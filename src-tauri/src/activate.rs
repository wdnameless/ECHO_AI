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

pub const MAGIC_WINDOWS: &[u8] = b"DPAPI\x01";
pub const MAGIC_MACOS: &[u8] = b"MCSEC\x01";
pub const MAGIC_LINUX: &[u8] = b"LXSEC\x01";

pub fn is_encrypted_format(data: &[u8]) -> bool {
    data.starts_with(MAGIC_WINDOWS)
        || data.starts_with(MAGIC_MACOS)
        || data.starts_with(MAGIC_LINUX)
}

pub fn is_legacy_format(data: &[u8]) -> bool {
    !is_encrypted_format(data)
}

/// Symmetric counter-mode keystream cipher using SHA-256.
///
/// Encrypts or decrypts `data` by XORing it with `Sha256(key || nonce || counter)`.
#[allow(dead_code)]
pub(crate) fn xor_stream(key: &[u8; 32], nonce: &[u8; 16], data: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    let mut result = Vec::with_capacity(data.len());
    let mut counter: u64 = 0;
    let mut chunk_start = 0;

    while chunk_start < data.len() {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update(nonce);
        hasher.update(counter.to_le_bytes());
        let block = hasher.finalize();

        let chunk_end = (chunk_start + 32).min(data.len());
        for (i, byte) in data[chunk_start..chunk_end].iter().enumerate() {
            result.push(byte ^ block[i]);
        }

        counter += 1;
        chunk_start = chunk_end;
    }

    result
}

#[cfg(target_os = "windows")]
mod dpapi {
    use super::MAGIC_WINDOWS;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    pub const MAGIC_HEADER: &[u8] = MAGIC_WINDOWS;

    #[allow(dead_code)]
    pub fn is_encrypted(data: &[u8]) -> bool {
        super::is_encrypted_format(data)
    }

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
    use super::{xor_stream, MAGIC_LINUX, MAGIC_MACOS};
    use sha2::{Digest, Sha256};
    use std::process::Command;

    // Protection level differs per platform, and the difference matters:
    //
    //   macOS  — a random 256-bit key generated once and stored in the user's
    //            Keychain (`security` CLI). Real at-rest protection: the
    //            ciphertext is useless without the Keychain entry.
    //   Linux  — no such per-user keystore is available without new
    //            dependencies, so the key is derived from `/etc/machine-id` plus
    //            `$USER`/`$HOME`. Every one of those is readable by any local
    //            process, so this is OBFUSCATION, NOT PROTECTION: it stops a
    //            casual look at a dotfile or an accidental commit, and nothing
    //            more. An attacker who can read the file can derive the key.
    //
    // The honest ceiling is recorded rather than hidden; the file format is the
    // same on both platforms, so a future real keystore (libsecret/TPM) only has
    // to replace `get_encryption_key` and the ciphertext keeps working.
    //
    // defer: Linux at-rest protection is obfuscation only | ceiling: key derivable from world-readable machine-id/user/home | upgrade: libsecret or TPM-backed key accepted as a dependency

    #[cfg(target_os = "macos")]
    pub const MAGIC_HEADER: &[u8] = MAGIC_MACOS;

    #[cfg(not(target_os = "macos"))]
    pub const MAGIC_HEADER: &[u8] = MAGIC_LINUX;

    pub fn is_encrypted(data: &[u8]) -> bool {
        super::is_encrypted_format(data)
    }

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            use std::fmt::Write;
            let _ = write!(s, "{:02x}", b);
        }
        s
    }

    fn from_hex(s: &str) -> Option<Vec<u8>> {
        if s.len() % 2 != 0 {
            return None;
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
            .collect()
    }

    #[cfg(target_os = "macos")]
    fn get_macos_keychain_key() -> Result<[u8; 32], String> {
        const SERVICE: &str = "com.srikanthnani.pluely.storage";
        const ACCOUNT: &str = "pluely";

        let output = Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
            .output()
            .map_err(|e| format!("security CLI execution failed: {e}"))?;

        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(bytes) = from_hex(&s) {
                if bytes.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&bytes);
                    return Ok(arr);
                }
            }
        }

        let mut key = [0u8; 32];
        let u1 = uuid::Uuid::new_v4();
        let u2 = uuid::Uuid::new_v4();
        key[..16].copy_from_slice(u1.as_bytes());
        key[16..].copy_from_slice(u2.as_bytes());
        let hex_key = to_hex(&key);

        let add_res = Command::new("/usr/bin/security")
            .args(["add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", &hex_key, "-U"])
            .output()
            .map_err(|e| format!("security add-generic-password failed: {e}"))?;

        if add_res.status.success() {
            Ok(key)
        } else {
            Err("security add-generic-password returned non-zero status".to_string())
        }
    }

    fn derive_machine_user_key() -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"pluely-secure-storage-salt-v1");

        // System machine-id
        if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
            hasher.update(id.trim().as_bytes());
        } else if let Ok(id) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
            hasher.update(id.trim().as_bytes());
        } else {
            hasher.update(b"fallback-machine-id");
        }

        if let Ok(user) = std::env::var("USER") {
            hasher.update(user.as_bytes());
        }
        if let Ok(home) = std::env::var("HOME") {
            hasher.update(home.as_bytes());
        }

        hasher.finalize().into()
    }

    fn get_encryption_key() -> [u8; 32] {
        #[cfg(target_os = "macos")]
        {
            if let Ok(key) = get_macos_keychain_key() {
                return key;
            }
        }
        derive_machine_user_key()
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let key = get_encryption_key();
        let nonce = uuid::Uuid::new_v4();
        let nonce_bytes = nonce.as_bytes();

        let encrypted = xor_stream(&key, nonce_bytes, data);
        let mut result = Vec::with_capacity(MAGIC_HEADER.len() + 16 + encrypted.len());
        result.extend_from_slice(MAGIC_HEADER);
        result.extend_from_slice(nonce_bytes);
        result.extend_from_slice(&encrypted);
        Ok(result)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        if !data.starts_with(MAGIC_HEADER) {
            // Legacy / unencrypted plaintext JSON format: return raw bytes for serde_json
            return Ok(data.to_vec());
        }

        let payload = &data[MAGIC_HEADER.len()..];
        if payload.len() < 16 {
            return Err("Payload too short for nonce".to_string());
        }

        let mut nonce = [0u8; 16];
        nonce.copy_from_slice(&payload[..16]);
        let ciphertext = &payload[16..];

        let key = get_encryption_key();
        let decrypted = xor_stream(&key, &nonce, ciphertext);
        Ok(decrypted)
    }
}

/// Reads the secure-storage file, decrypting via DPAPI or platform encryption.
///
/// If the file is in legacy unencrypted JSON format, it is automatically
/// re-encrypted in the protected format on load (R16).
pub fn load_secure_storage(storage_path: &std::path::Path) -> Result<SecureStorage, String> {
    if !storage_path.exists() {
        return Ok(SecureStorage::default());
    }

    let raw = fs::read(storage_path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;
    let is_legacy = is_legacy_format(&raw);
    let decrypted = dpapi::unprotect(&raw)?;
    let storage: SecureStorage = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Failed to parse storage file: {}", e))?;

    // R16: On successful load of a legacy plaintext file, rewrite it in protected format.
    // Failure to rewrite must not lose data or fail the load.
    if is_legacy && !raw.is_empty() {
        if let Err(e) = save_secure_storage(storage_path, &storage) {
            eprintln!(
                "Warning: failed to re-encrypt legacy secure storage {}: {e}",
                storage_path.display()
            );
        }
    }

    Ok(storage)
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

    #[test]
    fn test_format_detection() {
        assert!(is_legacy_format(b"{\"license_key\":\"legacy-123\"}"));
        assert!(!is_encrypted_format(b"{\"license_key\":\"legacy-123\"}"));

        assert!(is_encrypted_format(b"DPAPI\x01some_encrypted_payload"));
        assert!(!is_legacy_format(b"DPAPI\x01some_encrypted_payload"));

        assert!(is_encrypted_format(b"MCSEC\x01some_encrypted_payload"));
        assert!(!is_legacy_format(b"MCSEC\x01some_encrypted_payload"));

        assert!(is_encrypted_format(b"LXSEC\x01some_encrypted_payload"));
        assert!(!is_legacy_format(b"LXSEC\x01some_encrypted_payload"));
    }

    #[test]
    fn test_legacy_file_reencrypted_on_load() {
        let dir = std::env::temp_dir().join(format!(
            "echo-ai-reencrypt-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secure_storage.json");

        let legacy_content = br#"{"license_key":"lic-legacy","instance_id":"inst-legacy",
            "selected_pluely_model":null,
            "ai_provider:custom:KEY":"secret-val"}"#;
        std::fs::write(&path, legacy_content).unwrap();

        // Before load: on disk it is legacy plaintext
        let on_disk_before = std::fs::read(&path).unwrap();
        assert!(is_legacy_format(&on_disk_before));

        // Load it: must succeed and trigger rewrite in place (R16)
        let loaded = load_secure_storage(&path).expect("legacy file must load");
        assert_eq!(loaded.license_key.as_deref(), Some("lic-legacy"));
        assert_eq!(loaded.instance_id.as_deref(), Some("inst-legacy"));
        assert_eq!(
            loaded.extra.get("ai_provider:custom:KEY").map(String::as_str),
            Some("secret-val")
        );

        // After load: on disk it must now be encrypted
        let on_disk_after = std::fs::read(&path).unwrap();
        assert!(
            is_encrypted_format(&on_disk_after),
            "legacy file must be re-encrypted on disk after successful load"
        );
        assert!(!is_legacy_format(&on_disk_after));

        // Reloading the newly encrypted file produces the exact same data
        let reloaded = load_secure_storage(&path).expect("re-encrypted file must load");
        assert_eq!(reloaded.license_key.as_deref(), Some("lic-legacy"));
        assert_eq!(reloaded.instance_id.as_deref(), Some("inst-legacy"));
        assert_eq!(
            reloaded.extra.get("ai_provider:custom:KEY").map(String::as_str),
            Some("secret-val")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_xor_stream_roundtrip() {
        let key = [42u8; 32];
        let nonce = [7u8; 16];
        let plaintext = b"Hello, encrypted at-rest storage on non-Windows platforms!";

        let ciphertext = xor_stream(&key, &nonce, plaintext);
        assert_ne!(&ciphertext[..], plaintext);

        let decrypted = xor_stream(&key, &nonce, &ciphertext);
        assert_eq!(&decrypted[..], plaintext);
    }
}
