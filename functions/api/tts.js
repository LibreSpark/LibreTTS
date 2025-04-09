const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

exports.handler = async function(event, context) {
  try {
    const path = event.path.replace(/^\/api/, '');
    const url = new URL(event.rawUrl);
    
    // Handle CORS preflight requests
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          ...makeCORSHeaders(),
          "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-auth-token"
        }
      };
    }

    // Handle API endpoints
    switch (path) {
      case '/tts':
        if (event.httpMethod === "POST") {
          return await handleTTSPost(event);
        } else {
          return await handleTTSGet(url);
        }
      case '/voices':
        return await handleVoices(url);
      default:
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...makeCORSHeaders()
          },
          body: getDefaultHTML(url)
        };
    }
  } catch (error) {
    console.error("API Error:", error);
    return {
      statusCode: 500,
      headers: makeCORSHeaders(),
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
};

async function handleTTSPost(event) {
  try {
    const body = JSON.parse(event.body);
    const text = body.text || "";
    const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
    const rate = Number(body.rate) || 0;
    const pitch = Number(body.pitch) || 0;
    const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
    const download = !body.preview;
    
    const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
    
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        ...makeCORSHeaders()
      },
      isBase64Encoded: true,
      body: response.base64
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        ...makeCORSHeaders()
      },
      body: JSON.stringify({ error: error.message })
    };
  }
}

async function handleTTSGet(url) {
  const text = url.searchParams.get("t") || "";
  const voiceName = url.searchParams.get("v") || "zh-CN-XiaoxiaoMultilingualNeural";
  const rate = Number(url.searchParams.get("r")) || 0;
  const pitch = Number(url.searchParams.get("p")) || 0;
  const outputFormat = url.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
  const download = url.searchParams.get("d") === "true";

  try {
    const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
    
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        ...makeCORSHeaders()
      },
      isBase64Encoded: true,
      body: response.base64
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: makeCORSHeaders(),
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
}

async function handleVoices(url) {
  const localeFilter = (url.searchParams.get("l") || "").toLowerCase();
  const format = url.searchParams.get("f");
  
  try {
    let voices = await voiceList();
    if (localeFilter) {
      voices = voices.filter(item => item.Locale.toLowerCase().includes(localeFilter));
    }
    
    if (format === "0") {
      const formattedVoices = voices.map(item => formatVoiceItem(item));
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...makeCORSHeaders()
        },
        body: formattedVoices.join("\n")
      };
    } else if (format === "1") {
      const voiceMap = Object.fromEntries(voices.map(item => [item.ShortName, item.LocalName]));
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...makeCORSHeaders()
        },
        body: JSON.stringify(voiceMap)
      };
    } else {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...makeCORSHeaders()
        },
        body: JSON.stringify(voices)
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: makeCORSHeaders(),
      body: JSON.stringify({ error: error.message || "Failed to fetch voices" })
    };
  }
}

function getDefaultHTML(url) {
  const baseUrl = `${url.protocol}//${url.host}/api`;
  return `
  <ol>
      <li> /tts?t=[text]&v=[voice]&r=[rate]&p=[pitch]&o=[outputFormat] <a href="${baseUrl}/tts?t=hello, world&v=zh-CN-XiaoxiaoMultilingualNeural&r=0&p=0&o=audio-24khz-48kbitrate-mono-mp3">试试</a> </li>
      <li> /voices?l=[locale, 如 zh|zh-CN]&f=[format, 0/1/空 0(TTS-Server)|1(MultiTTS)] <a href="${baseUrl}/voices?l=zh&f=1">试试</a> </li>
  </ol>
  `;
}

async function getVoice(text, voiceName, rate, pitch, outputFormat, download) {
  await refreshEndpoint();
  
  const ssml = generateSsml(text, voiceName, rate, pitch);
  const url = endpoint.ttsUrl;
  
  const headers = {
    "Authorization": `Bearer ${endpoint.t}`,
    "Content-Type": "application/ssml+xml",
    "X-Microsoft-OutputFormat": outputFormat,
    "User-Agent": "edgeTTS4R",
    "Origin": "https://azure.microsoft.com",
    "Referer": "https://azure.microsoft.com/",
    "X-ClientTraceId": clientId
  };
  
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${voiceName}.mp3"`;
  }
  
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: encoder.encode(ssml)
  });
  
  if (!response.ok) {
    throw new Error(`获取语音失败，状态码 ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  return { 
    base64: Buffer.from(buffer).toString('base64')
  };
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
    headers: headers
  });
  
  if (!response.ok) {
    throw new Error(`获取语音列表失败，状态码 ${response.status}`);
  }
  
  return await response.json();
}

function makeCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-auth-token",
    "Access-Control-Max-Age": "86400"
  };
}

async function refreshEndpoint() {
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    endpoint = await getEndpoint();
    const decodedJwt = JSON.parse(Buffer.from(endpoint.t.split(".")[1], "base64").toString());
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
  
  return await response.json();
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
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', Buffer.from(key));
  hmac.update(data);
  return Buffer.from(hmac.digest());
}

async function base64ToBytes(base64) {
  return Buffer.from(base64, 'base64');
}

async function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function uuid() {
  return require('crypto').randomUUID().replace(/-/g, "");
}
