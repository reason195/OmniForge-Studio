export interface RedactionOptions {
  maxStringLength?: number;
  maxArrayLength?: number;
  maxDepth?: number;
}

export interface RedactionReport {
  redactedKeyCount: number;
  maskedPatternCount: number;
  truncatedCount: number;
  redactedPayload: unknown;
}

const SENSITIVE_KEY_REGEX =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|id[-_]?token|csrf[-_]?token|secret|client[-_]?secret|app[-_]?secret|password|passwd|pwd|phone|mobile|tel|telephone|session|session[-_]?id|sid|signature|sign|credential|private[-_]?key|ssn|id[-_]?card|bank[-_]?card|cvv)$/i;

const SENSITIVE_KEY_CONTAINS_REGEX =
  /(authorization|cookie|secret|password|passwd|token|apikey|api_key|private_key|credential|phone|mobile)/i;

const SECRET_STRING_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  {
    name: 'bearer_token',
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    name: 'api_key_prefix',
    regex: /\b(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{16,}|ghp_[0-9A-Za-z]{20,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'query_secret_param',
    regex: /([?&](?:token|access_token|secret|password|phone|mobile|key|api_key|sign|sig|cookie)=)([^&#\s]+)/gi,
    replacement: '$1[REDACTED]',
  },
  {
    name: 'cn_mobile',
    regex: /(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g,
    replacement: '$1****$2',
  },
  {
    name: 'intl_phone',
    regex: /(\+\d{1,3}[-\s]?)\d{3,4}[-\s]?\d{3,4}[-\s]?(\d{2,4})/g,
    replacement: '$1***-$2',
  },
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED_EMAIL]',
  },
];

export function isSensitiveKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) return false;
  return SENSITIVE_KEY_REGEX.test(normalized) || SENSITIVE_KEY_CONTAINS_REGEX.test(normalized);
}

export function redactTextPatterns(
  input: string,
  maxStringLength = 512,
): { text: string; maskedCount: number; truncated: boolean } {
  let text = input;
  let maskedCount = 0;

  for (const rule of SECRET_STRING_PATTERNS) {
    rule.regex.lastIndex = 0;
    const matches = text.match(rule.regex);
    if (matches && matches.length > 0) {
      maskedCount += matches.length;
      text = text.replace(rule.regex, rule.replacement);
    }
  }

  let truncated = false;
  if (text.length > maxStringLength) {
    text = `${text.slice(0, maxStringLength)}...[TRUNCATED:${input.length}chars]`;
    truncated = true;
  }

  return { text, maskedCount, truncated };
}

export function redactTrafficPayload(
  payload: unknown,
  options: RedactionOptions = {},
): RedactionReport {
  const maxStringLength = options.maxStringLength ?? 512;
  const maxArrayLength = options.maxArrayLength ?? 20;
  const maxDepth = options.maxDepth ?? 8;

  let redactedKeyCount = 0;
  let maskedPatternCount = 0;
  let truncatedCount = 0;

  function walk(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      const { text, maskedCount, truncated } = redactTextPatterns(value, maxStringLength);
      maskedPatternCount += maskedCount;
      if (truncated) truncatedCount += 1;
      return text;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (depth >= maxDepth) {
      truncatedCount += 1;
      return '[TRUNCATED_MAX_DEPTH]';
    }

    if (Array.isArray(value)) {
      const sliced = value.slice(0, maxArrayLength);
      const mapped = sliced.map((item) => walk(item, depth + 1));
      if (value.length > maxArrayLength) {
        truncatedCount += 1;
        mapped.push(`[TRUNCATED_ARRAY:${value.length - maxArrayLength}_MORE]`);
      }
      return mapped;
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(k)) {
          redactedKeyCount += 1;
          result[k] = '[REDACTED]';
        } else {
          result[k] = walk(v, depth + 1);
        }
      }
      return result;
    }

    return String(value);
  }

  const redactedPayload = walk(payload, 0);

  return {
    redactedKeyCount,
    maskedPatternCount,
    truncatedCount,
    redactedPayload,
  };
}

const EXPORT_FORBIDDEN_SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{20,}/ },
  { label: 'OpenAI/Secret Key', regex: /sk-[0-9A-Za-z]{16,}/ },
  { label: 'GitHub PAT', regex: /ghp_[0-9A-Za-z]{20,}/ },
  { label: 'Bearer Credential', regex: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { label: 'Hardcoded GEMINI_API_KEY', regex: /GEMINI_API_KEY\s*[:=]\s*["'][^"']{8,}["']/i },
  { label: 'Hardcoded MCP Token', regex: /MCP_TOKEN\s*[:=]\s*["'][^"']{8,}["']/i },
];

export function assertNoPlaintextSecrets(scriptText: string): string[] {
  const findings: string[] = [];
  for (const item of EXPORT_FORBIDDEN_SECRET_PATTERNS) {
    if (item.regex.test(scriptText)) {
      findings.push(item.label);
    }
  }
  return findings;
}
