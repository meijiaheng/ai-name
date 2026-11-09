/**
 * GET /api/history
 * 读取最近的起名记录（默认 20 条）
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: '只支持 GET' });
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(200).json({ items: [], warning: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY，历史记录不可用' });
    return;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const limit = Math.min(Number(req.query && req.query.limit) || 20, 50);
    const { data, error } = await supabase
      .from('name_history')
      .select('id, user_requirement, name_result, model_name, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      // 表不存在或 RLS 拦住，都把原始错误交回前端便于排查
      res.status(200).json({ items: [], warning: `${error.message}（检查建表 SQL 是否执行、RLS 策略是否放开）` });
      return;
    }
    res.status(200).json({ items: data || [] });
  } catch (err) {
    res.status(200).json({ items: [], warning: `读取失败：${err.message}` });
  }
};
