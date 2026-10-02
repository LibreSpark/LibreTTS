// 纯函数单元测试：node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { getApiLimits, getPreviewText, getTextLength, splitText, truncateToUnits, escapeXml } from "../src/lib/segmentation.ts";
import { formatToExtension, escapeXml as serverEscapeXml, generateSsml } from "../src/lib/edgeTts.ts";

// ---------- getTextLength ----------
test("getTextLength: 中文按2单位计算", () => {
  assert.equal(getTextLength("你好"), 4);
});

test("getTextLength: 英文按1单位计算", () => {
  assert.equal(getTextLength("hello"), 5);
});

test("getTextLength: 混合文本", () => {
  assert.equal(getTextLength("你好world"), 9);
});

test("getTextLength: 停顿标签按1秒=11单位", () => {
  assert.equal(getTextLength('<break time="1s"/>'), 11);
  assert.equal(getTextLength('<break time="0.5s"/>'), Math.round(0.5 * 11));
  assert.equal(getTextLength('<break time="500ms"/>'), Math.round(0.5 * 11));
});

test("getTextLength: 停顿标签外的文本正常计算", () => {
  assert.equal(getTextLength('你<break time="1s"/>好'), 4 + 11);
});

// ---------- splitText ----------
test("splitText: 短文本不分段", () => {
  assert.deepEqual(splitText("你好世界", 100), ["你好世界"]);
});

test("splitText: 按句末标点分段", () => {
  const text = "第一句话。第二句话。第三句话！第四句话？";
  const segments = splitText(text, 12);
  assert.ok(segments.length > 1);
  // 所有段拼起来应等于原文（忽略 trim）
  assert.equal(segments.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  segments.forEach((s) => assert.ok(getTextLength(s) <= 12, `段超限: ${JSON.stringify(s)}`));
});

test("splitText: 无标点长文本硬切", () => {
  const text = "a".repeat(30);
  const segments = splitText(text, 10);
  assert.equal(segments.length, 3);
  assert.equal(segments.join(""), text);
});

test("splitText: 中文长文本在标点附近分段", () => {
  const text = "这是第一句，这是第二句，这是第三句，这是第四句。";
  const segments = splitText(text, 14);
  assert.ok(segments.length >= 2);
  segments.forEach((s) => assert.ok(getTextLength(s) <= 14, `段超限: ${JSON.stringify(s)}`));
});

test("splitText: 保留停顿标签不被截断在标签内部", () => {
  const text = "你好<break time=\"1s\"/>世界".repeat(5);
  const segments = splitText(text, 20);
  // 每段不应包含残缺的标签
  segments.forEach((s) => {
    const opens = (s.match(/<break/g) || []).length;
    const closes = (s.match(/\/>/g) || []).length;
    assert.equal(opens, closes, `标签被截断: ${JSON.stringify(s)}`);
  });
});

test("splitText: 空文本返回空数组", () => {
  assert.deepEqual(splitText("", 100), []);
  assert.deepEqual(splitText("   ", 100), []);
});

// ---------- escapeXml ----------
test("escapeXml: 转义全部特殊字符", () => {
  assert.equal(escapeXml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
});

test("escapeXml: 空值安全", () => {
  assert.equal(escapeXml(null), "");
  assert.equal(escapeXml(undefined), "");
});

test("escapeXml: 服务端版本与客户端一致", () => {
  const sample = `<text>&"'你好`;
  assert.equal(serverEscapeXml(sample), escapeXml(sample));
});

// ---------- generateSsml ----------
test("generateSsml: 转义用户文本防注入", () => {
  const ssml = generateSsml(`你好&<break/>`, "zh-CN-XiaoxiaoNeural", 0, 0);
  assert.ok(!ssml.includes("你好&<break/>"));
  assert.ok(ssml.includes("你好&amp;&lt;break/&gt;"));
  assert.ok(ssml.includes('<voice name="zh-CN-XiaoxiaoNeural">'));
});

test("generateSsml: 保留合法停顿标签", () => {
  const ssml = generateSsml('前半句<break time="1.5s"/>后半句', "zh-CN-XiaoxiaoNeural", 0, 0);
  assert.ok(ssml.includes('前半句<break time="1.5s"/>后半句'), "合法停顿标签被破坏: " + ssml);
});

test("generateSsml: 非法停顿标签仍被转义（防注入）", () => {
  // 伪造成合法样式的注入尝试应被整体转义，不会以原始标签形式出现在 SSML 中
  const ssml = generateSsml('<break time="1s" onclick="x"/>', "zh-CN-XiaoxiaoNeural", 0, 0);
  assert.ok(!ssml.includes('<break time="1s" onclick'), "注入标签未被转义");
  assert.ok(ssml.includes('&lt;break'), "应被转义为实体");
});

test("generateSsml: ms 停顿标签与多个标签混合", () => {
  const text = 'A<break time="500ms"/>B&C<break time="2s"/>';
  const ssml = generateSsml(text, "v", 0, 0);
  assert.ok(ssml.includes('<break time="500ms"/>'));
  assert.ok(ssml.includes('<break time="2s"/>'));
  assert.ok(ssml.includes('B&amp;C'), "& 应被转义: " + ssml);
});

// ---------- formatToExtension ----------
test("formatToExtension: 常见格式映射", () => {
  assert.equal(formatToExtension("audio-24khz-48kbitrate-mono-mp3"), "mp3");
  assert.equal(formatToExtension("riff-24khz-16bit-mono-pcm"), "wav");
  assert.equal(formatToExtension("audio-24khz-48khz-16bit-24kbps-opus"), "opus");
  assert.equal(formatToExtension("ogg-24khz-16bit-mono-opus"), "ogg");
  assert.equal(formatToExtension("webm-24khz-16bit-mono-opus"), "webm");
  assert.equal(formatToExtension("raw-16khz-16bit-mono-pcm"), "pcm");
  assert.equal(formatToExtension("unknown-format"), "mp3");
});

// ---------- getApiLimits ----------
test("getApiLimits: openai 限制更严格", () => {
  const oai = getApiLimits("openai");
  const edge = getApiLimits("edge");
  assert.ok(oai.maxSegment < edge.maxSegment);
  assert.ok(oai.maxTotal < edge.maxTotal);
  assert.deepEqual(oai, { maxSegment: 400, maxTotal: 2000 });
  assert.deepEqual(edge, { maxSegment: 5000, maxTotal: 100000 });
});

// ---------- 长文本完整性 ----------
test("splitText: 1000字长文本分段后内容完整", () => {
  const text = Array.from({ length: 100 }, (_, i) => `这是第${i}句测试内容。`).join("");
  const segments = splitText(text, 5000);
  assert.equal(segments.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  segments.forEach((s) => assert.ok(getTextLength(s) <= 5000));
});

// ---------- getPreviewText ----------
test("getPreviewText: 无标签时取前20字符", () => {
  const text = "一二三四五六七八九十一二三四五六七八九十" + "多余的";
  assert.equal(getPreviewText(text, 20), text.slice(0, 20));
});

test("getPreviewText: 标签在截断点内时保持完整", () => {
  const text = '前半句，<break time="1.5s"/>后半句很长很长很长';
  const p = getPreviewText(text, 20);
  assert.ok(p.includes('<break time="1.5s"/>'), "标签被截断: " + p);
  // 前半句，(4字符) + 完整标签 → 后半句补足到20字符
  assert.equal(p, '前半句，<break time="1.5s"/>' + "后半句很长很长很长".slice(0, 16));
});

test("getPreviewText: 截断点正好落在标签中间时扩展到标签结束", () => {
  const text = "一二三四五六七八九十<break time=\"1s\"/>尾巴";
  const p = getPreviewText(text, 10);
  assert.equal(p, "一二三四五六七八九十<break time=\"1s\"/>");
});

test("getPreviewText: 标签不计入字符数", () => {
  const text = '<break time="2s"/>一二三四五';
  assert.equal(getPreviewText(text, 5), '<break time="2s"/>一二三四五');
});

// ---------- truncateToUnits（关闭自动分段时的处理） ----------
test("truncateToUnits: 未超上限原样返回", () => {
  assert.equal(truncateToUnits("你好", 10), "你好");
});

test("truncateToUnits: 超上限按单位数截断", () => {
  // 中文 2 单位，10 单位即 5 个字
  assert.equal(truncateToUnits("一二三四五六七", 10), "一二三四五");
});

test("truncateToUnits: 放不下的停顿标签整体丢弃", () => {
  const text = '短句<break time="3s"/>长尾内容';
  // "短句"=4 单位，标签=33 单位，预算 10 装不下标签 → 只留前缀，且不残留残缺标签
  const cut = truncateToUnits(text, 10);
  assert.equal(cut, "短句");
  assert.ok(!cut.includes("<break"), "出现残缺标签: " + cut);
});

test("truncateToUnits: 极小预算不会卡死", () => {
  assert.equal(truncateToUnits("一二三", 0), "");
  assert.equal(truncateToUnits("一二三", 1), "");
  assert.equal(truncateToUnits("一二三", 2), "一");
});

// ---------- splitText 终止性 ----------
test("splitText: 退化上限不会死循环", () => {
  const segments = splitText("你好世界", 1);
  assert.ok(segments.join("").includes("你"));
  segments.forEach((s) => assert.ok(s.length > 0, "产生空段会原地打转"));
});
