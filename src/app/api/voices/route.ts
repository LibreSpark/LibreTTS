import { errorResponse, jsonResponse, preflightResponse, corsHeaders } from "@/lib/api";
import { isRequestAuthorized } from "@/lib/auth";
import { fetchEdgeVoices, type EdgeVoiceItem } from "@/lib/edgeVoices";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type VoiceItem = EdgeVoiceItem;

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req);
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isRequestAuthorized(req))) {
      return errorResponse(req, "需要访问密码", 401);
    }
    const q = req.nextUrl.searchParams;
    const localeFilter = (q.get("l") || "").toLowerCase();
    const format = q.get("f");

    let voices = await voiceList();
    if (localeFilter) {
      voices = voices.filter((item) => item.Locale.toLowerCase().includes(localeFilter));
    }

    if (format === "0") {
      // MultiTTS YAML speaker 格式
      const formatted = voices.map(formatVoiceItem);
      return new Response(formatted.join("\n"), {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) },
      });
    } else if (format === "1") {
      return jsonResponse(req, Object.fromEntries(voices.map((item) => [item.ShortName, item.LocalName])));
    } else {
      return jsonResponse(req, voices);
    }
  } catch (error) {
    console.error("API Error:", error);
    return errorResponse(req, error instanceof Error ? error.message : "Failed to fetch voices");
  }
}

function formatVoiceItem(item: VoiceItem): string {
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

// 语音列表缓存见 @/lib/edgeVoices，避免每次请求都向上游拉取全量列表
function voiceList(): Promise<VoiceItem[]> {
  return fetchEdgeVoices();
}
