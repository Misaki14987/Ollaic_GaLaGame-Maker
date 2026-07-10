use serde::de::DeserializeOwned;

use super::AgentError;

pub struct Routed<T> {
    pub value: T,
    pub model: String,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

pub async fn generate_structured<T: DeserializeOwned>(
    role: &str,
    task: &str,
    context: &serde_json::Value,
    allow_local_fallback: bool,
) -> Result<Option<Routed<T>>, AgentError> {
    if cfg!(test) {
        return Ok(None);
    }
    let system = format!(
        "你是 Ollaic 的 {role} Agent。{task}\n只输出一个符合要求的 JSON 对象，不要 Markdown，不要解释。"
    );
    let user = serde_json::to_string_pretty(context)
        .map_err(|error| AgentError(format!("failed to serialize Agent context: {error}")))?;
    let Some((text, model, prompt_tokens, completion_tokens)) =
        crate::ai::commands::complete_agent_text(&system, &user)
            .await
            .map_err(|error| AgentError(format!("{role} model failed: {error}")))?
    else {
        return if allow_local_fallback {
            Ok(None)
        } else {
            Err(AgentError(format!(
                "{role} requires a configured chat model; this run did not approve local fallback"
            )))
        };
    };
    let json =
        extract_json(&text).ok_or_else(|| AgentError(format!("{role} returned no JSON object")))?;
    let value = serde_json::from_str(json)
        .map_err(|error| AgentError(format!("{role} returned invalid JSON: {error}")))?;
    Ok(Some(Routed {
        value,
        model,
        prompt_tokens,
        completion_tokens,
    }))
}

fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end >= start).then_some(&text[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_from_markdown_wrapped_response() {
        assert_eq!(
            extract_json("```json\n{\"ok\":true}\n```"),
            Some("{\"ok\":true}")
        );
    }
}
