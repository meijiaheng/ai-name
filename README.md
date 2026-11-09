# AI 起名平台

多模型 AI 起名 Web 应用：输入需求 → 流式输出 3 组名字与寓意 → 历史自动存入 Supabase。
一套共用调用代码（`modelConfigMap`）即可切换豆包 / DeepSeek / 通义千问 / Kimi。

## 目录结构

```
├─ api/
│  ├─ name.js        # 起名接口：modelConfigMap + 共用 fetch 调用 + SSE 流式返回 + 写库
│  └─ history.js     # 历史记录查询接口
├─ index.html        # 前端页面（流式渲染、名字卡片、历史列表）
├─ server.js         # 本地开发服务器（不装 Vercel CLI 也能跑）
├─ supabase/
│  └─ schema.sql     # 建表 SQL（含 RLS 策略）
├─ .env.example      # 环境变量模板
└─ package.json
```

## 当前接入的 Supabase

- 项目：`https://vqfobqdzkghjprfjzlag.supabase.co`
- 表 `public.name_history` 已创建（id / user_requirement / name_result / model_name / created_at）
- RLS 已开启，策略两条：anon 可 insert（`with check (true)`）、anon 可 select（`using (true)`）
- 线上 Vercel 已注入 `SUPABASE_URL`、`SUPABASE_ANON_KEY`（Production）
- 注意：`*.supabase.co` 在国内网络会被重置，本地 `npm run dev` 写库会失败；Vercel（美国 iad1）访问正常

## 线上部署状态

- Vercel 项目：`ai-name-platform`（账号 meijiaheng）
- 生产地址：https://ai-name-platform.vercel.app
- 部署方式：`api/*.js` 走 `@vercel/node`，`index.html` 走 `@vercel/static`（见 `vercel.json`）；`server.js` 仅本地用，已在 `.vercelignore` 排除
- 已关闭 Vercel SSO 部署保护，公网可匿名访问
- 环境变量（Production，均 Type=Secret）：`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`DOUBAO_API_KEY`、`DOUBAO_MODEL`
- 最近生产部署：`dpl_HaDRoQvkP4LvxZH1zKEcDZegRwJM`（READY，实体 `doubao-seed-evolving`，接入点 `ep-20261109231528-xcb4w`）
- **国内网络提醒**：`*.vercel.app` 在国内会被 DNS 污染（本机解析到 `103.97.176.73`）或 TLS 重置，直连打不开，需要代理；这与部署成败无关（Vercel 侧状态为 Ready、别名已绑定）

## 快速开始

```bash
npm install
copy .env.example .env      # Windows；macOS 用 cp
# 编辑 .env，填入 Supabase 与模型密钥
npm run dev                 # http://localhost:3000
```

启动时终端会打印「环境变量检测」，一眼能看出哪些密钥缺失。某个模型没填 key，前端会自动走**演示模式**（输出结构与真实一致，便于先跑通界面和流程）。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `SUPABASE_URL` | Supabase 项目地址（Settings → API → Project URL） |
| `SUPABASE_ANON_KEY` | anon public key，可公开但要配合 RLS 策略 |
| `DOUBAO_API_KEY` | 火山方舟 API Key |
| `DOUBAO_MODEL` | 方舟推理接入点 ID（`ep-xxxx`）或模型名，默认 `doubao-seed-1-6-250615` |
| `DOUBAO_BASE_URL` | 默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `DEEPSEEK_API_KEY` | DeepSeek，默认模型 `deepseek-chat` |
| `QWEN_API_KEY` | 通义千问，默认 `qwen-plus`，必须用 `compatible-mode` 地址 |
| `KIMI_API_KEY` | Kimi，默认 `moonshot-v1-8k` |

密钥只从环境变量读取，`.env` 已在 `.gitignore` 中，不会被提交。

## 建表

Supabase → SQL Editor → 执行 `supabase/schema.sql`。
执行成功后 `/api/history` 才能读到数据；未执行或 RLS 未放开时，前端会用橙色提示原始报错，方便排查。

## 切换到别的模型

只在 `api/name.js` 的 `modelConfigMap` 里加一段配置：

```js
newmodel: {
  label: '新模型',
  baseURL: 'https://xxx/v1',
  apiKey: process.env.NEWMODEL_API_KEY || '',
  model: 'model-name',
},
```

前端 `<select id="model">` 里加一个 `<option value="newmodel">` 即可，主调用代码不动。
前提是该平台提供 **OpenAI 兼容**的 `/chat/completions`（`messages` + `stream:true` + `Authorization: Bearer`）。

## 部署到 Vercel

1. 代码推到 GitHub（`git push -u origin main`），确认 `.env` 没被提交；
2. Vercel → New Project → 导入该仓库；
3. Project Settings → Environment Variables，把 `.env` 里的键值原样填进去；
4. Deploy，拿到公网域名。

> 也可用 CLI：`npx vercel --prod`（首次会要求登录）。

## 正式上线的权限方案

实验期用 `anon` 直接读写，等于任何人拿到 anon key 都能读全表。上线前建议：

- 给表加 `user_id uuid` 字段，前端接入 Supabase Auth（匿名登录也算一个 uid）；
- RLS 改为 `using (auth.uid() = user_id)` / `with check (auth.uid() = user_id)`；
- 写库改成用 **service_role key** 的服务端接口（该 key 只放服务端环境变量，永不下发到前端）；
- 历史查询再加 `created_at` 索引与分页。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| 上游 401 / 403 | key 错、没开通模型权限，或方舟用的是推理接入点 ID 而非模型名 |
| 通义千问 404 | baseURL 必须含 `compatible-mode` |
| 切换模型报错 | 回到该平台官方 curl 文档核对 baseURL、鉴权头、model 名 |
| 看不到历史 | SQL 未执行 / RLS 未放开 / `SUPABASE_URL` 与 key 不匹配同一项目 |
| 流式不动、一次性全出 | 中间代理压缩了响应：接口已设置 `Cache-Control: no-transform`，Vercel 上无需额外处理 |
