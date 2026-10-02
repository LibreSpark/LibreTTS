// 自定义 API 的 localStorage 读写、导入导出与模型获取（自 script.js 移植）
import type { ApiFormat, CustomApi, SpeakerMap } from "./types";

const STORAGE_KEY = "customAPIs";

export type CustomApiMap = Record<string, CustomApi>;

export function loadCustomApis(): CustomApiMap {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as CustomApiMap) : {};
  } catch (error) {
    console.error("加载自定义API失败:", error);
    return {};
  }
}

export function persistCustomApis(apis: CustomApiMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
}

export function newCustomApiId(): string {
  return `custom-${Date.now()}`;
}

/** 从各种常见模型列表响应中提取 (id, 显示名) 列表 */
function extractModelEntries(data: unknown): Array<{ id: string; label?: string }> {
  let arr: unknown[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data as { data?: unknown; models?: unknown; voices?: unknown };
    if (Array.isArray(obj.data)) arr = obj.data;
    else if (Array.isArray(obj.models)) arr = obj.models;
    else if (Array.isArray(obj.voices)) arr = obj.voices;
  }
  return arr
    .map((item) => {
      if (typeof item === "string") return { id: item };
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const id = o.id ?? o.ShortName ?? o.name ?? o.model ?? o.voice;
        const label = o.name ?? o.LocalName ?? o.display_name ?? o.label;
        return id ? { id: String(id), label: label ? String(label) : undefined } : null;
      }
      return null;
    })
    .filter((v): v is { id: string; label?: string } => Boolean(v));
}

/** 获取自定义 API 的讲述人列表（兼容 OpenAI /models、Edge voices 等常见响应） */
export async function fetchCustomSpeakers(api: CustomApi): Promise<SpeakerMap> {
  if (!api.modelEndpoint) {
    return { default: "默认讲述者" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (api.apiKey) {
    headers["Authorization"] = `Bearer ${api.apiKey}`;
  }

  const response = await fetch(api.modelEndpoint, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`获取讲述者失败: ${response.status}`);
  }

  const data = await response.json();
  const entries = extractModelEntries(data);
  // 优先只保留 TTS 相关模型：OpenAI /models 会混入大量对话模型
  const ttsOnly = entries.filter(
    (m) =>
      m.id.startsWith("tts-") ||
      ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(m.id)
  );
  const picked = ttsOnly.length > 0 ? ttsOnly : entries;
  if (picked.length === 0) {
    console.warn("API返回格式不是标准模型列表:", data);
    return { default: "未找到模型" };
  }
  const speakerMap: SpeakerMap = {};
  picked.forEach((m) => {
    speakerMap[m.id] = m.label || m.id;
  });
  return speakerMap;
}

/** 拉取模型列表（弹窗“获取模型”按钮用） */
export async function fetchModelList(api: {
  modelEndpoint?: string;
  apiKey?: string;
  format: ApiFormat;
}): Promise<string[]> {
  if (!api.modelEndpoint) {
    throw new Error("请先填写模型列表端点");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (api.apiKey) {
    headers["Authorization"] = `Bearer ${api.apiKey}`;
  }
  const response = await fetch(api.modelEndpoint, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`获取模型失败: ${response.status}`);
  }
  const data = await response.json();
  const ids = extractModelEntries(data).map((m) => m.id);
  if (ids.length === 0) {
    throw new Error("无法识别的模型列表格式");
  }
  return ids;
}

export interface ExportFile {
  version: string;
  timestamp: string;
  apis: CustomApi[];
}

export function buildExport(apis: CustomApiMap): ExportFile {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    apis: Object.values(apis),
  };
}

export function exportFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ciallo-tts-apis-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** 解析导入文件，校验结构 */
export function parseImportFile(text: string): CustomApi[] {
  const data = JSON.parse(text);
  if (!data.apis || !Array.isArray(data.apis)) {
    throw new Error("文件格式不正确：缺少 apis 数组");
  }
  return data.apis.filter(
    (api: CustomApi) => api && api.name && api.endpoint
  );
}

/** 合并导入的 API：按 name+endpoint 去重，同名同端点则更新，否则新增 */
export function mergeImportedApis(existing: CustomApiMap, incoming: CustomApi[]): CustomApiMap {
  const merged: CustomApiMap = { ...existing };
  for (const api of incoming) {
    const match = Object.entries(merged).find(
      ([, cur]) => cur.name === api.name && cur.endpoint === api.endpoint
    );
    if (match) {
      merged[match[0]] = { ...match[1], ...api, id: match[0] };
    } else {
      const id = `${newCustomApiId()}-${Object.keys(merged).length}`;
      merged[id] = { ...api, id };
    }
  }
  return merged;
}
