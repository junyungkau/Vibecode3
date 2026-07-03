// api/generate.js
// 학교 행사 배너/썸네일 이미지 생성 (NVIDIA FLUX.1-schnell)
// NVIDIA API 키는 여기서만 사용됩니다. Vercel 환경변수 NVIDIA_API_KEY 필요.
//
// 참고: NVIDIA 이미지 API는 비동기 방식입니다.
//  - 처음 요청 시 즉시 200(완료) 또는 202(처리중 + NVCF-REQID)를 받습니다.
//  - 202를 받으면 status 엔드포인트를 폴링해서 완료를 기다립니다.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '서버에 NVIDIA_API_KEY가 설정되지 않았습니다.' });

  const { keyword, style, ratio } = req.body || {};
  if (!keyword) return res.status(400).json({ error: '무엇을 그릴지 입력해주세요.' });

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

  const INVOKE_URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';
  const STATUS_URL = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/';

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };

  const payload = JSON.stringify({
    prompt,
    width: size.width,
    height: size.height,
    steps: 4,
    cfg_scale: 3.5,
    seed: Math.floor(Math.random() * 1000000),
    mode: 'base'
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const extractImage = (data) =>
    data?.artifacts?.[0]?.base64 ||
    data?.image ||
    data?.data?.[0]?.b64_json ||
    (Array.isArray(data?.images) ? data.images[0] : null);

  try {
    let r = await fetch(INVOKE_URL, { method: 'POST', headers, body: payload });

    // 202: 아직 처리중 → NVCF-REQID로 폴링
    if (r.status === 202) {
      const reqId = r.headers.get('nvcf-reqid');
      if (!reqId) {
        console.error('202인데 NVCF-REQID 헤더가 없음');
        return res.status(502).json({ error: '이미지 요청 ID를 받지 못했습니다.' });
      }

      // 최대 약 55초까지 1.5초 간격으로 폴링 (Vercel 60초 제한 안쪽)
      const maxAttempts = 36;
      for (let i = 0; i < maxAttempts; i++) {
        await sleep(1500);
        r = await fetch(STATUS_URL + reqId, { method: 'GET', headers });

        if (r.status === 200) break;        // 완료
        if (r.status === 202) continue;      // 아직 처리중, 계속 폴링
        // 그 외 상태는 오류
        const errText = await r.text();
        console.error('폴링 중 오류:', r.status, errText);
        return res.status(502).json({ error: `이미지 생성 실패 (폴링 코드 ${r.status})` });
      }

      if (r.status !== 200) {
        return res.status(504).json({ error: '이미지 생성이 시간 내에 완료되지 않았어요. 다시 시도해주세요.' });
      }
    } else if (!r.ok) {
      const errText = await r.text();
      console.error('NVIDIA image API error:', r.status, errText);
      return res.status(502).json({ error: `이미지 생성 실패 (코드 ${r.status}). 잠시 후 다시 시도해주세요.` });
    }

    const data = await r.json();
    const b64 = extractImage(data);

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
