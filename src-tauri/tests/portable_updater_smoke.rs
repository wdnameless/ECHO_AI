use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use pluely_lib::portable_update::{
    self, clean_staging_dir, run_helper_logic, validate_and_extract_payload,
    BACKUP_EXE_NAME, HELPER_EXE_NAME, REPLACEMENT_EXE_NAME, STAGING_DIR_NAME,
};

fn init_fixture_role_if_present() {
    if let Ok(role) = std::env::var("PORTABLE_UPDATER_FIXTURE_ROLE") {
        match role.as_str() {
            "parent" => {
                // Mock running application holding the executable open
                let marker_path = std::env::var("FIXTURE_MARKER_PATH").unwrap_or_default();
                if !marker_path.is_empty() {
                    let _ = fs::write(&marker_path, b"PARENT_RUNNING");
                }
                std::thread::sleep(Duration::from_millis(600));
                if !marker_path.is_empty() {
                    let _ = fs::write(&marker_path, b"PARENT_EXITED");
                }
                std::process::exit(0);
            }
            "relaunched_replacement" => {
                let marker_path = std::env::var("FIXTURE_MARKER_PATH").unwrap_or_default();
                if !marker_path.is_empty() {
                    let _ = fs::write(&marker_path, b"RELAUNCHED_NEW");
                }
                std::process::exit(0);
            }
            "relaunched_original" => {
                let marker_path = std::env::var("FIXTURE_MARKER_PATH").unwrap_or_default();
                if !marker_path.is_empty() {
                    let _ = fs::write(&marker_path, b"RELAUNCHED_ORIGINAL");
                }
                std::process::exit(0);
            }
            _ => {}
        }
    }
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

#[test]
fn test_smoke_helper_process_wait_and_replacement() {
    init_fixture_role_if_present();

    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_Portable");
    fs::create_dir_all(&app_dir).unwrap();

    let current_test_exe = std::env::current_exe().unwrap();

    // 1. Create target executable (Echo AI.exe)
    let target_exe = app_dir.join("Echo AI.exe");
    fs::copy(&current_test_exe, &target_exe).unwrap();

    // 2. Create portable marker and .echo-ai user data
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

    // 3. Staging setup
    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&current_test_exe, &helper_exe).unwrap();

    let replacement_exe = staging_dir.join(REPLACEMENT_EXE_NAME);
    // Replacement is also a copy of test exe so it can be relaunched
    fs::copy(&current_test_exe, &replacement_exe).unwrap();

    // 4. Start fixture parent process holding target_exe open
    let status_marker = temp.path().join("fixture_status.txt");
    let mut parent_cmd = Command::new(&target_exe);
    parent_cmd
        .env("PORTABLE_UPDATER_FIXTURE_ROLE", "parent")
        .env("FIXTURE_MARKER_PATH", &status_marker)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let parent_child = parent_cmd.spawn().expect("Failed to spawn fixture parent process");
    let parent_pid = parent_child.id();

    // Wait until parent is confirmed running
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if status_marker.exists() && fs::read(&status_marker).unwrap_or_default() == b"PARENT_RUNNING" {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    // 5. Run helper logic: must wait for parent to exit, swap, relaunch, clean up
    let relaunch_marker = temp.path().join("relaunch_status.txt");
    std::env::set_var("PORTABLE_UPDATER_FIXTURE_ROLE", "relaunched_replacement");
    std::env::set_var("FIXTURE_MARKER_PATH", &relaunch_marker);

    let helper_res = run_helper_logic(&helper_exe, parent_pid, "Echo AI.exe", 5000);
    assert!(helper_res.is_ok(), "Helper execution failed: {:?}", helper_res.err());

    // 6. Verify assertions
    assert!(target_exe.is_file(), "Target executable must exist at original path");
    assert_eq!(
        target_exe.file_name().unwrap(),
        "Echo AI.exe",
        "Target executable filename must be preserved"
    );

    // Verify .echo-ai data preserved
    assert_eq!(
        fs::read(&settings_file).unwrap(),
        initial_settings,
        "Settings file in .echo-ai must be 100% preserved"
    );
    assert_eq!(
        fs::read(&history_db).unwrap(),
        initial_db,
        "Database in .echo-ai must be 100% preserved"
    );
    assert_eq!(
        fs::read(&model_file).unwrap(),
        initial_model,
        "Model binary in .echo-ai must be 100% preserved"
    );
    assert!(marker_file.is_file(), ".portable marker must be preserved");

    // Verify staging artifacts removed
    assert!(
        !staging_dir.join(REPLACEMENT_EXE_NAME).exists(),
        "Replacement binary must be cleaned up from staging"
    );
    assert!(
        !staging_dir.join(BACKUP_EXE_NAME).exists(),
        "Backup binary must be cleaned up from staging after successful swap"
    );

    // Reset env
    std::env::remove_var("PORTABLE_UPDATER_FIXTURE_ROLE");
    std::env::remove_var("FIXTURE_MARKER_PATH");
}

#[test]
fn test_smoke_helper_rollback_on_relaunch_failure() {
    init_fixture_role_if_present();

    let temp = tempfile::tempdir().unwrap();
    let app_dir = temp.path().join("EchoAI_RollbackTest");
    fs::create_dir_all(&app_dir).unwrap();

    let current_test_exe = std::env::current_exe().unwrap();

    // 1. Create target executable with distinctive content
    let target_exe = app_dir.join("Echo AI.exe");
    let original_bytes = fs::read(&current_test_exe).unwrap();
    fs::write(&target_exe, &original_bytes).unwrap();

    // 2. Create user data in .echo-ai
    let echo_ai_dir = app_dir.join(".echo-ai");
    fs::create_dir_all(&echo_ai_dir).unwrap();
    let settings_file = echo_ai_dir.join("settings.json");
    let initial_settings = b"{\"state\":\"do_not_lose_this_data\"}";
    fs::write(&settings_file, initial_settings).unwrap();

    // 3. Staging setup with broken replacement (valid MZ header but invalid PE content that fails spawn)
    let staging_dir = app_dir.join(STAGING_DIR_NAME);
    fs::create_dir_all(&staging_dir).unwrap();

    let helper_exe = staging_dir.join(HELPER_EXE_NAME);
    fs::copy(&current_test_exe, &helper_exe).unwrap();

    let broken_replacement = staging_dir.join(REPLACEMENT_EXE_NAME);
    // Valid MZ magic header to pass validation, but corrupt image that cannot be spawned by OS
    fs::write(&broken_replacement, b"MZ\x00\x00corrupt_payload_cannot_spawn").unwrap();

    // 4. Run helper with dummy inactive parent PID
    let result = run_helper_logic(&helper_exe, 999999, "Echo AI.exe", 1000);
    assert!(result.is_err(), "Helper must report failure when relaunch fails");

    // 5. Verify rollback: original executable must be restored!
    let restored_bytes = fs::read(&target_exe).unwrap();
    assert_eq!(
        restored_bytes, original_bytes,
        "Original executable must be restored from backup after relaunch failure"
    );

    // Verify .echo-ai data remained completely intact
    assert_eq!(
        fs::read(&settings_file).unwrap(),
        initial_settings,
        "User data in .echo-ai must remain completely untouched during rollback"
    );
}

#[test]
fn test_smoke_helper_rejects_arbitrary_target() {
    let temp = tempfile::tempdir().unwrap();
    let current_test_exe = std::env::current_exe().unwrap();

    // 1. Helper in arbitrary directory (not named .portable-update-staging)
    let arbitrary_dir = temp.path().join("arbitrary_staging");
    fs::create_dir_all(&arbitrary_dir).unwrap();
    let helper_exe = arbitrary_dir.join("updater-helper.exe");
    fs::copy(&current_test_exe, &helper_exe).unwrap();

    let res1 = run_helper_logic(&helper_exe, 999999, "Echo AI.exe", 1000);
    assert!(res1.is_err(), "Helper must reject execution from unconstrained directory");
    assert!(res1.unwrap_err().contains("Helper must be run from"));

    // 2. Target executable name containing path traversal
    let valid_staging = temp.path().join(STAGING_DIR_NAME);
    fs::create_dir_all(&valid_staging).unwrap();
    let valid_helper = valid_staging.join(HELPER_EXE_NAME);
    fs::copy(&current_test_exe, &valid_helper).unwrap();

    let res2 = run_helper_logic(&valid_helper, 999999, "../Windows/System32/calc.exe", 1000);
    assert!(res2.is_err(), "Helper must reject path traversal in target executable name");

    let res3 = run_helper_logic(&valid_helper, 999999, "calc.bat", 1000);
    assert!(res3.is_err(), "Helper must reject non-exe target executable name");
}

#[test]
fn test_smoke_minisign_signature_verification() {
    use minisign_verify::{PublicKey, Signature};

    let pubkey_str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    let sig_str = "untrusted comment: signature from minisign secret key\n\
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n\
trusted comment: timestamp:1633700835\tfile:test\tprehashed\n\
wLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";

    let valid_content = b"test";

    let pubkey = PublicKey::from_base64(pubkey_str).expect("Valid public key decode");
    let sig = Signature::decode(sig_str).expect("Valid signature decode");

    // 1. Valid signature verifies successfully
    assert!(pubkey.verify(&valid_content[..], &sig, false).is_ok());

    // 2. Tampered content fails signature verification
    let tampered_content = b"test_tampered";
    assert!(
        pubkey.verify(&tampered_content[..], &sig, false).is_err(),
        "Tampered payload must fail minisign signature verification"
    );

    // 3. Corrupted signature fails verification
    let mut bad_sig_str = sig_str.to_string();
    bad_sig_str = bad_sig_str.replace("RUQf6", "RUQf9");
    let bad_sig = Signature::decode(&bad_sig_str);
    if let Ok(s) = bad_sig {
        assert!(pubkey.verify(&valid_content[..], &s, false).is_err());
    }
}

#[test]
fn test_smoke_archive_validation_bounds() {
    // 1. Traversal archive
    let traversal_zip = build_test_zip(&[
        ("../evil.exe", b"MZ\x00\x00data"),
    ]);
    assert!(validate_and_extract_payload(&traversal_zip, "Echo AI.exe").is_err());

    // 2. Data payload archive
    let data_zip = build_test_zip(&[
        ("Echo AI.exe", b"MZ\x00\x00data"),
        (".echo-ai/bad.db", b"data"),
    ]);
    assert!(validate_and_extract_payload(&data_zip, "Echo AI.exe").is_err());

    // 3. Executable missing PE header
    let invalid_pe_zip = build_test_zip(&[
        ("Echo AI.exe", b"NOT_PE_HEADER"),
    ]);
    assert!(validate_and_extract_payload(&invalid_pe_zip, "Echo AI.exe").is_err());

    // 4. Valid archive
    let valid_zip = build_test_zip(&[
        ("Echo AI.exe", b"MZ\x90\x00sample_valid_executable"),
        (".portable", b"marker"),
    ]);
    let extracted = validate_and_extract_payload(&valid_zip, "Echo AI.exe").unwrap();
    assert_eq!(extracted, b"MZ\x90\x00sample_valid_executable");
}
