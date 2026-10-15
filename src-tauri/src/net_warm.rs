use std::sync::LazyLock;
use std::time::Instant;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

pub async fn warm_llm_connection_client(client: &reqwest::Client, url: &str) -> Result<u64, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https protocols are supported".to_string());
    }

    let start = Instant::now();
    // Warm the TCP + TLS connection. A HEAD request initiates connection and handshake
    // without downloading response body. If HEAD fails or is rejected, fall back to GET.
    let head_result = client
        .head(url)
        .timeout(std::time::Duration::from_millis(3000))
        .send()
        .await;

    let res = match head_result {
        Ok(resp) => Ok(resp),
        Err(_) => {
            client
                .get(url)
                .timeout(std::time::Duration::from_millis(3000))
                .send()
                .await
        }
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

#[tauri::command]
pub async fn warm_llm_connection(url: String) -> Result<u64, String> {
    warm_llm_connection_client(&HTTP_CLIENT, &url).await
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
