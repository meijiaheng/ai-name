/**
 * POST /api/name
 * 一套共用调用代码 + modelConfigMap，支持 doubao / deepseek / qwen / kimi
 * 返回 SSE 流：data: {"t":"增量文字"} ... data: {"done":true,...}
 */

// ===== modelConfigMap：只在这里加配置，主调用代码不用改 =====
function buildModelConfigMap() {
  return {
    doubao: {
      label: '豆包（火山方舟）',
      baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: process.env.DOUBAO_API_KEY || '',
      model: process.env.DOUBAO_MODEL || 'doubao-seed-1-6-250615',
    },
    deepseek: {
      label: 'DeepSeek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-chat',
    },
    qwen: {
      label: '通义千问',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.QWEN_API_KEY || '',
      model: 'qwen-plus',
    },
    kimi: {
      label: 'Kimi',
      baseURL: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY || '',
      model: 'moonshot-v1-8k',
    },
  };
}

const SYSTEM_PROMPT = [
  '你是一位精通中文取名、兼顾古典出处与现代审美的起名顾问。',
  '你会根据用户给出的性别、风格、寓意等需求，给出 3 组完整名字方案。',
  '严格按下面的纯文本格式输出，不要输出 Markdown 表格、不要编号符号、不要额外寒暄：',
  '',
  '名字：姓+名',
  '读音：拼音',
  '寓意：60 字以内，讲清楚用字含义与整体气质，能引一句出处更好',
  '风格：从国风 / 现代简约 / 英文名 / 中性 中选一个',
  '',
  '（按上面四行结构重复三次，每组之间空一行。）',
].join('\n');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch (err) {
    console.error('[supabase] 初始化失败：', err.message);
    return null;
  }
}

async function saveHistory({ requirement, result, model }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { saved: false, reason: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY' };
  const { data, error } = await supabase
    .from('name_history')
    .insert([{ user_requirement: requirement, name_result: result, model_name: model }])
    .select('id')
    .single();
  if (error) {
    console.error('[supabase] 写入失败：', error.message);
    return { saved: false, reason: error.message };
  }
  return { saved: true, id: data && data.id };
}

// ===== 演示模式：没有密钥时也能看完整效果 =====
const DEMO_TEMPLATE = [
  '名字：沈知野',
  '读音：shěn zhī yě',
  '寓意：知者不惑，野者不羁。取“知”之清明与“野”之旷达，寓意思路通透、行事从容，自带一身书卷气。',
  '风格：国风',
  '',
  '名字：沈临舟',
  '读音：shěn lín zhōu',
  '寓意：临者近水，舟者自渡。取“渡人先渡己”之意，喻自持而有分寸，平静里藏着韧劲。',
  '风格：现代简约',
  '',
  '名字：沈亦安',
  '读音：shěn yì ān',
  '寓意：亦者从容，安者笃定。不争不抢却自有主张，适合一生顺遂、心境松弛的期许。',
  '风格：中性',
].join('\n');

function demoText(requirement) {
  return DEMO_TEMPLATE;
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function streamDemo(res, requirement) {
  const text = demoText(requirement);
  const step = 6;
  for (let i = 0; i < text.length; i += step) {
    sseWrite(res, { t: text.slice(i, i + step) });
    await new Promise((r) => setTimeout(r, 45));
  }
}

async function streamUpstream(res, config, messages) {
  const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.9,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`上游返回 ${resp.status}：${body.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        const chunk = (delta && delta.content) || '';
        if (chunk) {
          full += chunk;
          sseWrite(res, { t: chunk });
        }
      }
    }
  }
  return full;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持 POST' });
    return;
  }

  // Vercel 会把 body 解析好；本地 server.js 也预解析，这里兜底兼容字符串 body
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const requirement = String(body.requirement || '').trim();
  const style = String(body.style || '').trim();
  const modelKey = String(body.model || 'doubao').trim();
  const configMap = buildModelConfigMap();
  const config = configMap[modelKey];

  if (!requirement) {
    res.status(400).json({ error: '请填写起名需求' });
    return;
  }
  if (!config) {
    res.status(400).json({ error: `未知模型 ${modelKey}，可选：${Object.keys(configMap).join(' / ')}` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const useReal = Boolean(config.apiKey);
  const modelName = useReal ? `${modelKey}:${config.model}` : `${modelKey}:demo`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `起名需求：${requirement}${style ? `\n期望风格：${style}` : ''}\n请给出 3 组方案。`,
    },
  ];

  let fullText = '';
  try {
    if (useReal) {
      fullText = await streamUpstream(res, config, messages);
    } else {
      fullText = demoText(requirement);
      await streamDemo(res, requirement);
    }
  } catch (err) {
    console.error('[api/name] 生成失败：', err.message);
    sseWrite(res, { error: `生成失败：${err.message}` });
  }

  if (fullText) {
    const saved = await saveHistory({ requirement, result: fullText, model: modelName });
    sseWrite(res, { done: true, model: modelName, demo: !useReal, saved });
  } else {
    sseWrite(res, { done: true, model: modelName, demo: !useReal, saved: { saved: false } });
  }
  res.end();
};
