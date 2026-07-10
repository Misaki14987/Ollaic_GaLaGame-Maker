use serde::de::DeserializeOwned;
use std::future::Future;

use super::AgentError;

type ModelCompletion = (String, String, Option<u32>, Option<u32>);

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
    let Some(first) = crate::ai::commands::complete_agent_text(&system, &user)
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
    let (value, (_, model, prompt_tokens, completion_tokens)) = repair_once(
        role,
        task,
        &user,
        first,
        |repair_system, repair_user| async move {
            crate::ai::commands::complete_agent_text(&repair_system, &repair_user).await
        },
    )
    .await?;
    Ok(Some(Routed {
        value,
        model,
        prompt_tokens,
        completion_tokens,
    }))
}

async fn repair_once<T, F, Fut>(
    role: &str,
    task: &str,
    original_context: &str,
    first: ModelCompletion,
    repair: F,
) -> Result<(T, ModelCompletion), AgentError>
where
    T: DeserializeOwned,
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Result<Option<ModelCompletion>, String>>,
{
    let first_error = match parse_structured::<T>(role, &first.0) {
        Ok(value) => return Ok((value, first)),
        Err(error) => error,
    };
    let repair_system = format!(
        "你是 Ollaic 的 JSON 修复器。原角色是 {role}，原任务是：{task}\n根据校验错误修复响应，只输出一个完整 JSON 对象，不要 Markdown，不要解释。"
    );
    let repair_user = format!(
        "原始任务上下文：\n{original_context}\n\n校验错误：\n{}\n\n需要修复的响应：\n{}",
        first_error.0, first.0
    );
    let Some(mut second) = repair(repair_system, repair_user)
        .await
        .map_err(|error| AgentError(format!("{role} JSON repair failed: {error}")))?
    else {
        return Err(first_error);
    };
    let value = parse_structured::<T>(role, &second.0).map_err(|second_error| {
        AgentError(format!(
            "{}; automatic repair also failed: {}",
            first_error.0, second_error.0
        ))
    })?;
    second.2 = first.2.zip(second.2).map(|(a, b)| a.saturating_add(b));
    second.3 = first.3.zip(second.3).map(|(a, b)| a.saturating_add(b));
    Ok((value, second))
}

fn parse_structured<T: DeserializeOwned>(role: &str, text: &str) -> Result<T, AgentError> {
    let json =
        extract_json(text).ok_or_else(|| AgentError(format!("{role} returned no JSON object")))?;
    serde_json::from_str(json).map_err(|error| {
        AgentError(format!(
            "{role} returned JSON with an invalid structure: {error}"
        ))
    })
}

fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end >= start).then_some(&text[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn extracts_json_from_markdown_wrapped_response() {
        assert_eq!(
            extract_json("```json\n{\"ok\":true}\n```"),
            Some("{\"ok\":true}")
        );
    }

    #[derive(Deserialize)]
    struct RequiredResponse {
        id: String,
    }

    #[tokio::test]
    async fn repairs_an_invalid_structure_once_and_counts_both_calls() {
        let first = ("{}".to_string(), "model-a".to_string(), Some(2), Some(3));
        let (value, completion) = repair_once::<RequiredResponse, _, _>(
            "Test Agent",
            "返回 id",
            "{}",
            first,
            |system, user| async move {
                assert!(system.contains("JSON 修复器"));
                assert!(user.contains("missing field `id`"));
                Ok(Some((
                    r#"{"id":"fixed"}"#.to_string(),
                    "model-a".to_string(),
                    Some(5),
                    Some(7),
                )))
            },
        )
        .await
        .unwrap();

        assert_eq!(value.id, "fixed");
        assert_eq!(completion.2, Some(7));
        assert_eq!(completion.3, Some(10));
    }
}
