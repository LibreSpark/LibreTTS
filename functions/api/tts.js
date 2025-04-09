const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

export async function onRequestGet(context) {
  const { request } = context;
  return handleRequest(request);
}

export async function onRequestPost(context) {
  const { request } = context;
  return handleRequest(request);
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: {
      ...makeCORSHeaders(),
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return onRequestOptions({ request });
  }

  // 移除了身份验证检查，无须认证

  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname;
  
  switch (path) {
    case "/api/tts":
      return handleTTS(requestUrl, request);
    case "/api/voices":
      return handleVoices(requestUrl);
    default:
      return handleDefault(requestUrl);
  }
}

async function handleTTS(requestUrl, request) {
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const text = body.text || "";
      const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
      const rate = Number(body.rate) || 0;
      const pitch = Number(body.pitch) || 0;
      const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
      const download = !body.preview;
      
      const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
      return addCORSHeaders(response);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...makeCORSHeaders()
        }
      });
    }
  } else {
    // GET 请求处理
    const text = requestUrl.searchParams.get("t") || "";
    const voiceName = requestUrl.searchParams.get("v") || "zh-CN-XiaoxiaoMultilingualNeural";
    const rate = Number(requestUrl.searchParams.get("r")) || 0;
    const pitch = Number(requestUrl.searchParams.get("p")) || 0;
    const outputFormat = requestUrl.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
    const download = requestUrl.searchParams.get("d") === "true";
    
    try {
      const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
      return addCORSHeaders(response);
    } catch (error) {
      return new Response("Internal Server Error", { status: 500, headers: makeCORSHeaders() });
    }
  }
}

async function handleVoices(requestUrl) {
  const localeFilter = (requestUrl.searchParams.get("l") || "").toLowerCase();
  const format = requestUrl.searchParams.get("f");
  
  try {
    let voices = await voiceList();
    if (localeFilter) {
      voices = voices.filter(item => item.Locale.toLowerCase().includes(localeFilter));
    }
    
    if (format === "0") {
      const formattedVoices = voices.map(item => formatVoiceItem(item));
      return new Response(formattedVoices.join("\n"), {
        headers: {
          "Content-Type": "application/html; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
    } else if (format === "1") {
      const voiceMap = Object.fromEntries(voices.map(item => [item.ShortName, item.LocalName]));
      return new Response(JSON.stringify(voiceMap), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
    } else {
      return new Response(JSON.stringify(voices), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
    }
  } catch (error) {
    return new Response("Internal Server Error", { 
      status: 500, 
      headers: makeCORSHeaders() 
    });
  }
}

function handleDefault(requestUrl) {
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const htmlContent = `
  <ol>
    <li> /api/tts?t=[text]&v=[voice]&r=[rate]&p=[pitch]&o=[outputFormat] <a href="${baseUrl}/api/tts?t=hello, world&v=zh-CN-XiaoxiaoMultilingualNeural&r=0&p=0&o=audio-24khz-48kbitrate-mono-mp3">试试</a> </li>
    <li> /api/voices?l=[locale, 如 zh|zh-CN]&f=[format, 0/1/空 0(TTS-Server)|1(MultiTTS)] <a href="${baseUrl}/api/voices?l=zh&f=1">试试</a> </li>
  </ol>
  `;
  return new Response(htmlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...makeCORSHeaders()
    }
  });
}

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
    const newResponse = new Response(response.body, response);
    if (download) {
      newResponse.headers.set("Content-Disposition", `attachment; filename="${uuid()}.mp3"`);
    }
    return newResponse;
  } else {
    throw new Error(`TTS 请求失败，状态码 ${response.status}`);
  }
}

function generateSsml(text, voiceName, rate, pitch) {
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> 
            <voice name="${voiceName}"> 
              <mstts:express-as style="general" styledegree="1.0" role="default"> 
                <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> 
              </mstts:express-as> 
            </voice> 
          </speak>`;
}

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

async function voiceList() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "X-Ms-Useragent": "SpeechStudio/2021.05.001",
    "Content-Type": "application/json",
    "Origin": "https://azure.microsoft.com",
    "Referer": "https://azure.microsoft.com"
  };
  
  const response = await fetch("https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list", {
    headers: headers,
    cf: {
      cacheTtl: 600,
      cacheEverything: true,
      cacheKey: "mstrans-voice-list"
    }
  });
  
  if (!response.ok) {
    throw new Error(`获取语音列表失败，状态码 ${response.status}`);
  }
  
  return response.json();
}

function addCORSHeaders(response) {
  const newHeaders = new Headers(response.headers);
  Object.entries(makeCORSHeaders()).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, { ...response, headers: newHeaders });
}

function makeCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

async function refreshEndpoint() {
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    endpoint = await getEndpoint();
    const decodedJwt = JSON.parse(atob(endpoint.t.split(".")[1]));
    expiredAt = decodedJwt.exp;
    clientId = uuid();
    console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
  } else {
    console.log(`过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
  }
}

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

function formatDate() {
  const date = new Date();
  const utcString = date.toUTCString().replace(/GMT/, "").trim() + " GMT";
  return utcString.toLowerCase();
}

async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}
