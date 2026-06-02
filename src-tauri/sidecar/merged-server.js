#!/usr/bin/env node

/**
 * Hydrogen Music — Merged Sidecar Server
 *
 * 合并 KuGou Music API + 文件 I/O 服务为单一进程，运行在 36530 端口。
 * 使用 pkg 编译为独立二进制，作为 Tauri sidecar 运行，用户无需安装 Node.js。
 *
 * 启动方式（开发模式）:
 *   node src-tauri/sidecar/merged-server.js
 * 或者通过 Tauri sidecar 自动启动（生产模式）:
 *   Tauri 会自动从 binaries/sidecar-server-{triple}.exe 启动
 */

const path = require('path');
const fs = require('fs-extra');

// ── 加载 KuGou API 服务 ──
// esbuild 打包时会内联 require('./server')，使其在 pkg 二进制中可用
// 开发模式下，此路径通过 module.paths 注入解析
let serverModule;
try {
  serverModule = require('./server');
} catch (_) {
  // 开发模式：查找 KuGouMusicApi 源码
  const apiCandidates = [
    path.join(__dirname, '..', '..', '..', 'KuGouMusicApi'),
    path.join(__dirname, '..', '..', 'KuGouMusicApi'),
  ];
  let found = false;
  for (const apiDir of apiCandidates) {
    const serverPath = path.join(apiDir, 'server.js');
    if (fs.existsSync(apiDir) && fs.existsSync(serverPath)) {
      // 将 KuGouMusicApi 目录加入模块搜索路径
      module.paths.unshift(path.join(apiDir, 'node_modules'));
      module.paths.unshift(apiDir);
      // 也把 bin/api_js 加入（如果有预构建）
      const apiJsDir = path.join(apiDir, 'bin', 'api_js');
      if (fs.existsSync(apiJsDir)) {
        module.paths.unshift(apiJsDir);
      }
      try {
        serverModule = require(serverPath);
        found = true;
        break;
      } catch (e) {
        module.paths = module.paths.slice(3); // 恢复
      }
    }
  }
  if (!found) {
    throw new Error(
      '无法找到 KuGou Music API 服务器模块。\n' +
      '请先运行构建脚本: node scripts/build-kugou-api.cjs\n' +
      '或确保 KuGouMusicApi 目录存在于项目同级。'
    );
  }
}
const { startService } = serverModule;

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  // 1. 启动 KuGou Music API（返回 Express app 实例）
  //    startService() 内部会:
  //    - 加载 dotenv 配置
  //    - 设置 CORS、Cookie 解析、Body Parser
  //    - 动态加载 module/ 下所有 API 模块并注册路由
  //    - 在 process.env.PORT || 36530 上监听
  console.log('[merged] Starting KuGou Music API...');
  const app = await startService();
  console.log('[merged] KuGou Music API started');

  // 2. 在同一个 Express app 上注册文件 I/O 路由
  registerSidecarRoutes(app);

  console.log('[merged] All routes registered, server ready on port', process.env.PORT || 36530);
}

// ═══════════════════════════════════════════════════════════════
// 文件 I/O 路由（原 sidecar/index.js）
// ═══════════════════════════════════════════════════════════════

function registerSidecarRoutes(app) {
  // ── 健康检查 ──
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      port: parseInt(process.env.PORT || '36530', 10),
      sidecarVersion: '2.0',
    });
  });

  // ── 本地音乐扫描 ──
  const SUPPORTED_EXT = new Set([
    '.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma',
    '.m4a', '.ape', '.dsf', '.dff', '.aiff', '.alac',
  ]);

  app.post('/local/scan', async (req, res) => {
    try {
      const { dirPath: rawPath, recursive = true } = req.body;
      if (!rawPath) return res.status(400).json({ error: 'dirPath required' });

      const dirPath = path.resolve(rawPath);
      if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Directory not found' });

      const files = [];
      const walk = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && recursive) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXT.has(ext)) {
              const stat = await fs.stat(fullPath);
              files.push({
                path: fullPath,
                name: entry.name,
                ext,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
              });
            }
          }
        }
      };

      await walk(dirPath);
      res.json({ files, total: files.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 音乐元数据解析 ──
  app.post('/local/metadata', async (req, res) => {
    try {
      const { filePath: rawPath } = req.body;
      if (!rawPath) return res.status(400).json({ error: 'filePath required' });

      const filePath = path.resolve(rawPath);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

      const mm = await import('music-metadata');
      const metadata = await mm.parseFile(filePath, { skipCovers: true });

      res.json({
        format: metadata.format,
        common: {
          title: metadata.common.title,
          artist: metadata.common.artist,
          album: metadata.common.album,
          albumArtist: metadata.common.albumartist,
          year: metadata.common.year,
          track: metadata.common.track,
          genre: metadata.common.genre,
          duration: metadata.format.duration,
          bitrate: metadata.format.bitrate,
          sampleRate: metadata.format.sampleRate,
          codec: metadata.format.codec,
          container: metadata.format.container,
          lossless: metadata.format.lossless,
          numberOfChannels: metadata.format.numberOfChannels,
          ...(metadata.common.rating ? { rating: metadata.common.rating } : {}),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 提取封面图片（base64） ──
  app.post('/local/image', async (req, res) => {
    try {
      const { filePath: rawPath, size = 400 } = req.body;
      if (!rawPath) return res.status(400).json({ error: 'filePath required' });

      const filePath = path.resolve(rawPath);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

      // 先尝试从文件元数据读取内嵌封面
      try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath, { skipCovers: false });
        const pic = metadata.common?.picture?.[0];
        if (pic?.data) {
          const mime = pic.format?.startsWith('image/') ? pic.format : 'image/jpeg';
          try {
            const sharp = require('sharp');
            const resized = await sharp(pic.data)
              .resize(size, size, { fit: 'inside', withoutEnlargement: true })
              .toBuffer();
            const b64 = resized.toString('base64');
            return res.json({ data: `data:${mime};base64,${b64}`, mime, embedded: true });
          } catch (_) {
            const b64 = Buffer.from(pic.data).toString('base64');
            return res.json({ data: `data:${mime};base64,${b64}`, mime, embedded: true });
          }
        }
      } catch (_) { /* fall through */ }

      // 无内嵌封面 → 尝试同目录图片文件
      const parsed = path.parse(filePath);
      const extCandidates = ['.jpg', '.jpeg', '.png', '.webp'];
      for (const ext of extCandidates) {
        const coverPath = path.join(parsed.dir, parsed.name + ext);
        if (fs.existsSync(coverPath)) {
          try {
            const sharp = require('sharp');
            const resized = await sharp(coverPath)
              .resize(size, size, { fit: 'inside', withoutEnlargement: true })
              .toBuffer();
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            const b64 = resized.toString('base64');
            return res.json({ data: `data:${mime};base64,${b64}`, mime, embedded: false });
          } catch (_) {
            const data = await fs.readFile(coverPath);
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            return res.json({ data: `data:${mime};base64,${data.toString('base64')}`, mime, embedded: false });
          }
        }
      }

      // 尝试 cover.jpg / folder.jpg
      const commonCovers = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'Cover.jpg', 'Front.jpg'];
      for (const name of commonCovers) {
        const coverPath = path.join(parsed.dir, name);
        if (fs.existsSync(coverPath)) {
          const data = await fs.readFile(coverPath);
          const ext = path.extname(name).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
          return res.json({ data: `data:${mime};base64,${data.toString('base64')}`, mime, embedded: false });
        }
      }

      res.json({ data: null, error: 'No cover found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 读取本地歌词文件 ──
  app.post('/local/lyric', async (req, res) => {
    try {
      const { filePath: rawPath } = req.body;
      if (!rawPath) return res.status(400).json({ error: 'filePath required' });

      const filePath = path.resolve(rawPath);
      const parsed = path.parse(filePath);
      const baseName = parsed.name;

      const candidates = [];
      const lyricDirs = [parsed.dir];

      for (const dir of lyricDirs) {
        for (const ext of ['.lrc', '.txt']) {
          candidates.push(path.join(dir, baseName + ext));
          candidates.push(path.join(dir, baseName + '.' + ext));
        }
      }

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          let content = fs.readFileSync(candidate, 'utf-8');
          // 尝试 iconv-lite 转码（处理 GBK 编码）
          try {
            const iconv = require('iconv-lite');
            const raw = fs.readFileSync(candidate);
            if (iconv.encodingExists('gbk')) {
              const decoded = iconv.decode(raw, 'gbk');
              if (decoded.indexOf('\uFFFD') === -1) content = decoded;
            }
          } catch (_) {}

          return res.json({ lyric: content, path: candidate });
        }
      }

      res.json({ lyric: null, error: 'No lyric file found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 通用 HTTP 代理 ──
  app.post('/proxy', async (req, res) => {
    try {
      const { url, option = {} } = req.body;
      if (!url) return res.status(400).json({ error: 'url required' });

      const axios = require('axios');
      const response = await axios({
        url,
        method: option.method || 'GET',
        headers: option.headers || {},
        params: option.params || {},
        data: option.body || option.data,
        responseType: option.responseType || 'json',
        timeout: option.timeout || 30000,
      });

      res.json({
        status: response.status,
        data: response.data,
        headers: response.headers,
      });
    } catch (err) {
      if (err.response) {
        return res.status(err.response.status).json({
          error: err.message,
          status: err.response.status,
          data: err.response.data,
        });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ── 文件下载 ──
  const activeDownloads = new Map();
  let downloadIdCounter = 0;

  app.post('/download/start', async (req, res) => {
    try {
      const { url, filePath: rawPath, headers = {} } = req.body;
      if (!url || !rawPath) return res.status(400).json({ error: 'url and filePath required' });

      const filePath = path.resolve(rawPath);
      await fs.ensureDir(path.dirname(filePath));

      const id = ++downloadIdCounter;
      const axios = require('axios');

      const response = await axios({
        url,
        method: 'GET',
        headers,
        responseType: 'stream',
        timeout: 300000,
      });

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      const writeStream = fs.createWriteStream(filePath);
      let downloaded = 0;

      const downloadInfo = {
        id, url, filePath, totalSize,
        downloaded: 0,
        status: 'downloading',
        cancel: null,
      };

      const cancelToken = axios.CancelToken.source();
      downloadInfo.cancel = () => {
        cancelToken.cancel('User cancelled');
        writeStream.destroy();
        fs.remove(filePath).catch(() => {});
      };

      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        downloadInfo.downloaded = downloaded;
      });

      response.data.pipe(writeStream);

      writeStream.on('finish', () => {
        downloadInfo.status = 'completed';
        downloadInfo.downloaded = totalSize || downloaded;
      });

      writeStream.on('error', (err) => {
        downloadInfo.status = 'error';
        downloadInfo.error = err.message;
      });

      activeDownloads.set(id, downloadInfo);

      res.json({ id, totalSize, status: 'downloading' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/download/cancel', (req, res) => {
    const { id } = req.body;
    const dl = activeDownloads.get(Number(id));
    if (dl && typeof dl.cancel === 'function') {
      dl.cancel();
      activeDownloads.delete(Number(id));
      res.json({ status: 'cancelled' });
    } else {
      res.status(404).json({ error: 'Download not found' });
    }
  });

  app.get('/download/status/:id', (req, res) => {
    const dl = activeDownloads.get(Number(req.params.id));
    if (!dl) return res.status(404).json({ error: 'Download not found' });
    res.json({
      id: dl.id,
      status: dl.status,
      totalSize: dl.totalSize,
      downloaded: dl.downloaded,
      error: dl.error || null,
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════

main().catch((err) => {
  console.error('[merged] Fatal error:', err);
  process.exit(1);
});
