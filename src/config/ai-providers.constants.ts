export const AI_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI (GPT-4o, GPT-4o-mini, o3-mini)",
    curl: `curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "claude",
    name: "Anthropic Claude (3.7 Sonnet, 3.5 Haiku)",
    curl: `curl https://api.anthropic.com/v1/messages \\
  -H "x-api-key: {{API_KEY}}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "anthropic-dangerous-direct-browser-access: true" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "system": "{{SYSTEM_PROMPT}}",
    "messages": [{"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "{{IMAGE}}"}}]}],
    "max_tokens": 1024
  }'`,
    responseContentPath: "content[0].text",
    streaming: true,
  },
  {
    id: "grok",
    name: "xAI Grok",
    curl: `curl https://api.x.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "gemini",
    name: "Google Gemini (2.5 Flash, 3.7 Flash, Thinking)",
    curl: `curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "reasoning_effort": "{{REASONING_EFFORT}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    curl: `curl https://api.mistral.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": "data:image/png;base64,{{IMAGE}}"}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "cohere",
    name: "Cohere",
    curl: `curl -X POST https://api.cohere.ai/v2/chat \\
    -H "Authorization: Bearer {{API_KEY}}" \\
    -H "Content-Type: application/json" \\
    -d '{
      "model": "{{MODEL}}",
      "preamble": "{{SYSTEM_PROMPT}}",
      "messages": [{"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
    }'`,
    responseContentPath: "message.content[0].text",
    streaming: true,
  },
  {
    id: "groq",
    name: "Groq (Llama 3.3 70B, Llama 3.1 8B - Fastest)",
    curl: `curl https://api.groq.com/openai/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer {{API_KEY}}" \\
    -d '{
      "model": "{{MODEL}}",
      "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}],
      "temperature": 1,
      "max_completion_tokens": 8192,
      "top_p": 1,
      "stream": true,
      "reasoning_effort": "{{REASONING_EFFORT}}",
      "stop": null
    }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "perplexity",
    name: "Perplexity AI",
    curl: `curl -X POST https://api.perplexity.ai/chat/completions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter (all models)",
    curl: `  curl https://openrouter.ai/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    curl: `curl -X POST http://localhost:11434/v1/chat/completions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "nullform-gateway",
    name: "Nullform Gateway (nullform.cv)",
    curl: `curl https://ai-gateway.nullform.cv/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
];
