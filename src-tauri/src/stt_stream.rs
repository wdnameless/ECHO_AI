use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};

static ACTIVE_STREAMS: LazyLock<Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn stt_stream_connect(
    stream_id: String,
    url: String,
    on_event: Channel<String>,
) -> Result<(), String> {
    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect to STT stream: {e}"))?;

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    {
        let mut map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.insert(stream_id.clone(), tx);
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
    tokio::spawn(async move {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    if on_event.send(text.to_string()).is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => {
                    break;
                }
                Err(e) => {
                    eprintln!("[stt_stream] read error: {e}");
                    break;
                }
                _ => {}
            }
        }
        if let Ok(mut map) = ACTIVE_STREAMS.lock() {
            map.remove(&stream_id_read);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stt_stream_send(
    stream_id: String,
    pcm_bytes: Vec<u8>,
) -> Result<(), String> {
    let tx = {
        let map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.get(&stream_id).cloned()
    };

    if let Some(tx) = tx {
        tx.send(Message::Binary(pcm_bytes.into()))
            .map_err(|e| format!("Failed to send audio chunk: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn stt_stream_close(stream_id: String) -> Result<(), String> {
    let tx = {
        let mut map = ACTIVE_STREAMS.lock().map_err(|e| e.to_string())?;
        map.remove(&stream_id)
    };

    if let Some(tx) = tx {
        let _ = tx.send(Message::Close(None));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_stt_stream_map_lifecycle() {
        let id = "test-stream-lifecycle".to_string();
        let (tx, _rx) = mpsc::unbounded_channel();
        {
            let mut map = ACTIVE_STREAMS.lock().unwrap();
            map.insert(id.clone(), tx);
        }
        assert!(stt_stream_send(id.clone(), vec![1, 2, 3]).await.is_ok());
        assert!(stt_stream_close(id.clone()).await.is_ok());
        {
            let map = ACTIVE_STREAMS.lock().unwrap();
            assert!(!map.contains_key(&id));
        }
    }
}
