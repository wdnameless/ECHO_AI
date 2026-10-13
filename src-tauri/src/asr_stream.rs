use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

struct StreamHandle {
    tx: mpsc::UnboundedSender<Message>,
    owner: Option<String>,
}

static ACTIVE_STREAMS: LazyLock<Mutex<HashMap<String, StreamHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static ACTIVE_OWNER: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

pub fn try_acquire_owner(owner: &str) -> bool {
    let mut lock = match ACTIVE_OWNER.lock() {
        Ok(l) => l,
        Err(_) => return false,
    };
    if let Some(current) = &*lock {
        if current != owner {
            return false;
        }
    }
    *lock = Some(owner.to_string());
    true
}

pub fn release_owner(owner: &str) {
    if let Ok(mut lock) = ACTIVE_OWNER.lock() {
        if lock.as_deref() == Some(owner) {
            *lock = None;
        }
    }
}

pub fn get_current_owner() -> Option<String> {
    ACTIVE_OWNER.lock().ok().and_then(|l| l.clone())
}

pub fn reset_state() {
    if let Ok(mut lock) = ACTIVE_OWNER.lock() {
        *lock = None;
    }
    if let Ok(mut map) = ACTIVE_STREAMS.lock() {
        for (_, handle) in map.drain() {
            let _ = handle.tx.send(Message::Close(None));
        }
    }
}

#[tauri::command]
pub async fn asr_native_try_acquire(owner: String) -> Result<bool, String> {
    Ok(try_acquire_owner(&owner))
}

#[tauri::command]
pub async fn asr_native_release(owner: String) -> Result<(), String> {
    release_owner(&owner);
    Ok(())
}

#[tauri::command]
pub async fn asr_native_get_owner() -> Result<Option<String>, String> {
    Ok(get_current_owner())
}

#[tauri::command]
pub async fn asr_native_reset() -> Result<(), String> {
    reset_state();
    Ok(())
}

#[tauri::command]
pub async fn asr_native_connect(
    stream_id: String,
    url: String,
    on_event: Channel<String>,
    owner: Option<String>,
) -> Result<(), String> {
    if let Some(o) = &owner {
        if !try_acquire_owner(o) {
            let current = get_current_owner().unwrap_or_default();
            return Err(format!("ASR model busy: owned by {current}"));
        }
    }

    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| {
            if let Some(o) = &owner {
                release_owner(o);
            }
            format!("Failed to connect to ASR stream: {e}")
        })?;

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    {
        let mut map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.insert(
            stream_id.clone(),
            StreamHandle {
                tx,
                owner: owner.clone(),
            },
        );
    }

    let stream_id_write = stream_id.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
        if let Ok(mut map) = ACTIVE_STREAMS.lock() {
            map.remove(&stream_id_write);
        }
    });

    let stream_id_read = stream_id.clone();
    let stream_owner = owner.clone();
    tokio::spawn(async move {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    if on_event.send(text.to_string()).is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => {
                    let _ = on_event.send("{\"type\":\"__closed__\"}".to_string());
                    break;
                }
                Err(e) => {
                    eprintln!("[asr_stream] read error: {e}");
                    let _ = on_event.send(format!("{{\"type\":\"__error__\",\"error\":\"{e}\"}}"));
                    break;
                }
                _ => {}
            }
        }
        if let Ok(mut map) = ACTIVE_STREAMS.lock() {
            map.remove(&stream_id_read);
        }
        if let Some(o) = &stream_owner {
            release_owner(o);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn asr_native_send(
    stream_id: String,
    pcm_bytes: Option<Vec<u8>>,
    text: Option<String>,
) -> Result<(), String> {
    let tx = {
        let map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.get(&stream_id).map(|h| h.tx.clone())
    };

    if let Some(tx) = tx {
        if let Some(txt) = text {
            tx.send(Message::Text(txt.into()))
                .map_err(|e| format!("Failed to send text frame: {e}"))?;
        }
        if let Some(bytes) = pcm_bytes {
            tx.send(Message::Binary(bytes.into()))
                .map_err(|e| format!("Failed to send audio frame: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn asr_native_close(stream_id: String) -> Result<(), String> {
    let handle = {
        let mut map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.remove(&stream_id)
    };

    if let Some(h) = handle {
        let _ = h.tx.send(Message::Close(None));
        if let Some(o) = &h.owner {
            release_owner(o);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[tokio::test]
    async fn test_asr_stream_owner_exclusivity() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_state();
        assert_eq!(get_current_owner(), None);

        // "them" acquires
        assert!(try_acquire_owner("them"));
        assert_eq!(get_current_owner().as_deref(), Some("them"));

        // "them" re-acquires (idempotent)
        assert!(try_acquire_owner("them"));

        // "me" cannot acquire while "them" holds
        assert!(!try_acquire_owner("me"));

        // "them" releases
        release_owner("them");
        assert_eq!(get_current_owner(), None);

        // "me" can now acquire
        assert!(try_acquire_owner("me"));
        assert_eq!(get_current_owner().as_deref(), Some("me"));

        // Wrong owner cannot release
        release_owner("them");
        assert_eq!(get_current_owner().as_deref(), Some("me"));

        release_owner("me");
        assert_eq!(get_current_owner(), None);
    }

    #[tokio::test]
    async fn test_asr_stream_map_lifecycle_and_send() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_state();
        let id = "test-asr-stream-1".to_string();
        let (tx, mut rx) = mpsc::unbounded_channel();
        {
            let mut map = ACTIVE_STREAMS.lock().unwrap();
            map.insert(
                id.clone(),
                StreamHandle {
                    tx,
                    owner: Some("me".to_string()),
                },
            );
        }
        try_acquire_owner("me");

        // Send text config
        assert!(asr_native_send(id.clone(), None, Some("{\"type\":\"config\"}".to_string())).await.is_ok());
        let msg1 = rx.recv().await.unwrap();
        match msg1 {
            Message::Text(t) => assert_eq!(t, "{\"type\":\"config\"}"),
            _ => panic!("Expected text frame"),
        }

        // Send PCM binary bytes
        assert!(asr_native_send(id.clone(), Some(vec![1, 2, 3, 4]), None).await.is_ok());
        let msg2 = rx.recv().await.unwrap();
        match msg2 {
            Message::Binary(b) => assert_eq!(&b[..], &[1, 2, 3, 4]),
            _ => panic!("Expected binary frame"),
        }

        // Close stream
        assert!(asr_native_close(id.clone()).await.is_ok());
        let msg3 = rx.recv().await.unwrap();
        match msg3 {
            Message::Close(_) => {}
            _ => panic!("Expected close frame"),
        }

        // Check map removed and owner released
        {
            let map = ACTIVE_STREAMS.lock().unwrap();
            assert!(!map.contains_key(&id));
        }
        assert_eq!(get_current_owner(), None);
    }

    #[tokio::test]
    async fn test_asr_native_reset() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_state();
        let id = "test-reset-stream".to_string();
        let (tx, mut rx) = mpsc::unbounded_channel();
        {
            let mut map = ACTIVE_STREAMS.lock().unwrap();
            map.insert(
                id.clone(),
                StreamHandle {
                    tx,
                    owner: Some("them".to_string()),
                },
            );
        }
        try_acquire_owner("them");
        assert_eq!(get_current_owner().as_deref(), Some("them"));

        assert!(asr_native_reset().await.is_ok());
        assert_eq!(get_current_owner(), None);
        {
            let map = ACTIVE_STREAMS.lock().unwrap();
            assert!(map.is_empty());
        }
        // Channel received close
        let msg = rx.recv().await.unwrap();
        assert!(matches!(msg, Message::Close(_)));
    }

    #[tokio::test]
    async fn test_asr_native_full_ws_mock_roundtrip() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_state();
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_addr = listener.local_addr().unwrap();
        let ws_url = format!("ws://{}", local_addr);

        let server_handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            // Receive config text
            if let Some(Ok(Message::Text(cfg))) = ws.next().await {
                assert!(cfg.contains("config"));
            }
            // Send transcript response
            ws.send(Message::Text("{\"type\":\"partial\",\"text\":\"hello\"}".into()))
                .await
                .unwrap();
            // Receive binary PCM
            if let Some(Ok(Message::Binary(pcm))) = ws.next().await {
                assert_eq!(&pcm[..], &[42, 43]);
            }
            // Close
            let _ = ws.close(None).await;
        });

        let channel = Channel::new(|body| {
            if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                assert!(s.contains("hello") || s.contains("__closed__"));
            }
            Ok(())
        });

        let stream_id = "test-roundtrip".to_string();
        assert!(asr_native_connect(stream_id.clone(), ws_url, channel, Some("them".to_string())).await.is_ok());
        assert_eq!(get_current_owner().as_deref(), Some("them"));

        // Send config
        assert!(asr_native_send(stream_id.clone(), None, Some("{\"type\":\"config\"}".to_string())).await.is_ok());

        // Send pcm
        assert!(asr_native_send(stream_id.clone(), Some(vec![42, 43]), None).await.is_ok());

        server_handle.await.unwrap();

        // Close stream
        assert!(asr_native_close(stream_id.clone()).await.is_ok());
        assert_eq!(get_current_owner(), None);
    }
}
