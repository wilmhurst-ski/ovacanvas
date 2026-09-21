const apiKey = 'apx_live_EMcZS4SANRLkfPQNnAjIXvJu5fhPS78dIZJVliEG';

async function testModel(model, maxTokens, systemText, userText) {
  console.log(`\n=== Testing model="${model}" maxTokens=${maxTokens} promptLen=${systemText.length + userText.length} ===`);
  const start = Date.now();
  try {
    const res = await fetch('https://api.apmix.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {role: 'system', content: systemText},
          {role: 'user', content: userText},
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const ms = Date.now() - start;
    console.log(`Status: ${res.status} in ${ms}ms`);
    const data = await res.json();
    if (!res.ok) {
      console.log('Error payload:', data);
    } else {
      const content = data.choices?.[0]?.message?.content || '';
      console.log(`Success! Response length: ${content.length} chars, tokens:`, data.usage);
      console.log(`Preview: ${content.slice(0, 150)}...`);
    }
  } catch (e) {
    console.log(`Failed after ${Date.now() - start}ms:`, e.message);
  }
}

async function main() {
  // Test 1: Quick check gpt-5.6-luna-free
  await testModel('gpt-5.6-luna-free', 100, 'Answer briefly.', 'What is photosynthesis?');

  // Test 2: Quick check deepseek-v4.1-flash-free
  await testModel('deepseek-v4.1-flash-free', 100, 'Answer briefly.', 'What is photosynthesis?');

  // Test 3: Larger max_tokens with deepseek-v4.1-flash-free
  await testModel('deepseek-v4.1-flash-free', 2000, 'You write TypeScript scene code for OvaCanvas. Output code only.', 'Topic: why a binary search halves the list each time');

  // Test 4: Larger max_tokens with gpt-5.6-luna-free
  await testModel('gpt-5.6-luna-free', 2000, 'You write TypeScript scene code for OvaCanvas. Output code only.', 'Topic: why a binary search halves the list each time');
}

main();
