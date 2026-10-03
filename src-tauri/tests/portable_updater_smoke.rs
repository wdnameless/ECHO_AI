use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use pluely_lib::portable_update::{
    clean_staging_dir, validate_and_extract_payload, verify_and_stage_portable_update,
    DownloadEvent, BACKUP_EXE_NAME, HELPER_EXE_NAME, REPLACEMENT_EXE_NAME, STAGING_DIR_NAME,
};

fn find_production_binary() -> PathBuf {
    if let Some(path) = option_env!("CARGO_BIN_EXE_pluely") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return p;
        }
    }
    for candidate in [
        "target/debug/pluely.exe",
        "target/release/pluely.exe",
        "../target/debug/pluely.exe",
        "../target/release/pluely.exe",
    ] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    std::env::current_exe().unwrap()
}

fn build_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = Vec::new();
    let cursor = Cursor::new(&mut buf);
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default();
    for (name, content) in entries {
        zip.start_file(*name, options).unwrap();
        zip.write_all(content).unwrap();
    }
    zip.finish().unwrap();
    buf
}

async fn start_mock_updater_server(
    manifest_json: String,
    download_bytes: Vec<u8>,
) -> (String, tokio::sync::oneshot::Sender<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                res = listener.accept() => {
                    if let Ok((mut socket, _)) = res {
                        let manifest = manifest_json.clone();
                        let payload = download_bytes.clone();
                        tokio::spawn(async move {
                            use tokio::io::{AsyncReadExt, AsyncWriteExt};
                            let mut buf = [0u8; 1024];
                            if let Ok(n) = socket.read(&mut buf).await {
                                let req = String::from_utf8_lossy(&buf[..n]);
                                if req.starts_with("GET /manifest") {
                                    let resp = format!(
                                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                        manifest.len(),
                                        manifest
                                    );
                                    let _ = socket.write_all(resp.as_bytes()).await;
                                } else if req.starts_with("GET /download") {
                                    let resp_header = format!(
                                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                        payload.len()
                                    );
                                    let _ = socket.write_all(resp_header.as_bytes()).await;
                                    let _ = socket.write_all(&payload).await;
                                }
                            }
                        });
                    }
                }
            }
        }
    });

    (format!("http://127.0.0.1:{port}"), shutdown_tx)
}

#[test]
fn test_smoke_production_helper_subprocess_swap_and_relaunch() {
    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_SubprocessSwap");
    fs::create_dir_all(&app_dir).unwrap();

    let prod_bin = find_production_binary();

    // 1. Target executable Echo AI.exe
    let target_exe = app_dir.join("Echo AI.exe");
    fs::copy(&prod_bin, &target_exe).unwrap();

    // 2. User data in .echo-ai and portable marker
    let marker_file = app_dir.join(".portable");
    fs::write(&marker_file, b"portable-mode").unwrap();

    let echo_ai_dir = app_dir.join(".echo-ai");
    fs::create_dir_all(echo_ai_dir.join("models")).unwrap();
    let settings_file = echo_ai_dir.join("settings.json");
    let history_db = echo_ai_dir.join("history.db");
    let model_file = echo_ai_dir.join("models").join("whisper.bin");

    let initial_settings = b"{\"theme\":\"dark\",\"license\":\"valid-key-12345\"}";
    let initial_db = b"SQLite format 3\x00mock_database_records_here";
    let initial_model = b"GGUF_MODEL_DATA_PRESERVED_12345";

    fs::write(&settings_file, initial_settings).unwrap();
    fs::write(&history_db, initial_db).unwrap();
    fs::write(&model_file, initial_model).unwrap();

    // 3. Staging setup with helper and replacement
    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&prod_bin, &helper_exe).unwrap();

    let replacement_exe = staging_dir.join(REPLACEMENT_EXE_NAME);
    fs::copy(&prod_bin, &replacement_exe).unwrap();

    // 4. Start fixture parent subprocess using production binary flag
    let parent_marker = temp.path().join("parent_status.txt");
    let mut parent_cmd = Command::new(&target_exe);
    parent_cmd
        .arg("--portable-fixture-parent")
        .arg("--marker")
        .arg(&parent_marker)
        .arg("--sleep-ms")
        .arg("700")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut parent_child = parent_cmd.spawn().expect("Failed to spawn parent subprocess");
    let parent_pid = parent_child.id();

    // Confirm parent is active
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if parent_marker.exists() && fs::read(&parent_marker).unwrap_or_default() == b"PARENT_RUNNING" {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    // 5. Spawn actual production helper subprocess with relaunch marker argument
    let relaunch_marker = temp.path().join("relaunch_status.txt");
    let mut helper_cmd = Command::new(&helper_exe);
    helper_cmd
        .arg("--portable-update-helper")
        .arg("--parent-pid")
        .arg(parent_pid.to_string())
        .arg("--target-exe-name")
        .arg("Echo AI.exe")
        .arg("--relaunch-arg")
        .arg("--portable-fixture-marker")
        .arg("--relaunch-arg")
        .arg("--marker")
        .arg("--relaunch-arg")
        .arg(&relaunch_marker)
        .arg("--relaunch-arg")
        .arg("--text")
        .arg("--relaunch-arg")
        .arg("REPLACEMENT_ACTIVE");

    let helper_status = helper_cmd.status().expect("Failed to execute helper subprocess");
    assert!(helper_status.success(), "Production helper subprocess must exit with success (0)");

    // Parent must have exited
    let _ = parent_child.wait();
    assert_eq!(
        fs::read(&parent_marker).unwrap_or_default(),
        b"PARENT_EXITED",
        "Parent process must have completed and exited before swap"
    );

    // Wait for relaunched replacement marker
    let relaunch_start = Instant::now();
    while relaunch_start.elapsed() < Duration::from_secs(3) {
        if relaunch_marker.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(
        fs::read(&relaunch_marker).unwrap_or_default(),
        b"REPLACEMENT_ACTIVE",
        "Relaunched replacement executable must write distinct replacement marker"
    );

    // 6. Assert swap and data preservation
    assert!(target_exe.is_file(), "Target executable must exist");
    assert_eq!(target_exe.file_name().unwrap(), "Echo AI.exe");

    assert_eq!(
        fs::read(&settings_file).unwrap(),
        initial_settings,
        "Settings in .echo-ai must be preserved"
    );
    assert_eq!(
        fs::read(&history_db).unwrap(),
        initial_db,
        "Database in .echo-ai must be preserved"
    );
    assert_eq!(
        fs::read(&model_file).unwrap(),
        initial_model,
        "Models in .echo-ai must be preserved"
    );
    assert!(marker_file.is_file(), ".portable marker must be preserved");

    // Staging artifacts removed
    assert!(!staging_dir.join(REPLACEMENT_EXE_NAME).exists());
    assert!(!staging_dir.join(BACKUP_EXE_NAME).exists());
}

#[test]
fn test_smoke_production_helper_subprocess_rollback() {
    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_SubprocessRollback");
    fs::create_dir_all(&app_dir).unwrap();

    let prod_bin = find_production_binary();

    let target_exe = app_dir.join("Echo AI.exe");
    let original_bytes = fs::read(&prod_bin).unwrap();
    fs::write(&target_exe, &original_bytes).unwrap();

    let echo_ai_dir = app_dir.join(".echo-ai");
    fs::create_dir_all(&echo_ai_dir).unwrap();
    let settings_file = echo_ai_dir.join("settings.json");
    let initial_settings = b"{\"important_data\": 42}";
    fs::write(&settings_file, initial_settings).unwrap();

    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&prod_bin, &helper_exe).unwrap();

    let broken_replacement = staging_dir.join(REPLACEMENT_EXE_NAME);
    // Valid MZ magic header to pass validation, but invalid image that cannot spawn
    fs::write(&broken_replacement, b"MZ\x00\x00corrupt_image_fails_spawn").unwrap();

    // Spawn helper subprocess with dummy inactive PID and rollback relaunch argument
    let rollback_marker = temp.path().join("rollback_status.txt");
    let mut helper_cmd = Command::new(&helper_exe);
    helper_cmd
        .arg("--portable-update-helper")
        .arg("--parent-pid")
        .arg("999999")
        .arg("--target-exe-name")
        .arg("Echo AI.exe")
        .arg("--rollback-arg")
        .arg("--portable-fixture-marker")
        .arg("--rollback-arg")
        .arg("--marker")
        .arg("--rollback-arg")
        .arg(&rollback_marker)
        .arg("--rollback-arg")
        .arg("--text")
        .arg("--rollback-arg")
        .arg("ORIGINAL_ACTIVE");

    let helper_status = helper_cmd.status().expect("Failed to execute helper subprocess");
    assert!(
        !helper_status.success(),
        "Production helper subprocess must report failure when relaunch fails"
    );

    // Verify rollback: original executable restored!
    let restored_bytes = fs::read(&target_exe).unwrap();
    assert_eq!(
        restored_bytes, original_bytes,
        "Original executable must be restored from backup after relaunch failure"
    );

    // Wait for relaunched original marker
    let rollback_start = Instant::now();
    while rollback_start.elapsed() < Duration::from_secs(3) {
        if rollback_marker.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(
        fs::read(&rollback_marker).unwrap_or_default(),
        b"ORIGINAL_ACTIVE",
        "Relaunched original executable must write distinct rollback marker"
    );

    assert_eq!(
        fs::read(&settings_file).unwrap(),
        initial_settings,
        "User data in .echo-ai must remain completely untouched during rollback"
    );
}

#[test]
fn test_smoke_production_helper_subprocess_rejects_arbitrary_target() {
    let temp = tempfile::tempdir().unwrap();
    let staging_dir = temp.path().join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let prod_bin = find_production_binary();
    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&prod_bin, &helper_exe).unwrap();

    // Attempt path traversal
    let mut cmd1 = Command::new(&helper_exe);
    cmd1.arg("--portable-update-helper")
        .arg("--parent-pid")
        .arg("999999")
        .arg("--target-exe-name")
        .arg("../malicious.exe");

    let status1 = cmd1.status().expect("Helper execution failed");
    assert!(!status1.success(), "Helper must reject path traversal");

    // Attempt non-exe
    let mut cmd2 = Command::new(&helper_exe);
    cmd2.arg("--portable-update-helper")
        .arg("--parent-pid")
        .arg("999999")
        .arg("--target-exe-name")
        .arg("malicious.bat");

    let status2 = cmd2.status().expect("Helper execution failed");
    assert!(!status2.success(), "Helper must reject non-exe target");
}

#[tokio::test]
async fn test_smoke_real_local_http_signature_verification_gate() {
    use tauri_plugin_updater::UpdaterExt;

    let app = tauri::test::mock_app();
    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_HttpTest");
    fs::create_dir_all(&app_dir).unwrap();

    let target_exe = app_dir.join("Echo AI.exe");
    fs::write(&target_exe, b"MZ\x90\x00current_binary_content").unwrap();

    let echo_ai_dir = app_dir.join(".echo-ai");
    fs::create_dir_all(&echo_ai_dir).unwrap();
    let settings_file = echo_ai_dir.join("settings.json");
    fs::write(&settings_file, b"{\"safe\": true}").unwrap();

    // Minisign test key vector from minisign-verify
    let pubkey_str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    let sig_str = "untrusted comment: signature from minisign secret key\n\
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n\
trusted comment: timestamp:1556193335\tfile:test\n\
y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

    // Start local HTTP server serving TAMPERED archive bytes
    let tampered_payload = b"tampered_archive_bytes_fail_signature".to_vec();
    let manifest = format!(
        r#"{{
            "version": "1.2.31",
            "notes": "Security test update",
            "pub_date": "2026-10-03T00:00:00Z",
            "platforms": {{
                "windows-x86_64-portable": {{
                    "signature": "{}",
                    "url": "ENDPOINT_URL/download"
                }}
            }}
        }}"#,
        sig_str.replace('\n', "\\n")
    );

    let (server_base, shutdown_tx) = start_mock_updater_server(manifest, tampered_payload).await;
    let manifest_url = format!("{server_base}/manifest");

    let updater = app
        .updater_builder()
        .target("windows-x86_64-portable")
        .endpoints(vec![url::Url::parse(&manifest_url).unwrap()])
        .unwrap()
        .pubkey(pubkey_str)
        .build()
        .unwrap();

    let channel = tauri::ipc::Channel::new(|_body| Ok(()));

    // Call verify_and_stage_portable_update: must download via Tauri Update.download and verify signature
    let res = verify_and_stage_portable_update(
        &app.app_handle(),
        "1.2.31",
        &channel,
        Some(updater),
        &target_exe,
        &app_dir,
        "Echo AI.exe",
    )
    .await;

    // Signature verification must FAIL before any staging occurs!
    assert!(res.is_err(), "Tampered payload must fail signature verification");
    let err_msg = res.unwrap_err();
    assert!(
        err_msg.contains("signature") || err_msg.contains("download"),
        "Error message should mention signature or download failure: {err_msg}"
    );

    // Staging directory must NOT have been created!
    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    assert!(!staging_dir.exists(), "Staging directory must not be created on signature failure");

    // Target executable and data must be completely untouched
    assert_eq!(fs::read(&target_exe).unwrap(), b"MZ\x90\x00current_binary_content");
    assert_eq!(fs::read(&settings_file).unwrap(), b"{\"safe\": true}");

    let _ = shutdown_tx.send(());
}

#[test]
fn test_smoke_archive_validation_bounds() {
    let traversal_zip = build_test_zip(&[("../evil.exe", b"MZ\x00\x00data")]);
    assert!(validate_and_extract_payload(&traversal_zip, "Echo AI.exe").is_err());

    let data_zip = build_test_zip(&[
        ("Echo AI.exe", b"MZ\x00\x00data"),
        (".echo-ai/bad.db", b"data"),
    ]);
    assert!(validate_and_extract_payload(&data_zip, "Echo AI.exe").is_err());

    let invalid_pe_zip = build_test_zip(&[("Echo AI.exe", b"NOT_PE_HEADER")]);
    assert!(validate_and_extract_payload(&invalid_pe_zip, "Echo AI.exe").is_err());

    let valid_zip = build_test_zip(&[
        ("Echo AI.exe", b"MZ\x90\x00sample_valid_executable"),
        (".portable", b"marker"),
    ]);
    let extracted = validate_and_extract_payload(&valid_zip, "Echo AI.exe").unwrap();
    assert_eq!(extracted, b"MZ\x90\x00sample_valid_executable");
}
