use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::{redirect::Policy as RedirectPolicy, Response, Url};

const MAX_REDIRECTS: usize = 5;
pub const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_AUDIO_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpectedMedia {
    Image,
    Audio,
}

impl ExpectedMedia {
    pub fn from_extension(extension: &str) -> Self {
        match extension.to_ascii_lowercase().as_str() {
            "wav" | "mp3" | "ogg" | "flac" | "m4a" | "aac" => Self::Audio,
            _ => Self::Image,
        }
    }

    fn max_bytes(self) -> usize {
        match self {
            Self::Image => MAX_IMAGE_BYTES,
            Self::Audio => MAX_AUDIO_BYTES,
        }
    }

    fn accepts(self, content_type: &str) -> bool {
        let mime = content_type.split(';').next().unwrap_or("").trim();
        match self {
            Self::Image => mime.starts_with("image/"),
            Self::Audio => mime.starts_with("audio/"),
        }
    }
}

pub async fn fetch_generated_media(
    url: &str,
    expected: ExpectedMedia,
    deadline: Duration,
) -> Result<Vec<u8>, String> {
    with_deadline(deadline, fetch_inner(url, expected)).await
}

async fn with_deadline<T>(
    deadline: Duration,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(deadline, future)
        .await
        .map_err(|_| format!("下载生成媒体超时（{} 毫秒）", deadline.as_millis()))?
}

async fn fetch_inner(url: &str, expected: ExpectedMedia) -> Result<Vec<u8>, String> {
    let mut current = validate_media_download_url(url)?;
    let mut visited = HashSet::new();

    for hop in 0..=MAX_REDIRECTS {
        if !visited.insert(current.clone()) {
            return Err("媒体下载重定向形成循环".to_string());
        }
        let host = current
            .host_str()
            .ok_or_else(|| "下载 URL 缺少主机名".to_string())?
            .to_string();
        let port = current
            .port_or_known_default()
            .ok_or_else(|| "下载 URL 缺少有效端口".to_string())?;
        let addresses = resolve_public_addresses(&host, port).await?;
        let client = reqwest::Client::builder()
            .redirect(RedirectPolicy::none())
            // A configured system proxy could route a validated public name to
            // an internal destination, so generated-media fetches never trust it.
            .no_proxy()
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|error| format!("创建安全下载客户端失败: {error}"))?;
        let response = client
            .get(current.clone())
            .send()
            .await
            .map_err(|error| format!("下载生成媒体失败: {error}"))?;

        if response.status().is_redirection() {
            if hop == MAX_REDIRECTS {
                return Err(format!("媒体下载重定向超过 {MAX_REDIRECTS} 次"));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .ok_or_else(|| "媒体下载重定向缺少 Location".to_string())?
                .to_str()
                .map_err(|_| "媒体下载重定向 Location 不是有效文本".to_string())?;
            current = validate_redirect_target(&current, location)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("媒体下载失败 ({})", response.status()));
        }
        return read_bounded_response(response, expected).await;
    }
    unreachable!("redirect loop exits by return")
}

pub async fn read_bounded_response(
    response: Response,
    expected: ExpectedMedia,
) -> Result<Vec<u8>, String> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "媒体响应缺少 Content-Type".to_string())?;
    if !expected.accepts(content_type) {
        return Err(format!("媒体响应类型不匹配: {content_type}"));
    }
    let max_bytes = expected.max_bytes();
    if let Some(length) = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        if length > max_bytes as u64 {
            return Err(format!("媒体响应超过大小限制: {length} > {max_bytes}"));
        }
    }
    collect_bounded(response.bytes_stream(), max_bytes).await
}

async fn collect_bounded<S, E>(mut stream: S, max_bytes: usize) -> Result<Vec<u8>, String>
where
    S: futures_util::Stream<Item = Result<bytes::Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取生成媒体失败: {error}"))?;
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "媒体响应大小溢出".to_string())?;
        if next_len > max_bytes {
            return Err(format!("媒体响应超过大小限制: {next_len} > {max_bytes}"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub fn validate_media_download_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("无效的下载 URL: {error}"))?;
    match url.scheme() {
        "https" | "http" => {}
        scheme => return Err(format!("不允许的下载协议: {scheme}")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("媒体下载 URL 不允许包含用户凭据".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "下载 URL 缺少主机名".to_string())?;
    validate_host_name(host)?;
    Ok(url)
}

fn validate_redirect_target(base: &Url, location: &str) -> Result<Url, String> {
    let target = base
        .join(location)
        .map_err(|error| format!("无效的媒体重定向: {error}"))?;
    validate_media_download_url(target.as_str())
}

fn validate_host_name(host: &str) -> Result<(), String> {
    let lower = host.trim_end_matches('.').to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err(format!("拒绝下载内部/保留地址: {host}"));
    }
    let bare = lower.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<IpAddr>() {
        validate_public_ip(ip)?;
    }
    Ok(())
}

async fn resolve_public_addresses(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| format!("解析媒体下载主机失败: {error}"))?
        .collect();
    validate_resolved_addresses(host, &addresses)?;
    Ok(addresses)
}

fn validate_resolved_addresses(host: &str, addresses: &[SocketAddr]) -> Result<(), String> {
    if addresses.is_empty() {
        return Err(format!("媒体下载主机没有可用地址: {host}"));
    }
    for address in addresses {
        validate_public_ip(address.ip())?;
    }
    Ok(())
}

fn validate_public_ip(ip: IpAddr) -> Result<(), String> {
    let forbidden = match ip {
        IpAddr::V4(ip) => forbidden_v4(ip),
        IpAddr::V6(ip) => forbidden_v6(ip),
    };
    if forbidden {
        Err(format!("拒绝下载内部/保留地址: {ip}"))
    } else {
        Ok(())
    }
}

fn forbidden_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || a == 0
        || a >= 240
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
}

fn forbidden_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return forbidden_v4(mapped);
    }
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || (segments[0] & 0xffc0) == 0xfec0
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;

    #[test]
    fn media_fetch_rejects_private_multicast_local_and_redirect_targets() {
        for url in [
            "http://127.0.0.1/media.png",
            "http://224.0.0.1/media.png",
            "http://metadata.local/media.png",
            "http://[::1]/media.png",
        ] {
            assert!(validate_media_download_url(url).is_err(), "{url}");
        }
        let base = Url::parse("https://example.com/image.png").unwrap();
        assert!(validate_redirect_target(&base, "http://10.0.0.1/private").is_err());
    }

    #[test]
    fn media_fetch_rejects_hostname_when_any_dns_answer_is_private() {
        let answers = [
            "93.184.216.34:443".parse().unwrap(),
            "10.0.0.8:443".parse().unwrap(),
        ];
        assert!(validate_resolved_addresses("mixed.example", &answers).is_err());
        assert!(validate_resolved_addresses(
            "public.example",
            &["93.184.216.34:443".parse().unwrap()]
        )
        .is_ok());
    }

    #[tokio::test]
    async fn media_fetch_stops_unknown_length_body_at_streaming_limit() {
        let chunks = stream::iter([
            Ok::<_, String>(bytes::Bytes::from_static(b"1234")),
            Ok(bytes::Bytes::from_static(b"5678")),
        ]);
        let error = collect_bounded(chunks, 6).await.unwrap_err();
        assert!(error.contains("大小限制"));
    }

    #[tokio::test]
    async fn media_fetch_stops_slow_body_at_total_deadline() {
        let error = with_deadline(Duration::from_millis(10), async {
            std::future::pending::<()>().await;
            Ok::<_, String>(())
        })
        .await
        .unwrap_err();
        assert!(error.contains("超时"));
    }

    #[test]
    fn media_fetch_content_type_is_capability_specific() {
        assert!(ExpectedMedia::Image.accepts("image/png; charset=binary"));
        assert!(!ExpectedMedia::Image.accepts("audio/mpeg"));
        assert!(ExpectedMedia::Audio.accepts("audio/wav"));
        assert!(!ExpectedMedia::Audio.accepts("text/html"));
    }
}
