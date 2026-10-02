// Edge 语音列表：统一上游请求与缓存，供 /api/voices、/api/voice-meta 复用。
// 上游返回字段节选：ShortName / LocalName / Locale / Gender / StyleList / RolePlayList
export interface EdgeVoiceItem {
  ShortName: string;
  LocalName: string;
  Locale: string;
  LocaleName?: string;
  Gender: string;
  WordsPerMinute?: number | string;
  SampleRateHertz?: number | string;
  /** 该语音支持的情绪风格（style），如 cheerful / sad */
  StyleList?: string[];
  /** 该语音支持的角色扮演（role），如 Girl / OlderAdultMale */
  RolePlayList?: string[];
  [key: string]: unknown;
}

const VOICES_CACHE_TTL = 60 * 60 * 1000; // 1 小时
let voicesCache: EdgeVoiceItem[] | null = null;
let voicesCacheTime = 0;
let voicesCachePromise: Promise<EdgeVoiceItem[]> | null = null;

/** 获取全量语音列表（内存缓存 1 小时，并发请求共享一次上游拉取） */
export async function fetchEdgeVoices(): Promise<EdgeVoiceItem[]> {
  const now = Date.now();
  if (voicesCache && now - voicesCacheTime < VOICES_CACHE_TTL) {
    return voicesCache;
  }
  // 并发去重：同一时刻只发一次上游请求
  if (!voicesCachePromise) {
    voicesCachePromise = (async () => {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "X-Ms-Useragent": "SpeechStudio/2021.05.001",
        "Content-Type": "application/json",
        "Origin": "https://azure.microsoft.com",
        "Referer": "https://azure.microsoft.com",
      };

      // 上游挂起会让 /api/voices 与 /api/voice-meta 一起卡死，这里必须有超时
      const response = await fetch("https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list", {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`获取语音列表失败，状态码 ${response.status}`);
      }

      const data = (await response.json()) as EdgeVoiceItem[];
      voicesCache = data;
      voicesCacheTime = Date.now();
      return data;
    })().finally(() => {
      voicesCachePromise = null;
    });
  }
  return voicesCachePromise;
}

/** 按 ShortName 查找语音（忽略大小写），未找到返回 null */
export async function findEdgeVoice(shortName: string): Promise<EdgeVoiceItem | null> {
  const target = shortName.trim().toLowerCase();
  if (!target) return null;
  const list = await fetchEdgeVoices();
  return list.find((item) => (item.ShortName || "").toLowerCase() === target) ?? null;
}
