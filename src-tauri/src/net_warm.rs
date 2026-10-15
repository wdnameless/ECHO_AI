use std::sync::LazyLock;
use std::time::Instant;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

#[tauri::command]
pub async fn warm_llm_connection(url: String) -> Result<u64, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https protocols are supported".to_string());
    }

    let start = Instant::now();
    let timeout = std::time::Duration::from_millis(3000);
    let res = match HTTP_CLIENT.head(&url).timeout(timeout).send().await {
        Ok(resp) => Ok(resp),
        Err(_) => HTTP_CLIENT.get(&url).timeout(timeout).send().await,
    };

    match res {
        Ok(_) => {
            let rtt = start.elapsed().as_millis() as u64;
            log::info!("[net_warm] warm_llm_connection: url={}, rtt={}ms", url, rtt);
            Ok(rtt)
        }
        Err(e) => Err(format!("Warmup connection failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_warm_llm_connection_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://127.0.0.1:{}", addr.port());

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let rtt = warm_llm_connection(url).await.expect("warmup should succeed");
        assert!(rtt < 5000);
    }

    #[tokio::test]
    async fn test_warm_llm_connection_invalid_url() {
        let res = warm_llm_connection("ftp://not-supported".to_string()).await;
        assert!(res.is_err());
    }
}
