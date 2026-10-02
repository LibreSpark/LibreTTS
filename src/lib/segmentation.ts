// 文本长度计算与分段算法（自 script.js 移植为纯函数）
import type { ApiFormat } from "./types";

export interface ApiLimits {
  /** 单次请求允许的最大单位数 */
  maxSegment: number;
  /** 整段文本允许的最大单位数（超出则拒绝/截断） */
  maxTotal: number;
}

const FORMAT_LIMITS: Record<ApiFormat, ApiLimits> = {
  openai: { maxSegment: 400, maxTotal: 2000 },
  edge: { maxSegment: 5000, maxTotal: 100000 },
  template: { maxSegment: 5000, maxTotal: 100000 },
};

export function getApiLimits(format: ApiFormat): ApiLimits {
  return FORMAT_LIMITS[format] ?? FORMAT_LIMITS.edge;
}

/**
 * 结合自定义 API 的 maxLength（单次请求上限）解析出实际生效的限制。
 * 设置后 maxTotal 取 maxSegment 的 5 倍，允许自动分段落长文本。
 * 前端计数器与请求校验共用此函数，保证两处阈值一致。
 */
export function resolveApiLimits(format: ApiFormat, maxLength?: number | null): ApiLimits {
  const base = getApiLimits(format);
  if (maxLength && Number.isFinite(maxLength) && maxLength > 0) {
    // 单个 CJK 字符就占 2 单位，上限小于 2 时任何字符都放不下，splitText 会原地打转
    const maxSegment = Math.max(2, Math.floor(maxLength));
    return { maxSegment, maxTotal: maxSegment * 5 };
  }
  return base;
}

/** 计算文本等效长度：中文 2 单位 / 英文 1 单位 / 停顿 1 秒 = 11 单位 */
export function getTextLength(str: string): number {
  // 移除 XML 标签，但记录停顿时间
  let totalPauseTime = 0;
  const textWithoutTags = str.replace(/<break\s+time="(\d+(?:\.\d+)?)(m?s)"\s*\/>/g, (_match, time: string, unit: string) => {
    const seconds = unit === "ms" ? parseFloat(time) / 1000 : parseFloat(time);
    totalPauseTime += seconds;
    return "";
  });

  const textLength = textWithoutTags.split("").reduce((acc, char) => {
    return acc + (char.charCodeAt(0) > 127 ? 2 : 1);
  }, 0);

  const pauseLength = Math.round(totalPauseTime * 11);
  return textLength + pauseLength;
}

const PUNCTUATION_GROUPS: string[][] = [
  // 第一优先级: 换行符
  ["\n", "\r\n"],
  // 第二优先级: 句末标点
  [
    "。", "！", "？", ".", "!", "?",
    "。", "！", "？", "︒", "︕", "︖",
    "｡", "!", "?", "。", "॥", "؟", "۔",
    "។", "៕", "။", "၏", "¿", "¡",
    "‼", "⁇", "⁈", "⁉", "‽", "~",
  ],
  // 第三优先级: 分号
  ["；", ";", "；", "︔", "︐", "؛", "፤", "꛶"],
  // 第四优先级: 逗号和冒号
  [
    "，", "：", ",", ":", "、", "，", "：",
    "︑", "︓", "､", ":", "、", "፣", "፥",
    "၊", "၌", "、", "؍", "׀", "，",
  ],
  // 第五优先级: 其他标点
  ["、", "…", "―", "─", "-", "—", "–", "‥", "〳", "〴", "〵", "᠁", "᠂", "᠃", "᭛", "᭜", "᭝"],
  // 第六优先级: 空格和其他分隔符
  [" ", "\t", "　", "〿", "〮", "〯", "᠀", "᭟", "᭠", "᳓", "᳔", "᳕"],
];

const BREAK_TAG_RE = /<break\s+time=["']\d+(?:\.\d+)?[ms]s?["']\s*\/>/g;

/** 标记出文本中每个 <break/> 标签的 [start, end) 区间，分段时作为原子单元处理 */
function findTagRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(BREAK_TAG_RE)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

function inTagRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos > s && pos < e);
}

/** 按标点优先级将长文本分段，每段不超过 maxSegment 单位 */
export function splitText(text: string, maxSegment: number): string[] {
  const segments: string[] = [];
  let remainingText = text.trim();

  while (remainingText.length > 0) {
    const tagRanges = findTagRanges(remainingText);
    let splitIndex = remainingText.length;
    let currentLength = 0;
    let bestSplitIndex = -1;

    for (let i = 0; i < remainingText.length; i++) {
      // <break/> 标签整体作为原子单元，不能从中间截断
      const tag = tagRanges.find(([s]) => s === i);
      if (tag) {
        currentLength += tag[1] - tag[0];
        i = tag[1] - 1; // for 循环 i++ 后跳到标签末尾
        continue;
      }

      currentLength += remainingText.charCodeAt(i) > 127 ? 2 : 1;

      if (currentLength > maxSegment) {
        splitIndex = i;
        // 先遍历优先级组
        for (let priority = 0; priority < PUNCTUATION_GROUPS.length; priority++) {
          let searchLength = 0;
          // 在300单位范围内搜索当前优先级的标点（跳过标签内部，避免切进标签）
          for (let j = i; j >= 0 && searchLength <= 300; j--) {
            searchLength += remainingText.charCodeAt(j) > 127 ? 2 : 1;

            if (!inTagRange(j, tagRanges) && PUNCTUATION_GROUPS[priority].includes(remainingText[j])) {
              bestSplitIndex = j;
              break;
            }
          }
          // 如果在当前优先级找到了分段点，就不再检查更低优先级
          if (bestSplitIndex > -1) break;
        }
        break;
      }
    }

    if (bestSplitIndex > 0) {
      splitIndex = bestSplitIndex + 1;
    }
    // 必须保证前进：splitIndex 为 0 时 remainingText 不会变短，会死循环并把空串无限追加
    if (splitIndex <= 0) splitIndex = 1;

    segments.push(remainingText.substring(0, splitIndex));
    remainingText = remainingText.substring(splitIndex).trim();
  }

  return segments;
}

/**
 * 按单位预算截断文本，用于关闭自动分段的场景。
 * 计数规则与 getTextLength 一致；放不下的 <break/> 标签整体丢弃，避免留下残缺 SSML。
 */
export function truncateToUnits(text: string, maxUnits: number): string {
  if (getTextLength(text) <= maxUnits) return text;
  const tags = findTagRanges(text);
  let units = 0;
  let cut = 0;
  let i = 0;
  while (i < text.length) {
    const tag = tags.find(([s]) => s === i);
    const end = tag ? tag[1] : i + 1;
    const cost = getTextLength(text.slice(i, end));
    if (units + cost > maxUnits) break;
    units += cost;
    cut = end;
    i = end;
  }
  return text.slice(0, cut).trim();
}

export function escapeXml(str: unknown): string {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string
  ));
}

const PREVIEW_TAG_RE = /<break\s+time=["']\d+(?:\.\d+)?[ms]s?["']\s*\/>/g;

/**
 * 取试听用的文本前缀：前 maxChars 个可见字符，但停顿标签必须保持完整——
 * 若按字符数硬切会把标签截断，产生残缺 SSML（试听与生成效果不一致的根源）。
 */
export function getPreviewText(text: string, maxChars = 20): string {
  const tags = [...text.matchAll(PREVIEW_TAG_RE)].map(
    (m) => [m.index!, m.index! + m[0].length] as [number, number]
  );
  let chars = 0;
  let cut = 0;
  let i = 0;
  while (i < text.length) {
    const tag = tags.find(([s]) => s === i);
    if (tag) {
      i = tag[1]; // 整个标签原样保留
      cut = i;
      continue;
    }
    chars += 1;
    i += 1;
    cut = i;
    if (chars >= maxChars) {
      // 截断点若紧跟停顿标签，一并包含（连续标签也全部保留）后再停
      let t = tags.find(([s]) => s === i);
      while (t) {
        i = t[1];
        cut = i;
        t = tags.find(([s]) => s === i);
      }
      break;
    }
  }
  return text.slice(0, cut);
}
