// 完整集成 workers.js 到内部 API 端点
const TextEncoder = typeof window !== 'undefined' ? window.TextEncoder : require('util').TextEncoder;
const crypto = typeof window !== 'undefined' ? window.crypto : require('crypto').webcrypto;

let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

// 生成 SSML
function generateSsml(text, voiceName, rate, pitch) {
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> 
                <voice name="${voiceName}"> 
                    <mstts:express-as style="general" styledegree="1.0" role="default"> 
                        <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> 
                    </mstts:express-as> 
                </voice> 
            </speak>`;
}

// TTS API 请求
async function getVoice(text, voiceName, rate, pitch, outputFormat, download) {
    await refreshEndpoint();
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const headers = {
        "Authorization": endpoint.t,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": outputFormat,
        "User-Agent": "okhttp/4.5.0"
    };

    const ssml = generateSsml(text, voiceName, rate, pitch);
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: ssml
    });

    if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return {
            data: arrayBuffer,
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Disposition": download ? `attachment; filename="${uuid()}.mp3"` : null
            }
        };
    } else {
        throw new Error(`TTS 请求失败，状态码 ${response.status}`);
    }
}

// 语音列表格式化
function formatVoiceItem(item) {
    return `
- !!org.nobody.multitts.tts.speaker.Speaker
  avatar: ''
  code: ${item.ShortName}
  desc: ''
  extendUI: ''
  gender: ${item.Gender === "Female" ? "0" : "1"}
  name: ${item.LocalName}
  note: 'wpm: ${item.WordsPerMinute || ""}'
  param: ''
  sampleRate: ${item.SampleRateHertz || "24000"}
  speed: 1.5
  type: 1
  volume: 1`;
}

// 获取语音列表
async function voiceList() {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "X-Ms-Useragent": "SpeechStudio/2021.05.001",
        "Content-Type": "application/json",
        "Origin": "https://azure.microsoft.com",
        "Referer": "https://azure.microsoft.com"
    };
    
    const response = await fetch("https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list", {
        headers: headers
    });
    
    if (!response.ok) {
        throw new Error(`获取语音列表失败，状态码 ${response.status}`);
    }
    return response.json();
}

// 刷新访问令牌
async function refreshEndpoint() {
    if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
        endpoint = await getEndpoint();
        // 解析 JWT 获取过期时间
        const parts = endpoint.t.split(".");
        if (parts.length > 1) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            expiredAt = payload.exp;
        } else {
            // 如果无法解析 JWT，设置一个默认的过期时间（10分钟后）
            expiredAt = (Date.now() / 1000) + 600;
        }
        clientId = uuid();
        console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } else {
        console.log(`过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    }
}

// 获取终端信息
async function getEndpoint() {
    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const headers = {
        "Accept-Language": "zh-Hans",
        "X-ClientVersion": "4.0.530a 5fe1dc6c",
        "X-UserId": "0f04d16a175c411e",
        "X-HomeGeographicRegion": "zh-Hans-CN",
        "X-ClientTraceId": clientId,
        "X-MT-Signature": await generateSignature(endpointUrl),
        "User-Agent": "okhttp/4.5.0",
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Encoding": "gzip"
    };
    
    const response = await fetch(endpointUrl, {
        method: "POST",
        headers: headers
    });
    
    if (!response.ok) {
        throw new Error(`获取 Endpoint 失败，状态码 ${response.status}`);
    }
    return response.json();
}

// 生成签名
async function generateSignature(urlStr) {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = uuid();
    const formattedDate = formatDate();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    const decodedKey = await base64ToBytes("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
    const signature = await hmacSha256(decodedKey, bytesToSign);
    const signatureBase64 = await bytesToBase64(signature);
    return `MSTranslatorAndroidApp::${signatureBase64}::${formattedDate}::${uuidStr}`;
}

// 格式化日期
function formatDate() {
    const date = new Date();
    const utcString = date.toUTCString().replace(/GMT/, "").trim() + " GMT";
    return utcString.toLowerCase();
}

// HMAC-SHA256 加密 - 增强版本，兼容多种环境
async function hmacSha256(key, data) {
    // 确保有编码器
    const encoder = new TextEncoder();
    
    try {
        // 优先使用 crypto.subtle API
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            key,
            { name: "HMAC", hash: { name: "SHA-256" } },
            false,
            ["sign"]
        );
        const signature = await crypto.subtle.sign(
            "HMAC", 
            cryptoKey, 
            encoder.encode(data)
        );
        return new Uint8Array(signature);
    } catch (error) {
        // 如果 crypto.subtle 失败，记录错误并尝试其他方法
        console.error("crypto.subtle API 失败:", error);
        
        // 尝试使用 Node.js crypto
        if (typeof require !== 'undefined') {
            try {
                const crypto = require('crypto');
                const hmac = crypto.createHmac('sha256', Buffer.from(key));
                hmac.update(data);
                return new Uint8Array(hmac.digest());
            } catch (nodeError) {
                console.error("Node.js crypto 失败:", nodeError);
                throw new Error("无法执行 HMAC-SHA256 加密，环境不支持");
            }
        }
        throw error;
    }
}

// Base64 解码转字节 - 增强版本，兼容多种环境
async function base64ToBytes(base64) {
    try {
        // 优先使用浏览器原生方法
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        // 浏览器方法失败，尝试 Node.js 的 Buffer
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(base64, 'base64'));
        }
        console.error("Base64解码失败:", error);
        throw new Error("无法执行Base64解码，环境不支持");
    }
}

// 字节转 Base64 - 增强版本，兼容多种环境
async function bytesToBase64(bytes) {
    try {
        // 优先使用浏览器原生方法
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    } catch (error) {
        // 浏览器方法失败，尝试 Node.js 的 Buffer
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        console.error("Base64编码失败:", error);
        throw new Error("无法执行Base64编码，环境不支持");
    }
}

// 生成UUID
function uuid() {
    if (crypto.randomUUID) {
        return crypto.randomUUID().replace(/-/g, "");
    } else {
        // 降级方案，适用于不支持 randomUUID 的环境
        return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, () => {
            return (Math.random() * 16 | 0).toString(16);
        });
    }
}

// 主请求处理函数 - 适配各种环境
export default async function handler(req, res) {
    // 处理 Edge/Serverless 环境
    if (!res) {
        return await handleEdgeRequest(req);
    }
    
    // 处理标准 Node.js 环境 (Express/Next.js)
    try {
        // 内部请求无需验证，直接处理
        if (req.method === 'OPTIONS') {
            // 处理 CORS 预检
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-auth-token');
            res.status(204).end();
            return;
        }
        
        // 根据请求路径处理不同功能
        const path = new URL(req.url, `http://${req.headers.host}`).pathname;
        
        if (path.endsWith('/voices')) {
            // 获取语音列表
            const voices = await voiceList();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(200).json(voices);
            return;
        }
        
        if (path.endsWith('/tts') || path === '/api/tts') {
            if (req.method === 'POST') {
                const body = req.body;
                const text = body.text || "";
                const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
                const rate = Number(body.rate) || 0;
                const pitch = Number(body.pitch) || 0;
                const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
                const download = !body.preview;
                
                const result = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
                
                res.setHeader('Content-Type', 'audio/mpeg');
                if (download && result.headers['Content-Disposition']) {
                    res.setHeader('Content-Disposition', result.headers['Content-Disposition']);
                }
                res.setHeader('Access-Control-Allow-Origin', '*');
                
                // 发送二进制数据
                res.status(200).send(Buffer.from(result.data));
            } else {
                res.status(405).json({ error: '只支持 POST 请求' });
            }
            return;
        }
        
        // 默认响应
        res.status(404).json({ error: '未找到请求的资源' });
    } catch (error) {
        console.error('API错误:', error);
        res.status(500).json({ error: error.message });
    }
}

// 处理 Edge/Cloudflare Workers 环境请求
async function handleEdgeRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-auth-token'
            }
        });
    }

    // 内部集成的 API 不验证令牌

    try {
        if (path.endsWith('/voices')) {
            const voices = await voiceList();
            return new Response(JSON.stringify(voices), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        if (path.endsWith('/tts') || path === '/api/tts') {
            if (request.method === 'POST') {
                const body = await request.json();
                const text = body.text || "";
                const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
                const rate = Number(body.rate) || 0;
                const pitch = Number(body.pitch) || 0;
                const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
                const download = !body.preview;
                
                const result = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
                
                const headers = {
                    'Content-Type': 'audio/mpeg',
                    'Access-Control-Allow-Origin': '*'
                };
                
                if (download && result.headers['Content-Disposition']) {
                    headers['Content-Disposition'] = result.headers['Content-Disposition'];
                }
                
                return new Response(result.data, {
                    status: 200,
                    headers: headers
                });
            } else {
                return new Response(JSON.stringify({ error: '只支持 POST 请求' }), {
                    status: 405,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }

        return new Response(JSON.stringify({ error: '未找到请求的资源' }), {
            status: 404,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        console.error('API错误:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
