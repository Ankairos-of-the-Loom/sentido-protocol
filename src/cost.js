import { readJsonl } from "./store.js";
import { USAGE_FILE } from "./paths.js";

export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

export function calculateCost({ inputTokens = 0, outputTokens = 0 }, prices) {
  if (prices.input == null || prices.output == null) return null;
  return (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output;
}

export async function totalRecordedCost() {
  const entries = await readJsonl(USAGE_FILE);
  return entries.reduce((sum, entry) => sum + (Number(entry.estimated_cost_usd) || 0), 0);
}

export async function preflightBudget({ inputText, maxOutputTokens, prices, hardCap }) {
  const spent = await totalRecordedCost();
  const projected = calculateCost({
    inputTokens: estimateTokens(inputText),
    outputTokens: maxOutputTokens
  }, prices);

  if (projected == null) {
    return { ok: false, reason: "Pricing is not configured. Add verified input and output prices to .env.", spent, projected: null };
  }
  if (spent + projected > hardCap) {
    return { ok: false, reason: `This request could exceed the $${hardCap.toFixed(2)} local cap.`, spent, projected };
  }
  return { ok: true, spent, projected };
}
