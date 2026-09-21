const apiKey = 'apx_live_EMcZS4SANRLkfPQNnAjIXvJu5fhPS78dIZJVliEG';

async function test(name, bodyExtra, system, user, maxTokens = 4000) {
  console.log(`\n--- Test: ${name} (maxTokens: ${maxTokens}) ---`);
  const start = Date.now();
  try {
    const res = await fetch('https://api.apmix.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash-free',
        messages: [
          {role: 'system', content: system},
          {role: 'user', content: user},
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        ...bodyExtra,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const ms = Date.now() - start;
    const data = await res.json();
    console.log(`Status ${res.status} in ${ms}ms:`);
    if (!res.ok) {
      console.log('Error:', data);
    } else {
      const content = data.choices?.[0]?.message?.content || '';
      console.log(`Usage:`, data.usage);
      console.log(`Content length: ${content.length} chars`);
      console.log(`Content snippet: ${content.slice(0, 200)}...`);
    }
  } catch (err) {
    console.log(`Error after ${Date.now() - start}ms:`, err.message);
  }
}

async function run() {
  // Test A: Prompt instructing no thinking
  await test(
    'Instruction to skip thinking',
    {},
    'You are a code generator. Do not think, analyze, or reason. Begin your response immediately with "import " and output only TypeScript code.',
    'Topic: why a binary search halves the list each time',
    3000
  );

  // Test B: With gpt-5.6-luna-free with 500 tokens
  console.log('\n--- Test: gpt-5.6-luna-free with 500 tokens ---');
  const start = Date.now();
  try {
    const res = await fetch('https://api.apmix.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna-free',
        messages: [
          {role: 'system', content: 'You are a code generator. Output only TypeScript code.'},
          {role: 'user', content: 'Topic: solve 2x + 3 = 7 step by step'},
        ],
        max_tokens: 500,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - start;
    const data = await res.json();
    console.log(`GPT-5.6 Status ${res.status} in ${ms}ms:`);
    if (!res.ok) console.log('Error:', data);
    else {
      const content = data.choices?.[0]?.message?.content || '';
      console.log(`Usage:`, data.usage);
      console.log(`Content length: ${content.length} chars`);
      console.log(`Content snippet: ${content.slice(0, 200)}...`);
    }
  } catch (err) {
    console.log(`Error after ${Date.now() - start}ms:`, err.message);
  }
}

run();
