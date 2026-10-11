// api/generate.js — 이미지 공방 서버리스 함수
// 1) 한국어 설명을 영어 이미지 프롬프트로 바꾸고 (gpt-oss-20b)
// 2) FLUX.1-schnell로 그림을 그립니다. 둘 다 NVIDIA NIM 무료 API.
// Vercel 환경변수 NVIDIA_API_KEY 필요. 없거나 실패하면 Pollinations(무료, 키 불필요)로 대신 그립니다.

const STYLES = {
  poster: 'clean modern flat poster design, bold geometric shapes, professional, high contrast',
  illust: 'warm cozy hand-drawn illustration, soft pastel colors, friendly storybook style',
  retro: 'retro vintage 1990s newtro aesthetic, grainy film texture, nostalgic color palette',
  minimal: 'minimalist banner, lots of negative space, single focal element, muted elegant tones',
  pop: 'vibrant pop art style, bright saturated colors, energetic and playful'
};
const SIZES = { square: [1024, 1024], wide: [1344, 768], tall: [768, 1344] };
const NEGATIVE = 'no text, no letters, no words, no watermark';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  const { keyword, style, ratio } = req.body || {};
  if (!keyword || !String(keyword).trim()) return res.status(400).json({ error: '무엇을 그릴지 적어주세요.' });

  const styleText = STYLES[style] || STYLES.poster;
  const [width, height] = SIZES[ratio] || SIZES.square;
  const seed = Math.floor(Math.random() * 1000000);
  const apiKey = process.env.NVIDIA_API_KEY;

  // 이미지 모델은 영어를 훨씬 잘 알아들어요. 한국어 설명을 먼저 영어로 바꿉니다.
  const ms = {};
  let t = Date.now();
  let english = String(keyword).trim().slice(0, 200);
  if (apiKey) {
    try { english = (await toEnglish(english, apiKey)) || english; } catch (e) { console.error('translate:', e.message); }
    ms.translate = Date.now() - t;
  }
  const prompt = `${english}, ${styleText}, ${NEGATIVE}`;

  let flux = null;
  if (apiKey) {
    t = Date.now();
    try {
      const deadline = Date.now() + 35000;
      let r = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ prompt, width, height, seed, steps: 4 }),
        signal: AbortSignal.timeout(35000)
      });
      flux = r.status;
      // 붐빌 때는 202(대기열)로 답하고 나중에 결과를 받아가라고 해요.
      const reqId = r.headers.get('nvcf-reqid');
      while (r.status === 202 && reqId && Date.now() < deadline) {
        await new Promise(ok => setTimeout(ok, 1500));
        r = await fetch(`https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/${reqId}`, {
          headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        flux = r.status;
      }
      if (r.status === 200) {
        const data = await r.json();
        const b64 = data?.artifacts?.[0]?.base64;
        if (b64) {
          ms.image = Date.now() - t;
          const mime = b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
          return res.status(200).json({ image: `data:${mime};base64,${b64}`, prompt: english, provider: 'nvidia', ms });
        }
      } else if (r.status !== 202) {
        console.error('FLUX error:', r.status, (await r.text()).slice(0, 300));
      }
    } catch (e) {
      console.error('flux:', e.message);
      flux = flux || e.name;
    }
    ms.image = Date.now() - t;
  }

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
            + `?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  return res.status(200).json({ url, prompt: english, provider: 'pollinations', flux, ms });
}

async function toEnglish(korean, apiKey) {
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: 'Reasoning: low\n\nRewrite the user\'s Korean description as one short English prompt for an image generation model (max 40 words). Describe only what should be seen: subject, setting, colors, mood. Never ask for text, letters or logos in the image. Output only the prompt.' },
        { role: 'user', content: korean }
      ],
      temperature: 0.4,
      max_tokens: 800,
      stream: false
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim().split('\n')[0].replace(/^["']|["']$/g, '');
  return text.slice(0, 400) || null;
}
