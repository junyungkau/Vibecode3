// api/generate.js — 학교 행사 배너/썸네일 이미지 생성 (FLUX.1-schnell)
// NVIDIA API 키는 여기서만 사용됩니다. Vercel 환경변수 NVIDIA_API_KEY 필요.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '서버에 NVIDIA_API_KEY가 없습니다.' });

  const { keyword, style, ratio } = req.body || {};
  if (!keyword) return res.status(400).json({ error: '무엇을 그릴지 입력해주세요.' });

  // 한국어 키워드 + 스타일 프리셋을 영어 프롬프트로 조립
  // (이미지 모델은 영어 프롬프트에서 품질이 더 안정적입니다)
  const styleMap = {
    '깔끔한 포스터': 'clean modern flat poster design, bold geometric shapes, professional, high contrast, vector style',
    '따뜻한 일러스트': 'warm cozy hand-drawn illustration, soft pastel colors, friendly, storybook style',
    '레트로 감성': 'retro vintage aesthetic, 80s 90s style, grainy texture, nostalgic color palette',
    '미니멀 배너': 'minimalist banner, lots of negative space, single focal element, muted tones, elegant',
    '팝아트 활기': 'vibrant pop art style, bright saturated colors, energetic, playful, bold outlines'
  };
  const ratioMap = {
    '정사각형 (인스타)': { width: 1024, height: 1024 },
    '가로 (배너/썸네일)': { width: 1344, height: 768 },
    '세로 (포스터)': { width: 768, height: 1344 }
  };
  const stylePrompt = styleMap[style] || styleMap['깔끔한 포스터'];
  const size = ratioMap[ratio] || ratioMap['정사각형 (인스타)'];

  const prompt = `${keyword}, ${stylePrompt}, no text, no letters, no words`;

  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/infer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'black-forest-labs/flux.1-schnell',
        prompt,
        width: size.width,
        height: size.height,
        steps: 4,
        seed: Math.floor(Math.random() * 1000000)
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('NVIDIA image API error:', r.status, errText);
      return res.status(502).json({ error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }

    const data = await r.json();
    // FLUX NIM은 artifacts[].base64 형태로 응답합니다
    const b64 = data?.artifacts?.[0]?.base64 || data?.image || data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error('이미지 데이터 없음:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: '이미지 응답을 해석하지 못했습니다.' });
    }

    return res.status(200).json({ image: `data:image/png;base64,${b64}`, prompt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
