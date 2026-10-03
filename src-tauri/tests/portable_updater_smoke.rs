use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{Manager, Url};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use pluely_lib::portable_update::{
    validate_and_extract_payload, verify_and_stage_portable_update,
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
    panic!("Production binary 'pluely.exe' was not found. Please build the application before running integration smoke.");
}

fn compile_std_fixture_exe(dest: &Path) {
    let temp = tempfile::tempdir().unwrap();
    let src = temp.path().join("fixture.rs");
    let code = r#"
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    let mut marker_path: Option<String> = None;
    let mut marker_text = "MARKER".to_string();
    let mut sleep_ms = 0u64;

    while i < args.len() {
        match args[i].as_str() {
            "--marker" if i + 1 < args.len() => {
                marker_path = Some(args[i + 1].clone());
                i += 1;
            }
            "--text" if i + 1 < args.len() => {
                marker_text = args[i + 1].clone();
                i += 1;
            }
            "--sleep-ms" if i + 1 < args.len() => {
                if let Ok(ms) = args[i + 1].parse() {
                    sleep_ms = ms;
                }
                i += 1;
            }
            _ => {}
        }
        i += 1;
    }

    if let Some(p) = &marker_path {
        let _ = std::fs::write(p, b"RUNNING");
    }
    if sleep_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
    }
    if let Some(p) = &marker_path {
        let _ = std::fs::write(p, marker_text.as_bytes());
    }
}
"#;
    std::fs::write(&src, code).unwrap();
    let status = Command::new("rustc")
        .arg(&src)
        .arg("-o")
        .arg(dest)
        .status()
        .expect("Failed to execute rustc to compile fixture executable");
    assert!(status.success(), "rustc compilation of fixture executable failed");
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

fn generate_ephemeral_signing_keys_and_sign(
    temp_dir: &Path,
    archive_path: &Path,
) -> (String, String) {
    let key_file = temp_dir.join("ephemeral_test.key");
    let key_file_str = key_file.to_str().unwrap();

    let (program, base_args): (&str, &[&str]) = if cfg!(windows) {
        ("cmd.exe", &["/C", "npx"])
    } else {
        ("npx", &[])
    };

    let mut gen_cmd = Command::new(program);
    for arg in base_args {
        gen_cmd.arg(arg);
    }
    gen_cmd
        .arg("tauri")
        .arg("signer")
        .arg("generate")
        .arg("-p")
        .arg("")
        .arg("-w")
        .arg(key_file_str)
        .arg("-f")
        .arg("--ci");
    let gen_status = gen_cmd.status().expect("Failed to execute tauri signer generate");
    assert!(gen_status.success(), "tauri signer generate must succeed");

    let priv_key = fs::read_to_string(&key_file)
        .expect("Failed to read generated private key")
        .trim()
        .to_string();

    let pubkey = fs::read_to_string(format!("{key_file_str}.pub"))
        .expect("Failed to read generated public key")
        .trim()
        .to_string();

    let mut sign_cmd = Command::new(program);
    for arg in base_args {
        sign_cmd.arg(arg);
    }
    sign_cmd
        .arg("tauri")
        .arg("signer")
        .arg("sign")
        .arg("-p")
        .arg("")
        .arg("-k")
        .arg(&priv_key)
        .arg(archive_path.to_str().unwrap());
    let sign_status = sign_cmd.status().expect("Failed to execute tauri signer sign");
    assert!(sign_status.success(), "tauri signer sign must succeed");

    let sig_path = format!("{}.sig", archive_path.to_str().unwrap());
    let signature = fs::read_to_string(&sig_path)
        .expect("Failed to read generated signature")
        .trim()
        .to_string();

    (pubkey, signature)
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

    // 1. Compile standalone fixture parent executable
    let target_exe = app_dir.join("Echo AI.exe");
    compile_std_fixture_exe(&target_exe);

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

    // 3. Staging setup with helper (built pluely.exe) and replacement (fixture executable)
    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&prod_bin, &helper_exe).unwrap();

    let replacement_exe = staging_dir.join(REPLACEMENT_EXE_NAME);
    compile_std_fixture_exe(&replacement_exe);

    // 4. Start fixture parent subprocess
    let parent_marker = temp.path().join("parent_status.txt");
    let mut parent_cmd = Command::new(&target_exe);
    parent_cmd
        .arg("--marker")
        .arg(&parent_marker)
        .arg("--sleep-ms")
        .arg("700")
        .arg("--text")
        .arg("PARENT_EXITED")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut parent_child = parent_cmd.spawn().expect("Failed to spawn parent subprocess");
    let parent_pid = parent_child.id();

    // Confirm parent is active
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if parent_marker.exists() && fs::read(&parent_marker).unwrap_or_default() == b"RUNNING" {
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

    // 1. Compile standalone fixture parent executable
    let target_exe = app_dir.join("Echo AI.exe");
    compile_std_fixture_exe(&target_exe);
    let original_bytes = fs::read(&target_exe).unwrap();

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
async fn test_smoke_real_local_http_signed_staging_and_tampered_rejection() {
    use tauri_plugin_updater::UpdaterExt;

    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_HttpSmoke");
    fs::create_dir_all(&app_dir).unwrap();

    let target_exe = app_dir.join("Echo AI.exe");
    compile_std_fixture_exe(&target_exe);

    let echo_ai_dir = app_dir.join(".echo-ai");
    fs::create_dir_all(&echo_ai_dir).unwrap();
    let settings_file = echo_ai_dir.join("settings.json");
    fs::write(&settings_file, b"{\"database\":\"preserved\"}").unwrap();

    // 1. Build valid fixture ZIP archive in OS temp
    let archive_path = temp.path().join("update_payload.zip");
    let replacement_bin_path = temp.path().join("replacement_fixture.exe");
    compile_std_fixture_exe(&replacement_bin_path);
    let replacement_bytes = fs::read(&replacement_bin_path).unwrap();

    let valid_zip_bytes = build_test_zip(&[
        ("Echo AI.exe", &replacement_bytes),
        (".portable", b"marker"),
    ]);
    fs::write(&archive_path, &valid_zip_bytes).unwrap();

    // 2. Generate ephemeral key pair and sign the archive via tauri signer CLI (no human keys)
    let (pubkey_envelope, valid_sig_envelope) =
        generate_ephemeral_signing_keys_and_sign(temp.path(), &archive_path);

    // 3. Positive signed test: Valid signature and valid archive must download, verify, and stage!
    let valid_manifest = format!(
        r#"{{
            "version": "1.2.31",
            "notes": "Verified update",
            "pub_date": "2026-10-03T00:00:00Z",
            "platforms": {{
                "windows-x86_64-portable": {{
                    "signature": "{}",
                    "url": "ENDPOINT_URL/download"
                }}
            }}
        }}"#,
        valid_sig_envelope
    );

    let (pos_server_base, pos_shutdown) =
        start_mock_updater_server(valid_manifest, valid_zip_bytes.clone()).await;

    let mut pos_context = tauri::test::mock_context(tauri::test::noop_assets());
    pos_context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({
            "dangerousInsecureTransportProtocol": true,
            "endpoints": [format!("{pos_server_base}/manifest")],
            "pubkey": pubkey_envelope
        }),
    );
    let pos_app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(pos_context)
        .unwrap();

    let pos_updater = pos_app
        .updater_builder()
        .target("windows-x86_64-portable")
        .endpoints(vec![Url::parse(&format!("{pos_server_base}/manifest")).unwrap()])
        .unwrap()
        .pubkey(&pubkey_envelope)
        .build()
        .unwrap();

    let channel = tauri::ipc::Channel::new(|_body| Ok(()));

    let pos_res = verify_and_stage_portable_update(
        pos_app.handle(),
        "1.2.31",
        &channel,
        Some(pos_updater),
        &target_exe,
        &app_dir,
        "Echo AI.exe",
    )
    .await;

    assert!(pos_res.is_ok(), "Positive signed update staging must succeed: {:?}", pos_res.err());
    let (staging_dir, helper_path) = pos_res.unwrap();
    assert!(staging_dir.join(REPLACEMENT_EXE_NAME).is_file(), "replacement.exe must be staged");
    assert!(helper_path.is_file(), "updater-helper.exe must be staged");
    assert_eq!(fs::read(&settings_file).unwrap(), b"{\"database\":\"preserved\"}");

    let _ = pos_shutdown.send(());

    // Clean staging for negative test
    let _ = fs::remove_file(staging_dir.join(REPLACEMENT_EXE_NAME));
    let _ = fs::remove_file(&helper_path);
    let _ = fs::remove_dir(&staging_dir);

    // 4. Negative test: Tampered archive bytes must fail signature check and leave staging empty!
    let mut tampered_zip_bytes = valid_zip_bytes.clone();
    let last_idx = tampered_zip_bytes.len() - 1;
    tampered_zip_bytes[last_idx] ^= 0xFF; // Flip last byte to invalidate minisign signature

    let tampered_manifest = format!(
        r#"{{
            "version": "1.2.31",
            "notes": "Tampered update",
            "pub_date": "2026-10-03T00:00:00Z",
            "platforms": {{
                "windows-x86_64-portable": {{
                    "signature": "{}",
                    "url": "ENDPOINT_URL/download"
                }}
            }}
        }}"#,
        valid_sig_envelope
    );

    let (neg_server_base, neg_shutdown) =
        start_mock_updater_server(tampered_manifest, tampered_zip_bytes).await;

    let mut neg_context = tauri::test::mock_context(tauri::test::noop_assets());
    neg_context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({
            "dangerousInsecureTransportProtocol": true,
            "endpoints": [format!("{neg_server_base}/manifest")],
            "pubkey": pubkey_envelope
        }),
    );
    let neg_app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(neg_context)
        .unwrap();

    let neg_updater = neg_app
        .updater_builder()
        .target("windows-x86_64-portable")
        .endpoints(vec![Url::parse(&format!("{neg_server_base}/manifest")).unwrap()])
        .unwrap()
        .pubkey(&pubkey_envelope)
        .build()
        .unwrap();

    let neg_res = verify_and_stage_portable_update(
        neg_app.handle(),
        "1.2.31",
        &channel,
        Some(neg_updater),
        &target_exe,
        &app_dir,
        "Echo AI.exe",
    )
    .await;

    assert!(neg_res.is_err(), "Tampered payload must fail signature verification in Update.download");
    let err_msg = neg_res.unwrap_err();
    assert!(
        err_msg.contains("signature") || err_msg.contains("download"),
        "Error message should mention signature or download failure: {err_msg}"
    );

    // Staging directory must NOT exist after signature failure
    assert!(!staging_dir.exists(), "Staging directory must NOT be created on signature failure");
    assert_eq!(fs::read(&settings_file).unwrap(), b"{\"database\":\"preserved\"}");

    let _ = neg_shutdown.send(());
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
