const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

// This function works with both Netlify and Cloudflare Pages functions
async function handler(event, context) {
  try {
    // Normalize the event object for different serverless environments
    const isCloudflare = event.request !== undefined;
    
    if (isCloudflare) {
      // Cloudflare Pages format
      return await handleCloudflareRequest(event.request);
    } else {
      // Netlify Functions format
      return await handleNetlifyRequest(event, context);
    }
  } catch (error) {
    console.error("API Error:", error);
    return {
      statusCode: 500,
      headers: makeCORSHeaders(),
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
}

// Handle Cloudflare Pages request format
async function handleCloudflareRequest(request) {
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
  
  // Handle API endpoints
  switch (path) {
    case '/tts':
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
          // Forward the response directly
          return response;
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
        const text = url.searchParams.get("t") || "";
        const voiceName = url.searchParams.get("v") || "zh-CN-XiaoxiaoMultilingualNeural";
        const rate = Number(url.searchParams.get("r")) || 0;
        const pitch = Number(url.searchParams.get("p")) || 0;
        const outputFormat = url.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
        const download = url.searchParams.get("d") === "true";
        
        try {
          const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
          return response;
        } catch (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...makeCORSHeaders()
            }
          });
        }
      }
    case '/voices':
      return await handleVoicesCloudflare(url);
    default:
      return new Response(getDefaultHTML(url), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
  }
}

// Handle Netlify Functions request format
async function handleNetlifyRequest(event, context) {
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
        return await handleTTSPostNetlify(event);
      } else {
        return await handleTTSGetNetlify(url);
      }
    case '/voices':
      return await handleVoicesNetlify(url);
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
}

async function getVoice(text, voiceName, rate, pitch, outputFormat, download) {
  await refreshEndpoint();
  
  // Generate SSML
  const ssml = generateSsml(text, voiceName, rate, pitch);
  
  // Get URL and endpoint from Microsoft Translator service
  const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
  
  // Set up headers correctly
  const headers = {
    "Authorization": endpoint.t, // Don't add Bearer - endpoint.t already includes it
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
  const newResponse = new Response(response.body, response);
  if (download) {
    newResponse.headers.set("Content-Disposition", `attachment; filename="${voiceName}.mp3"`);
  }
  
  // Add CORS headers
  return addCORSHeaders(newResponse);
}

function addCORSHeaders(response) {
  const newHeaders = new Headers(response.headers);
  Object.entries(makeCORSHeaders()).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, { ...response, headers: newHeaders });
}

async function handleTTSPostNetlify(event) {
  try {
    const body = JSON.parse(event.body);
    const text = body.text || "";
    const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
    const rate = Number(body.rate) || 0;
    const pitch = Number(body.pitch) || 0;
    const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
    const download = !body.preview;
    
    await refreshEndpoint();
  
    // Generate SSML
    const ssml = generateSsml(text, voiceName, rate, pitch);
    
    // Get URL and endpoint from Microsoft Translator service
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    
    // Set up headers correctly
    const headers = {
      "Authorization": endpoint.t,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "okhttp/4.5.0"
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
    
    // For Netlify, we need to convert to base64
    const buffer = await response.arrayBuffer();
    const base64Data = btoa(
      new Uint8Array(buffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        ...makeCORSHeaders(),
        ...(download ? { "Content-Disposition": `attachment; filename="${voiceName}.mp3"` } : {})
      },
      isBase64Encoded: true,
      body: base64Data
    };
  } catch (error) {
    console.error("TTS Post Error:", error);
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

async function handleTTSGetNetlify(url) {
  const text = url.searchParams.get("t") || "";
  const voiceName = url.searchParams.get("v") || "zh-CN-XiaoxiaoMultilingualNeural";
  const rate = Number(url.searchParams.get("r")) || 0;
  const pitch = Number(url.searchParams.get("p")) || 0;
  const outputFormat = url.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
  const download = url.searchParams.get("d") === "true";

  try {
    await refreshEndpoint();
  
    // Generate SSML
    const ssml = generateSsml(text, voiceName, rate, pitch);
    
    // Get URL and endpoint from Microsoft Translator service
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    
    // Set up headers correctly
    const headers = {
      "Authorization": endpoint.t,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "okhttp/4.5.0"
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
    
    // For Netlify, we need to convert to base64
    const buffer = await response.arrayBuffer();
    const base64Data = btoa(
      new Uint8Array(buffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        ...makeCORSHeaders(),
        ...(download ? { "Content-Disposition": `attachment; filename="${voiceName}.mp3"` } : {})
      },
      isBase64Encoded: true,
      body: base64Data
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        ...makeCORSHeaders()
      },
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
}

async function refreshEndpoint() {
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    endpoint = await getEndpoint();
    // For Cloudflare Workers/Pages, atob() is available but Buffer isn't
    try {
      // Check if we're in Node.js or Cloudflare environment
      const isNodejs = typeof Buffer !== 'undefined';
      
      if (isNodejs) {
        const decodedJwt = JSON.parse(Buffer.from(endpoint.t.split(".")[1], "base64").toString());
        expiredAt = decodedJwt.exp;
      } else {
        const base64 = endpoint.t.split(".")[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        const decodedJwt = JSON.parse(jsonPayload);
        expiredAt = decodedJwt.exp;
      }
      
      clientId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
      console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } catch (error) {
      console.error("无法解析JWT:", error);
      // Set a default expiry time in case of error
      expiredAt = (Date.now() / 1000) + 3600; // 1 hour from now
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
  const url = urlStr.split("://")[1];
  const encodedUrl = encodeURIComponent(url);
  const uuidStr = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
  const formattedDate = formatDate();
  
  // Use different approach based on the environment (Node.js vs Browser/Cloudflare)
  let signatureBase64;
  
  try {
    // Determine if we're in Node environment
    if (typeof Buffer !== 'undefined' && typeof require === 'function') {
      const crypto = require('crypto');
      const key = Buffer.from("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==", 'base64');
      const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
      
      const hmac = crypto.createHmac('sha256', key);
      hmac.update(bytesToSign);
      signatureBase64 = hmac.digest('base64');
    } else {
      // For Cloudflare Workers/Pages
      const key = await crypto.subtle.importKey(
        'raw',
        base64ToArrayBuffer("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw=="),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(bytesToSign)
      );
      
      signatureBase64 = arrayBufferToBase64(signature);
    }
  } catch (error) {
    console.error("Generate signature error:", error);
    throw error;
  }
  
  return `MSTranslatorAndroidApp::${signatureBase64}::${formattedDate}::${uuidStr}`;
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

// Export the handler function for different serverless platforms
exports.handler = handler;
module.exports = handler;
