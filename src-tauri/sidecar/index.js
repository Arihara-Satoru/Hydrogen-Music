/**
 * Hydrogen Music — File I/O Sidecar Service
 *
 * 提供本地音乐元数据解析、封面提取、歌词读取、文件下载等功能。
 * 与 KuGou Music API 后端（端口 36530）共存，本服务运行在端口 36531。
 *
 * 启动方式: node index.js [--kugou-port=36530] [--port=36531]
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

// ── 配置 ──
const SIDECAR_PORT = parseInt(process.env.SIDECAR_PORT || process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '36531', 10);
const KUGOU_PORT = parseInt(process.env.KUGOU_PORT || process.argv.find(a => a.startsWith('--kugou-port='))?.split('=')[1] || '36530', 10);
const KUGOU_HOST = process.env.KUGOU_HOST || '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════
// 启动 KuGou Music API 后端
// ═══════════════════════════════════════════════════

let kugouApiProcess = null;

function findKugouApiPath() {
    // 候选路径
    const candidates = [
        path.join(__dirname, '..', '..', '..', 'KuGouMusicApi'),
        path.join(__dirname, '..', '..', 'KuGouMusicApi'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return path.resolve(p);
    }
    return null;
}

function startKugouApi() {
    const apiPath = findKugouApiPath();
    if (!apiPath) {
        console.log('[sidecar] KuGouMusicApi not found, skipping start');
        return;
    }

    // 检查是否已有进程占用端口
    const http = require('http');
    const probe = http.get(`http://${KUGOU_HOST}:${KUGOU_PORT}/`, (res) => {
        if (res.statusCode) {
            console.log(`[sidecar] KuGou API already running on :${KUGOU_PORT}`);
            res.resume();
        }
    });
    probe.on('error', () => {
        // 端口空闲，启动后端
        const appJs = path.join(apiPath, 'app.js');
        if (!fs.existsSync(appJs)) {
            console.log(`[sidecar] app.js not found at ${appJs}`);
            return;
        }

        console.log(`[sidecar] Starting KuGou API from ${appJs}`);
        kugouApiProcess = spawn(process.execPath, [appJs], {
            cwd: apiPath,
            env: {
                ...process.env,
                PORT: String(KUGOU_PORT),
                HOST: KUGOU_HOST,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        kugouApiProcess.stdout.on('data', (d) => {
            const text = d.toString().trim();
            if (text) console.log(`[kugou] ${text}`);
        });
        kugouApiProcess.stderr.on('data', (d) => {
            const text = d.toString().trim();
            if (text) console.error(`[kugou] ${text}`);
        });
        kugouApiProcess.on('exit', (code) => {
            console.log(`[sidecar] KuGou API exited (code: ${code})`);
            kugouApiProcess = null;
        });
    });
    probe.end();
}

function stopKugouApi() {
    if (kugouApiProcess) {
        try {
            kugouApiProcess.kill();
        } catch (_) {}
        kugouApiProcess = null;
    }
}

// ═══════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════

/** 安全读取文件，返回 base64 */
async function fileToBase64(filePath) {
    const buf = await fs.readFile(filePath);
    return buf.toString('base64');
}

/** 安全的路径解析，防止目录穿越 */
function safeResolve(base, userPath) {
    const resolved = path.resolve(base, userPath);
    if (!resolved.startsWith(base)) {
        throw new Error('Path traversal detected');
    }
    return resolved;
}

// ═══════════════════════════════════════════════════
// 健康检查
// ═══════════════════════════════════════════════════

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        kugouApiPort: KUGOU_PORT,
        sidecarPort: SIDECAR_PORT,
        kugouRunning: kugouApiProcess !== null,
    });
});

// ═══════════════════════════════════════════════════
// 本地音乐扫描
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// 音乐元数据解析
// ═══════════════════════════════════════════════════

app.post('/local/metadata', async (req, res) => {
    try {
        const { filePath: rawPath } = req.body;
        if (!rawPath) return res.status(400).json({ error: 'filePath required' });

        const filePath = path.resolve(rawPath);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

        // 使用 music-metadata 解析
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

// ═══════════════════════════════════════════════════
// 提取封面图片（base64）
// ═══════════════════════════════════════════════════

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
                // 如有 sharp，缩放封面
                try {
                    const sharp = require('sharp');
                    const resized = await sharp(pic.data)
                        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
                        .toBuffer();
                    const b64 = resized.toString('base64');
                    return res.json({ data: `data:${mime};base64,${b64}`, mime, embedded: true });
                } catch (_) {
                    // sharp 不可用时返回原图
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
                    const data = await fileToBase64(coverPath);
                    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                    return res.json({ data: `data:${mime};base64,${data}`, mime, embedded: false });
                }
            }
        }

        // 尝试 cover.jpg / folder.jpg
        const commonCovers = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'Cover.jpg', 'Front.jpg'];
        for (const name of commonCovers) {
            const coverPath = path.join(parsed.dir, name);
            if (fs.existsSync(coverPath)) {
                const data = await fileToBase64(coverPath);
                const ext = path.extname(name).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
                return res.json({ data: `data:${mime};base64,${data}`, mime, embedded: false });
            }
        }

        res.json({ data: null, error: 'No cover found' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════
// 读取本地歌词文件
// ═══════════════════════════════════════════════════

app.post('/local/lyric', async (req, res) => {
    try {
        const { filePath: rawPath } = req.body;
        if (!rawPath) return res.status(400).json({ error: 'filePath required' });

        const filePath = path.resolve(rawPath);
        const parsed = path.parse(filePath);
        const baseName = parsed.name;

        // 候选歌词文件
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
                        if (decoded.indexOf('�') === -1) content = decoded;
                    }
                } catch (_) {}

                return res.json({
                    lyric: content,
                    path: candidate,
                });
            }
        }

        res.json({ lyric: null, error: 'No lyric file found' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════
// 通用 HTTP 代理（替代 getRequestData）
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// 文件下载
// ═══════════════════════════════════════════════════

const activeDownloads = new Map();
let downloadIdCounter = 0;

app.post('/download/start', async (req, res) => {
    try {
        const { url, filePath, headers = {} } = req.body;
        if (!url || !filePath) return res.status(400).json({ error: 'url and filePath required' });

        // 确保目标目录存在
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
            id,
            url,
            filePath,
            totalSize,
            downloaded: 0,
            status: 'downloading',
            cancel: null,
        };

        const cancelToken = axios.CancelToken.source();
        downloadInfo.cancel = () => {
            cancelToken.cancel('User cancelled');
            writeStream.destroy();
            // 清理部分下载的文件
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

        res.json({
            id,
            totalSize,
            status: 'downloading',
        });
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

// ═══════════════════════════════════════════════════
// 启动服务
// ═══════════════════════════════════════════════════

async function start() {
    // 启动 KuGou API（非阻塞）
    startKugouApi();

    // 启动 Sidecar HTTP 服务
    app.listen(SIDECAR_PORT, '127.0.0.1', () => {
        console.log(`[sidecar] File I/O service running on :${SIDECAR_PORT}`);
    });
}

// 优雅退出
process.on('SIGTERM', () => {
    stopKugouApi();
    process.exit(0);
});
process.on('SIGINT', () => {
    stopKugouApi();
    process.exit(0);
});

start().catch((err) => {
    console.error('[sidecar] Fatal error:', err);
    process.exit(1);
});
