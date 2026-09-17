// Cloudflare Worker：为 GitHub Pages 文件导航器提供安全的上传入口。
// 部署后请在 Worker 环境变量中配置：
// GITHUB_TOKEN = GitHub fine-grained token（仅授予该仓库 Contents: Read and write）
// UPLOAD_KEY  = 随机长字符串；前端上传时以 Authorization: Bearer <key> 发送
// ALLOWED_ORIGIN = https://jxmm52547.github.io

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }
});

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://jxmm52547.github.io';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }

    if (request.method !== 'POST') return json({ error: 'Only POST is allowed.' }, 405, origin);

    const auth = request.headers.get('Authorization') || '';
    if (!env.UPLOAD_KEY || auth !== `Bearer ${env.UPLOAD_KEY}`) {
      return json({ error: 'Unauthorized.' }, 401, origin);
    }

    if (!env.GITHUB_TOKEN) return json({ error: 'Server is not configured with GITHUB_TOKEN.' }, 500, origin);

    const form = await request.formData();
    const file = form.get('file');
    const path = String(form.get('path') || '').replace(/^\/+|\/+$/g, '');
    const branch = String(form.get('branch') || 'main');

    if (!(file instanceof File)) return json({ error: 'Missing file.' }, 400, origin);
    if (!path || path.includes('..')) return json({ error: 'Invalid path.' }, 400, origin);
    if (file.size > 50 * 1024 * 1024) return json({ error: 'File exceeds 50 MB limit.' }, 413, origin);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const content = btoa(binary);

    const apiUrl = `https://api.github.com/repos/jxmm52547/jxmm52547.github.io/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const headers = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'jxmm52547-file-navigator'
    };

    let sha;
    const existing = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    if (existing.ok) {
      const existingData = await existing.json();
      if (existingData && existingData.sha) sha = existingData.sha;
    } else if (existing.status !== 404) {
      return json({ error: `GitHub lookup failed: ${existing.status}` }, 502, origin);
    }

    const payload = {
      message: `${sha ? 'Update' : 'Upload'} ${path}`,
      content,
      branch
    };
    if (sha) payload.sha = sha;

    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json({ error: result.message || `GitHub upload failed: ${response.status}` }, 502, origin);
    }

    return json({ ok: true, path, commit: result.commit?.sha || null }, 200, origin);
  }
};
