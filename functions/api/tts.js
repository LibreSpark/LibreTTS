const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

// Simplified handler for Cloudflare Pages
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...makeCORSHeaders(),
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-auth-token"
      }
    });
  }

  try {
    // Handle API endpoints
    if (path === '/tts') {
      if (request.method === "POST") {
        const body = await request.json();
        const text = body.text || "";
        const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
        const rate = Number(body.rate) || 0;
        const pitch = Number(body.pitch) || 0;
        const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
        const download = body.preview === false;
        
        return await handleTTS(text, voiceName, rate, pitch, outputFormat, download);
      } else if (request.method === "GET") {
        const text = url.searchParams.get("t") || "";
        const voiceName = url.searchParams.get("v") || "zh-CN-XiaoxiaoMultilingualNeural";
        const rate = Number(url.searchParams.get("r")) || 0;
        const pitch = Number(url.searchParams.get("p")) || 0;
        const outputFormat = url.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
        const download = url.searchParams.get("d") === "true";
        
        return await handleTTS(text, voiceName, rate, pitch, outputFormat, download);
      } else {
        return new Response(JSON.stringify({
          error: "Method not allowed"
        }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...makeCORSHeaders()
          }
        });
      }
    } else if (path === '/voices') {
      if (request.method === "GET") {
        return await handleVoices(url);
      } else {
        return new Response(JSON.stringify({
          error: "Method not allowed"
        }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...makeCORSHeaders()
          }
        });
      }
    } else {
      return new Response(getDefaultHTML(url), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
    }
  } catch (error) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal Server Error"
    }), {
      status: 500, 
      headers: {
        "Content-Type": "application/json",
        ...makeCORSHeaders()
      }
    });
  }
}

async function handleTTS(text, voiceName, rate, pitch, outputFormat, download) {
  try {
    await refreshEndpoint();
    
    // Generate SSML
    const ssml = generateSsml(text, voiceName, rate, pitch);
    
    // Get URL from endpoint
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    
    // Set up headers
    const headers = {
      "Authorization": endpoint.t,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "okhttp/4.5.0",
      "Origin": "https://azure.microsoft.com",
      "Referer": "https://azure.microsoft.com/"
    };
    
    // Make the request to Microsoft's TTS service
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: ssml
    });
  
    // Handle errors
    if (!response.ok) {
      throw new Error(`TTS 请求失败，状态码 ${response.status}`);
    }
  
    // Create a new response with the appropriate headers
    const responseHeaders = new Headers({
      "Content-Type": "audio/mpeg",
      ...makeCORSHeaders()
    });
    
    if (download) {
      responseHeaders.set("Content-Disposition", `attachment; filename="${voiceName}.mp3"`);
    }
    
    const audioData = await response.arrayBuffer();
    return new Response(audioData, {
      status: 200,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...makeCORSHeaders()
      }
    });
  }
}

async function handleVoices(url) {
  try {
    const localeFilter = (url.searchParams.get("l") || "").toLowerCase();
    const format = url.searchParams.get("f");
    
    let voices = await voiceList();
    if (localeFilter) {
      voices = voices.filter(item => item.Locale.toLowerCase().includes(localeFilter));
    }
    
    if (format === "0") {
      const formattedVoices = voices.map(item => formatVoiceItem(item));
      return new Response(formattedVoices.join("\n"), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
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
    return new Response(JSON.stringify({
      error: error.message || "Failed to fetch voices"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...makeCORSHeaders()
      }
    });
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
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-auth-token",
    "Access-Control-Max-Age": "86400"
  };
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

async function refreshEndpoint() {
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    try {
      endpoint = await getEndpoint();
      
      // Parse JWT token to get expiry time
      const parts = endpoint.t.split(".");
      if (parts.length >= 2) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        
        const decodedJwt = JSON.parse(jsonPayload);
        expiredAt = decodedJwt.exp;
      } else {
        // Default expiry if we can't parse the token
        expiredAt = (Date.now() / 1000) + 3600;
      }
      
      clientId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
      console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } catch (error) {
      console.error("无法获取或解析Endpoint:", error);
      throw error;
    }
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
    "X-ClientTraceId": clientId || "76a75279-2ffa-4c3d-8db8-7b47252aa41c",
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
  try {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
    const formattedDate = formatDate();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    
    // Import the key for signing
    const keyData = base64ToArrayBuffer("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign']
    );
    
    // Sign the data
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(bytesToSign)
    );
    
    // Convert the signature to base64
    const signatureBase64 = arrayBufferToBase64(signature);
    
    return `MSTranslatorAndroidApp::${signatureBase64}::${formattedDate}::${uuidStr}`;
  } catch (error) {
    console.error("Generate signature error:", error);
    throw error;
  }
}

function formatDate() {
  const date = new Date();
  const utcString = date.toUTCString().replace(/GMT/, "").trim() + " GMT";
  return utcString.toLowerCase();
}

// Helper functions for Cloudflare environment
function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
