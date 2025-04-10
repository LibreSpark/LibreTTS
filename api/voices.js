export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-auth-token");
  
  // Handle OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const { query } = req;
    const localeFilter = (query.l || "").toLowerCase();
    const format = query.f;
    
    let voices = await voiceList();
    if (localeFilter) {
      voices = voices.filter(item => item.Locale.toLowerCase().includes(localeFilter));
    }
    
    if (format === "0") {
      const formattedVoices = voices.map(item => formatVoiceItem(item));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(formattedVoices.join("\n"));
    } else if (format === "1") {
      const voiceMap = Object.fromEntries(voices.map(item => [item.ShortName, item.LocalName]));
      return res.json(voiceMap);
    } else {
      return res.json(voices);
    }
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch voices" });
  }
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
