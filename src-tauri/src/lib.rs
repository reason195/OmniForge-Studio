use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRpcCommandResponse {
    pub latency_ms: u64,
    pub rpc: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeInfo {
    pub os: &'static str,
    pub arch: &'static str,
    pub bridge_version: &'static str,
}

fn is_disallowed_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    // Block unspecified 0.0.0.0/8 and link-local / cloud metadata 169.254.0.0/16
    o[0] == 0 || (o[0] == 169 && o[1] == 254)
}

fn is_cloud_metadata_host(host: &str) -> bool {
    let trimmed = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if trimmed == "169.254.169.254"
        || trimmed == "metadata.google.internal"
        || trimmed == "metadata.goog"
        || trimmed == "0.0.0.0"
    {
        return true;
    }

    if let Ok(ip) = trimmed.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => is_disallowed_ipv4(v4),
            IpAddr::V6(v6) => {
                if let Some(mapped) = v6.to_ipv4_mapped() {
                    return is_disallowed_ipv4(mapped);
                }
                let seg = v6.segments();
                // Unspecified :: or IPv6 link-local fe80::/10
                v6.is_unspecified() || (seg[0] & 0xffc0) == 0xfe80
            }
        };
    }

    false
}

pub fn validate_endpoint_url(raw_url: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw_url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme: {other}")),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL is missing hostname".to_string())?;
    if is_cloud_metadata_host(host) {
        return Err("Blocked access to cloud metadata or unspecified host".to_string());
    }

    Ok(parsed)
}

fn build_no_redirect_client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    let clamped_ms = timeout_ms.clamp(500, 30_000);
    reqwest::Client::builder()
        .timeout(Duration::from_millis(clamped_ms))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))
}

#[tauri::command]
pub async fn mcp_jsonrpc_call(
    endpoint_url: String,
    rpc_body: Value,
    timeout_ms: Option<u64>,
) -> Result<NativeRpcCommandResponse, String> {
    let url = validate_endpoint_url(&endpoint_url)?;
    let client = build_no_redirect_client(timeout_ms.unwrap_or(4_000))?;

    let started = Instant::now();
    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&rpc_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("Request timed out: {e}")
            } else if e.is_redirect() {
                "HTTP redirect blocked by security policy".to_string()
            } else {
                format!("HTTP transport error: {e}")
            }
        })?;

    let latency_ms = started.elapsed().as_millis() as u64;
    if res.status().is_redirection() {
        return Err(format!("HTTP redirect blocked by security policy ({})", res.status()));
    }
    if !res.status().is_success() {
        return Err(format!("HTTP {} {}", res.status().as_u16(), res.status()));
    }

    let rpc: Value = res
        .json()
        .await
        .map_err(|e| format!("Invalid JSON-RPC response body: {e}"))?;

    Ok(NativeRpcCommandResponse { latency_ms, rpc })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmHttpChatRequest {
    pub endpoint_url: String,
    pub api_key: Option<String>,
    pub body: Value,
    pub timeout_ms: Option<u64>,
}

#[tauri::command]
pub async fn llm_http_chat(req: LlmHttpChatRequest) -> Result<Value, String> {
    let url = validate_endpoint_url(&req.endpoint_url)?;
    let client = build_no_redirect_client(req.timeout_ms.unwrap_or(12_000))?;

    let mut builder = client
        .post(url)
        .header("Content-Type", "application/json");
    if let Some(key) = req.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        builder = builder.header("Authorization", format!("Bearer {}", key.trim()));
    }

    let res = builder.json(&req.body).send().await.map_err(|e| {
        if e.is_timeout() {
            format!("LLM request timed out: {e}")
        } else {
            format!("LLM transport error: {e}")
        }
    })?;

    if res.status().is_redirection() {
        return Err("HTTP redirect blocked by security policy".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("LLM HTTP error: {}", res.status()));
    }

    res.json::<Value>()
        .await
        .map_err(|e| format!("Invalid LLM JSON response: {e}"))
}

#[tauri::command]
pub fn get_native_runtime_info() -> NativeRuntimeInfo {
    NativeRuntimeInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        bridge_version: "1.0.0",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mcp_jsonrpc_call,
            llm_http_chat,
            get_native_runtime_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running OmniForge Studio");
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint_url;

    #[test]
    fn allows_local_mcp_and_https_endpoints() {
        assert!(validate_endpoint_url("http://127.0.0.1:9317/mcp").is_ok());
        assert!(validate_endpoint_url("http://localhost:9318/mcp").is_ok());
        assert!(validate_endpoint_url("https://api.example.com/v1/chat/completions").is_ok());
    }

    #[test]
    fn blocks_cloud_metadata_ipv4_mapped_and_invalid_schemes() {
        assert!(validate_endpoint_url("file:///etc/passwd").is_err());
        assert!(validate_endpoint_url("ftp://127.0.0.1/file").is_err());
        assert!(validate_endpoint_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_endpoint_url("http://[::ffff:169.254.169.254]/latest").is_err());
        assert!(validate_endpoint_url("http://[::ffff:a9fe:a9fe]/latest").is_err());
        assert!(validate_endpoint_url("http://metadata.google.internal/computeMetadata/v1").is_err());
        assert!(validate_endpoint_url("http://0.0.0.0:9317/mcp").is_err());
    }
}
