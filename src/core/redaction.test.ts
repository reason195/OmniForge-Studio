import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoPlaintextSecrets,
  isSensitiveKey,
  redactTrafficPayload,
} from './redaction';

test('isSensitiveKey detects standard auth, cookie, token, secret, password, and phone keys', () => {
  assert.equal(isSensitiveKey('Authorization'), true);
  assert.equal(isSensitiveKey('Cookie'), true);
  assert.equal(isSensitiveKey('Set-Cookie'), true);
  assert.equal(isSensitiveKey('x-api-key'), true);
  assert.equal(isSensitiveKey('access_token'), true);
  assert.equal(isSensitiveKey('client_secret'), true);
  assert.equal(isSensitiveKey('password'), true);
  assert.equal(isSensitiveKey('userPhone'), true);
  assert.equal(isSensitiveKey('buttonText'), false);
  assert.equal(isSensitiveKey('browseSeconds'), false);
});

test('redactTrafficPayload masks sensitive keys, regex credentials, phones, and truncates long values', () => {
  const raw = {
    requestHeaders: {
      Authorization: 'Bearer abcdef1234567890xyz',
      Cookie: 'sid=998877; pt_key=secret123',
      Host: 'ms.jr.jd.com',
    },
    url: 'https://ms.jr.jd.com/task?token=topsecret999&channel=daily',
    phone: '13912345678',
    note: 'Contact 13800138000 or qa@example.com with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig123456',
    longText: 'A'.repeat(700),
    items: Array.from({ length: 30 }, (_, idx) => ({ id: idx })),
  };

  const report = redactTrafficPayload(raw, { maxStringLength: 100, maxArrayLength: 10 });
  const out = report.redactedPayload as Record<string, any>;

  assert.equal(out.requestHeaders.Authorization, '[REDACTED]');
  assert.equal(out.requestHeaders.Cookie, '[REDACTED]');
  assert.equal(out.requestHeaders.Host, 'ms.jr.jd.com');
  assert.equal(out.phone, '[REDACTED]');
  assert.match(out.url, /token=\[REDACTED\]/);
  assert.match(out.note, /138\*\*\*\*8000/);
  assert.match(out.note, /\[REDACTED_EMAIL\]/);
  assert.match(out.note, /\[REDACTED_JWT\]/);
  assert.match(out.longText, /\.\.\.\[TRUNCATED:700chars\]$/);
  assert.equal(out.items.length, 11);
  assert.match(String(out.items[10]), /\[TRUNCATED_ARRAY:20_MORE\]/);
  assert.ok(report.redactedKeyCount >= 3);
  assert.ok(report.maskedPatternCount >= 4);
  assert.ok(report.truncatedCount >= 2);
});

test('assertNoPlaintextSecrets flags leaked API keys or Bearer tokens', () => {
  const clean = 'var RUNTIME_VARS = {"refinedKeywords": {"value": ["去签到"]}};';
  assert.deepEqual(assertNoPlaintextSecrets(clean), []);

  const leaked = 'var key = "AIzaSyD1234567890abcdefghij123456"; var auth = "Bearer abcdef1234567890xyz";';
  const findings = assertNoPlaintextSecrets(leaked);
  assert.ok(findings.includes('Google API Key'));
  assert.ok(findings.includes('Bearer Credential'));
});
