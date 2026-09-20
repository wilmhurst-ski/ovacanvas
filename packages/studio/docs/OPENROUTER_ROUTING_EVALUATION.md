# Architectural Evaluation: OpenRouter vs. Multi-Provider Direct Routing

**Date:** September 2026  
**Status:** Evaluation Completed — Decision: **RETAIN DIRECT CLIENTS WITH
OPENROUTER AS OPTIONAL GATEWAY (NO-GO ON MANDATORY MIGRATION)**  
**Reference:** [MASTER_BUILD_PLAN.md](file:///c:/Users/WILMHURST/Desktop/mvp2/readme/MASTER_BUILD_PLAN.md)
§5 Phase 3,
[RESEARCH_FINDINGS.md](file:///c:/Users/WILMHURST/Desktop/mvp2/readme/RESEARCH_FINDINGS.md)
§7

---

## 1. Context and Problem Statement

OvaCanvas currently maintains a declarative provider registry (`ProviderSpec` in
`packages/studio/src/providers.ts`) supporting five direct providers (`gemini`,
`groq`, `huggingface`, `tokenharbor`, `nvidia`) plus an `openrouter` client.

Phase 3 requires evaluating whether to collapse the direct provider integrations
into a single OpenRouter client, leveraging OpenRouter's hosted multi-model
routing and automatic fallback, rather than maintaining multiple direct-provider
client endpoints.

---

## 2. Comparative Analysis

| Dimension                       | Direct Provider Integrations (Current Architecture)                                                                                                                 | OpenRouter Hosted Gateway                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Network Hop & Latency**       | **Direct to origin API** (e.g. Google, Groq). Minimal round-trip latency (~200–600ms), essential for meeting the **4s soft / 8s hard time-to-first-visual target**. | **Additional intermediate proxy hop** through OpenRouter infrastructure, adding 150–400ms transport latency.                       |
| **Developer Cost & Free Tiers** | **Zero cost**. Leverages individual developer free tiers across Google AI Studio, Groq Cloud, and Hugging Face.                                                     | **Requires prepaid account balance** or funded API key; free tier models are shared and heavily rate-limited.                      |
| **Rate Limit Handling**         | **Handled locally** via in-process `KeyRotator` on HTTP 429 without external dependencies or fees.                                                                  | Handled upstream by OpenRouter (if model fallbacks are configured in route).                                                       |
| **Code Maintenance**            | **Minimal overhead**. All providers share `openAiCompatible()` helper (or minimal query param mapping for Gemini); total transport code is <200 lines.              | Single endpoint, but requires vendor model mapping and reliance on third-party uptime.                                             |
| **Failure Isolation**           | **Independent failure domains**. An outage or rate-limit at one vendor leaves other direct providers completely unaffected.                                         | **Single point of failure**. If OpenRouter API is unreachable, degraded, or experiencing billing issues, all authoring paths fail. |

---

## 3. Findings from Live Environment

1. **Credential Availability**: The active environment (`.env.local`) holds
   direct keys for Google, Groq, Hugging Face, NVIDIA, and Token Harbor, but no
   funded `OPENROUTER_API_KEY`. Migrating exclusively to OpenRouter would break
   testing and local operation for this development environment.
2. **Rate Limit Resilience**: The implementation of `KeyRotator` and
   `resolveProviderKeys` in Phase 3 Task 1 resolves the free-tier rate-limit
   issue locally by distributing traffic across multiple keys per provider
   before exhausting attempts or failing over.
3. **Transport Homogeneity**: Over 90% of the provider code is already unified
   behind `openAiCompatible()` in `packages/studio/src/providers.ts`.
   Maintaining direct specs carries negligible ongoing maintenance cost.

---

## 4. Go / No-Go Decision and Rationale

### **DECISION: NO-GO for mandatory OpenRouter migration.**

### Operational Strategy:

1. **Primary**: Retain direct provider adapters (`gemini`, `groq`,
   `huggingface`, `tokenharbor`, `nvidia`) with local `KeyRotator` multi-key
   rotation on HTTP 429.
2. **Secondary / Enterprise**: Retain `openrouter` as a fully-supported,
   selectable provider (`OVACANVAS_PROVIDER=openrouter`) for deployment
   environments that have funded OpenRouter accounts and prefer centralized
   billing.
