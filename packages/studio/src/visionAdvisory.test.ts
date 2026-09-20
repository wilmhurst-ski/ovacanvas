import {describe, expect, it} from 'vitest';
import {PROVIDERS} from './providers';
import {parseReviewFindings, reviewFrame} from './visionAdvisory';

const IMAGE = {mimeType: 'image/png', base64: 'AAAA'};
const ENV = {GOOGLE_API_KEY: 'test-key'} as NodeJS.ProcessEnv;

describe('parseReviewFindings', () => {
  it('reads a clean array', () => {
    const findings = parseReviewFindings(
      '[{"ruleId":"crowded-corner","message":"the labels are bunched into the bottom left"}]',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe(
      'the labels are bunched into the bottom left',
    );
    expect(findings[0].ruleId).toBe('vision:crowded-corner');
    expect(findings[0].severity).toBe('advisory');
  });

  it('accepts an empty array as the model saying the frame reads well', () => {
    expect(parseReviewFindings('[]')).toEqual([]);
  });

  it('finds the array inside prose or a code fence', () => {
    const chatty = `Sure! Here is my review:\n\`\`\`json\n[{"ruleId":"x","message":"too small to read"}]\n\`\`\`\nHope that helps.`;
    expect(parseReviewFindings(chatty)).toHaveLength(1);
  });

  it('namespaces every rule id, so a review can never be mistaken for a geometry rule', () => {
    const findings = parseReviewFindings(
      '[{"ruleId":"collision","message":"looks overlapping"}]',
    );
    // A raw `collision` here would be indistinguishable from the audit's own
    // collision rule in a report.
    expect(findings[0].ruleId).toBe('vision:collision');
  });

  it('forces advisory severity regardless of what the reply claims', () => {
    const findings = parseReviewFindings(
      '[{"ruleId":"x","message":"bad","severity":"blocking"}]',
    );
    expect(findings[0].severity).toBe('advisory');
  });

  it('drops entries with no usable message rather than inventing one', () => {
    const findings = parseReviewFindings(
      '[{"ruleId":"a","message":"real finding"},{"ruleId":"b"},{"ruleId":"c","message":"   "}]',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('real finding');
  });

  it('throws on a reply that is not an array, distinguishing it from an empty review', () => {
    expect(() => parseReviewFindings('I could not review this image.')).toThrow(
      /did not return a JSON array/,
    );
    expect(() => parseReviewFindings('{"ruleId":"x"}')).toThrow(
      /did not return a JSON array/,
    );
    expect(() => parseReviewFindings('[{')).toThrow(
      /did not return a JSON array/,
    );
  });
});

describe('reviewFrame', () => {
  it('sends the frame and returns the parsed findings', async () => {
    let seenBody = '';
    const findings = await reviewFrame(IMAGE, {
      env: ENV,
      providerSpec: PROVIDERS.gemini,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seenBody = String(init.body);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {text: '[{"ruleId":"busy","message":"too much at once"}]'},
                  ],
                },
              },
            ],
          }),
          {status: 200},
        );
      }) as unknown as typeof fetch,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('too much at once');
    // The image really travelled, in Gemini's inline_data shape.
    expect(seenBody).toContain('inline_data');
    expect(seenBody).toContain(IMAGE.base64);
  });

  it('carries the image for an OpenAI-compatible provider too', async () => {
    let seenBody = '';
    await reviewFrame(IMAGE, {
      env: {NVIDIA_API_KEY: 'test-key'} as NodeJS.ProcessEnv,
      providerSpec: PROVIDERS.nvidia,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seenBody = String(init.body);
        return new Response(
          JSON.stringify({choices: [{message: {content: '[]'}}]}),
          {status: 200},
        );
      }) as unknown as typeof fetch,
    });
    expect(seenBody).toContain('image_url');
    expect(seenBody).toContain(`data:image/png;base64,${IMAGE.base64}`);
  });

  it('throws rather than returning nothing when the key is missing', async () => {
    await expect(
      reviewFrame(IMAGE, {
        env: {} as NodeJS.ProcessEnv,
        providerSpec: PROVIDERS.gemini,
      }),
    ).rejects.toThrow(/GOOGLE_API_KEY is not set/);
  });

  it('says plainly that a text-only provider cannot review images', async () => {
    const textOnly = {...PROVIDERS.groq, bodyWithImage: undefined};
    await expect(
      reviewFrame(IMAGE, {
        env: {GROQ_API_KEY: 'k'} as NodeJS.ProcessEnv,
        providerSpec: textOnly,
      }),
    ).rejects.toThrow(/no vision model configured/);
  });

  it('surfaces a provider failure as a failed review, not an empty one', async () => {
    await expect(
      reviewFrame(IMAGE, {
        env: ENV,
        providerSpec: PROVIDERS.gemini,
        fetchImpl: (async () =>
          new Response(JSON.stringify({error: {message: 'quota'}}), {
            status: 429,
          })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/vision review call failed \(transient\)/);
  });
});
