export async function createResponse({ apiKey, model, instructions, messages, maxOutputTokens }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions,
      input: messages.map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: maxOutputTokens,
      store: false
    })
  });
  const body = await response.json();
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const text = body.output_text || (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
  return {
    id: body.id,
    text,
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
      total_tokens: body.usage?.total_tokens ?? 0
    }
  };
}
