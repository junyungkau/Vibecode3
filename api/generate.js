// api/generate.js
// 학교 행사 배너/썸네일 이미지 생성 (NVIDIA FLUX.1-schnell)
// NVIDIA API 키는 여기서만 사용됩니다. Vercel 환경변수 NVIDIA_API_KEY 필요.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '서버에 NVIDIA_API_KEY가 설정되지 않았습니다.' });

  const { keyword, style, ratio } = req.body || {};
  if (!keyword) return res.status(400).json({ error: '무엇을 그릴지 입력해주세요.' });

  // 한국어 스타일 프리셋을 영어 프롬프트로 조립 (이미지 모델은 영어에서 더 안정적)
  const styleMap = {
    '깔끔한 포스터': 'clean modern flat poster design, bold geometric shapes, professional, high contrast, vector style',
    '따뜻한 일러스트': 'warm cozy hand-drawn illustration, soft pastel colors, friendly, storybook style',
    '레트로 감성': 'retro vintage aesthetic, 80s 90s style, grainy texture, nostalgic color palette',
    '미니멀 배너': 'minimalist banner, lots of negative space, single focal element, muted tones, elegant',
    '팝아트 활기': 'vibrant pop art style, bright saturated colors, energetic, playful, bold outlines'
  };
  // FLUX.1-schnell이 지원하는 해상도만 사용
  const ratioMap = {
    '정사각형 (인스타)': { width: 1024, height: 1024 },
    '가로 (배너/썸네일)': { width: 1344, height: 768 },
    '세로 (포스터)': { width: 768, height: 1344 }
  };
  const stylePrompt = styleMap[style] || styleMap['깔끔한 포스터'];
  const size = ratioMap[ratio] || ratioMap['정사각형 (인스타)'];

  const prompt = `${keyword}, ${stylePrompt}, no text, no letters, no words`;

  try {
    // 올바른 클라우드 엔드포인트 (모델별 genai 경로)
    const r = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        width: size.width,
        height: size.height,
        steps: 4,
        cfg_scale: 3.5,
        seed: Math.floor(Math.random() * 1000000),
        mode: 'base'
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('NVIDIA image API error:', r.status, errText);
      return res.status(502).json({
        error: `이미지 생성 실패 (코드 ${r.status}). 잠시 후 다시 시도해주세요.`
      });
    }

    const data = await r.json();
    // FLUX NIM은 여러 응답 형식이 있을 수 있어 모두 대비
    const b64 =
      data?.artifacts?.[0]?.base64 ||
      data?.image ||
      data?.data?.[0]?.b64_json ||
      (Array.isArray(data?.images) ? data.images[0] : null);

    if (!b64) {
      console.error('이미지 데이터 없음:', JSON.stringify(data).slice(0, 800));
      return res.status(502).json({ error: '이미지 응답 형식을 해석하지 못했습니다.' });
    }

    return res.status(200).json({ image: `data:image/png;base64,${b64}`, prompt });
  } catch (e) {
    console.error('서버 오류:', e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
