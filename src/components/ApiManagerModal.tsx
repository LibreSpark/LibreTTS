"use client";

// 自定义 API 管理弹窗：新增/编辑/复制/删除/批量删除、获取模型、导入导出
import { useEffect, useRef, useState } from "react";
import { Copy, FileDown, FileUp, LoaderCircle, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { ApiFormat, CustomApi, TemplateConfig } from "@/lib/types";
import { fetchModelList, parseImportFile } from "@/lib/customApis";
import type { CustomApiMap } from "@/lib/customApis";
import { API_PRESETS, type ApiPreset } from "@/lib/apiPresets";
import SearchableSelect from "./SearchableSelect";
import { useToast } from "./ToastProvider";

interface ApiManagerModalProps {
  open: boolean;
  onClose: () => void;
  customApis: CustomApiMap;
  onSaveApi: (api: CustomApi) => void;
  onCopyApi: (id: string) => void;
  onDeleteApis: (ids: string[]) => void;
  onImportApis: (apis: CustomApi[]) => void;
  onExportApis: () => void;
}

interface FormState {
  name: string;
  format: ApiFormat;
  endpoint: string;
  apiKey: string;
  modelEndpoint: string;
  manualSpeakers: string;
  maxLength: string;
  enableSegmentation: boolean;
  model: string;
  extraParams: string;
  // 通用模板字段
  templateMethod: "POST" | "GET";
  templateHeaders: string;
  templateQuery: string;
  templateBody: string;
  templateBodyType: "json" | "raw";
  templateResponseType: "audio" | "json";
  templateResponsePath: string;
  templateResponseEncoding: "base64" | "hex" | "url";
}

const EMPTY_FORM: FormState = {
  name: "",
  format: "openai",
  endpoint: "",
  apiKey: "",
  modelEndpoint: "",
  manualSpeakers: "",
  maxLength: "",
  enableSegmentation: true,
  model: "",
  extraParams: "",
  templateMethod: "POST",
  templateHeaders: "",
  templateQuery: "",
  templateBody: "",
  templateBodyType: "json",
  templateResponseType: "audio",
  templateResponsePath: "",
  templateResponseEncoding: "base64",
};

const FORMAT_LABELS: Record<ApiFormat, string> = {
  openai: "OpenAI 格式",
  edge: "Edge API 格式",
  template: "自定义请求模板",
};

/** 校验并规范化「额外请求参数」JSON 对象 */
function parseJsonObject(text: string, label: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return JSON.stringify(parsed);
}

/** 预设 → 表单 */
function presetToForm(preset: ApiPreset): FormState {
  const api = preset.api;
  const t: TemplateConfig = api.template ?? {};
  return {
    ...EMPTY_FORM,
    name: api.name,
    format: api.format,
    endpoint: api.endpoint,
    modelEndpoint: api.modelEndpoint ?? "",
    manualSpeakers: (api.manual ?? []).join(","),
    maxLength: api.maxLength ? String(api.maxLength) : "",
    enableSegmentation: api.enableSegmentation !== false,
    model: api.model ?? "",
    extraParams: api.extraParams ?? "",
    templateMethod: t.method ?? "POST",
    templateHeaders: t.headers ?? "",
    templateQuery: t.query ?? "",
    templateBody: t.body ?? "",
    templateBodyType: t.bodyType ?? "json",
    templateResponseType: t.responseType ?? "audio",
    templateResponsePath: t.responsePath ?? "",
    templateResponseEncoding: t.responseEncoding ?? "base64",
  };
}

export default function ApiManagerModal({
  open,
  onClose,
  customApis,
  onSaveApi,
  onCopyApi,
  onDeleteApis,
  onImportApis,
  onExportApis,
}: ApiManagerModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  // 每次打开时重置表单与选择状态
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setEditingId(null);
      setBatchMode(false);
      setSelectedIds([]);
      setSelectAll(false);
    }
  }, [open]);

  if (!open) return null;

  const isOpenAi = form.format === "openai";
  const isTemplate = form.format === "template";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(presetId: string) {
    const preset = API_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setEditingId(null);
    setForm(presetToForm(preset));
    show(`已载入预设：${preset.name}`, "success");
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.endpoint.trim()) {
      show("请填写API名称和端点URL", "warning");
      return;
    }
    let extraParams: string | undefined;
    try {
      extraParams = parseJsonObject(form.extraParams, "额外请求参数");
      if (form.format === "template" && form.templateBodyType === "json" && form.templateBody.trim()) {
        JSON.parse(form.templateBody);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "JSON 解析失败", "danger");
      return;
    }

    const manual = form.manualSpeakers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const api: CustomApi = {
      id: editingId || `custom-${Date.now()}`,
      name: form.name.trim(),
      format: form.format,
      endpoint: form.endpoint.trim(),
      apiKey: form.apiKey.trim() || undefined,
      modelEndpoint: form.modelEndpoint.trim() || undefined,
      manual: manual.length ? manual : undefined,
      maxLength: Number(form.maxLength) > 0 ? Math.floor(Number(form.maxLength)) : null,
      enableSegmentation: form.enableSegmentation,
      model: form.model.trim() || undefined,
      extraParams,
    };
    if (form.format === "template") {
      api.template = {
        method: form.templateMethod,
        headers: form.templateHeaders.trim() || undefined,
        query: form.templateQuery.trim() || undefined,
        body: form.templateBody.trim() || undefined,
        bodyType: form.templateBodyType,
        responseType: form.templateResponseType,
        responsePath: form.templateResponseType === "json" ? form.templateResponsePath.trim() : undefined,
        responseEncoding:
          form.templateResponseType === "json" ? form.templateResponseEncoding : undefined,
      };
    }
    onSaveApi(api);
    show(editingId ? `已更新API: ${api.name}` : `已保存API: ${api.name}`, "success");
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function editApi(api: CustomApi) {
    const t = api.template ?? {};
    setEditingId(api.id);
    setForm({
      name: api.name,
      format: api.format,
      endpoint: api.endpoint,
      apiKey: api.apiKey || "",
      modelEndpoint: api.modelEndpoint || "",
      manualSpeakers: (api.manual || []).join(","),
      maxLength: api.maxLength ? String(api.maxLength) : "",
      enableSegmentation: api.enableSegmentation !== false,
      model: api.model || "",
      extraParams: api.extraParams || "",
      templateMethod: t.method ?? "POST",
      templateHeaders: t.headers ?? "",
      templateQuery: t.query ?? "",
      templateBody: t.body ?? "",
      templateBodyType: t.bodyType ?? "json",
      templateResponseType: t.responseType ?? "audio",
      templateResponsePath: t.responsePath ?? "",
      templateResponseEncoding: t.responseEncoding ?? "base64",
    });
  }

  async function handleFetchModels() {
    if (!form.modelEndpoint.trim()) {
      show("请先填写模型列表端点", "warning");
      return;
    }
    setFetchingModels(true);
    try {
      const models = await fetchModelList({
        modelEndpoint: form.modelEndpoint.trim(),
        apiKey: form.apiKey.trim() || undefined,
        format: form.format,
      });
      if (models.length === 0) {
        show("未获取到模型", "warning");
      } else {
        update("manualSpeakers", models.join(","));
        show(`已获取 ${models.length} 个模型`, "success");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "获取模型失败", "danger");
    } finally {
      setFetchingModels(false);
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImportApis(parseImportFile(reader.result as string));
      } catch (err) {
        show(err instanceof Error ? err.message : "导入失败", "danger");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const apiEntries = Object.values(customApis);

  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto bg-black/50 py-10">
      <div
        className="mx-4 w-full max-w-2xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h5 className="text-lg font-medium text-slate-800">管理自定义API</h5>
          <button type="button" onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-700">
            您可以添加自定义的TTS API。支持三种格式：OpenAI格式、Edge API格式，以及可对接任意服务的
            <span className="font-medium">自定义请求模板</span>。
          </div>

          <div className="mb-4 rounded-lg border border-primary/15 bg-white px-4 py-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Sparkles size={14} className="text-primary" />
              从常见服务预设快速添加
            </label>
            <SearchableSelect
              options={API_PRESETS.map((p) => ({ value: p.id, label: p.name, sub: p.description }))}
              value=""
              onChange={applyPreset}
              searchPlaceholder="搜索服务（OpenAI / ElevenLabs / 火山引擎...）"
              unit="个预设"
              placeholder="选择预设后自动填充下方表单"
            />
            <p className="mt-1 text-xs text-slate-muted">
              预设只是预填模板，载入后请补全 API 密钥、区域等参数再保存。
            </p>
          </div>

          <form onSubmit={submitForm} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                API名称 <span className="font-normal text-slate-faint">(显示在下拉菜单中)</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="例如: 我的自定义API"
                required
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">API格式</label>
              <SearchableSelect
                options={[
                  { value: "openai", label: "OpenAI 格式", sub: "标准 /v1/audio/speech 请求体" },
                  { value: "edge", label: "Edge API 格式", sub: "内置 /api/tts 的请求契约" },
                  { value: "template", label: "自定义请求模板", sub: "自定义 method / headers / body / 响应解析" },
                ]}
                value={form.format}
                onChange={(v) => update("format", v as ApiFormat)}
                searchPlaceholder="搜索格式..."
                unit="种格式"
              />
              <p className="mt-1 text-xs text-slate-muted">
                选择您的API所使用的格式，这将影响请求的参数格式
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">API端点URL</label>
              <input
                type="url"
                value={form.endpoint}
                onChange={(e) => update("endpoint", e.target.value)}
                placeholder={
                  isOpenAi
                    ? "https://api.openai.com/v1/audio/speech"
                    : isTemplate
                      ? "https://api.example.com/tts/{{voice}}"
                      : "https://your-api.example.com/tts"
                }
                required
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
              {isTemplate && (
                <p className="mt-1 text-xs text-slate-muted">
                  端点支持占位符：{"{{voice}} {{model}} {{apiKey}} {{text}} {{format}}"}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                API密钥 <span className="font-normal text-slate-faint">(可选)</span>
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => update("apiKey", e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
              <p className="mt-1 text-xs text-slate-muted">
                OpenAI / 模板格式默认使用 Bearer Token（模板中可用 {"{{apiKey}}"} 自定义到请求头）；Edge API
                格式还可使用&quot;x-api-key: 值&quot;
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                模型列表端点 <span className="font-normal text-slate-faint">(用于获取可用的模型/讲述人)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={form.modelEndpoint}
                  onChange={(e) => update("modelEndpoint", e.target.value)}
                  placeholder={isOpenAi ? "https://api.openai.com/v1/models" : "https://api.example.com/v1/models"}
                  className="min-w-0 flex-1 rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                />
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  className="flex shrink-0 items-center gap-1 rounded-[10px] border border-primary/20 bg-white px-3 py-2 text-sm text-slate-600 transition-all hover:bg-primary-soft disabled:opacity-60"
                >
                  {fetchingModels && <LoaderCircle size={13} className="animate-spin" />}
                  获取模型
                </button>
              </div>
            </div>

            {(isOpenAi || isTemplate) && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  模型名 model <span className="font-normal text-slate-faint">(可选)</span>
                </label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => update("model", e.target.value)}
                  placeholder={isOpenAi ? "如 tts-1 / gpt-4o-mini-tts" : "如 eleven_multilingual_v2"}
                  className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                />
                <p className="mt-1 text-xs text-slate-muted">
                  OpenAI 格式：填写后 model 用此值、所选讲述人作为 voice；留空则兼容旧行为（讲述人当模型）。
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                额外请求参数 <span className="font-normal text-slate-faint">(JSON 对象，可选)</span>
              </label>
              <textarea
                value={form.extraParams}
                onChange={(e) => update("extraParams", e.target.value)}
                rows={2}
                placeholder={'{"speed":1.0,"language_boost":"auto"}'}
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 font-mono text-xs outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
              <p className="mt-1 text-xs text-slate-muted">
                会合并进请求体（覆盖同名参数），用于 speed / sample_rate / language_boost 等扩展字段。
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                自定义讲述人列表 <span className="font-normal text-slate-faint">(逗号分隔)</span>
              </label>
              <textarea
                value={form.manualSpeakers}
                onChange={(e) => update("manualSpeakers", e.target.value)}
                rows={2}
                placeholder="voice1,voice2,voice3"
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
              <p className="mt-1 text-xs text-slate-muted">
                如果无法自动获取模型，您可以手动输入讲述人列表
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">最大请求长度</label>
              <input
                type="number"
                value={form.maxLength}
                onChange={(e) => update("maxLength", e.target.value)}
                placeholder="例如: 5000"
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
              />
              <p className="mt-1 text-xs text-slate-muted">
                此 API 文本最大字符数限制，留空表示使用默认限制
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">长文本处理</label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.enableSegmentation}
                  onChange={(e) => update("enableSegmentation", e.target.checked)}
                  className="h-4 w-4 accent-[#4a90e2]"
                />
                启用自动分段（超出长度限制时将文本分段处理）
              </label>
              <p className="mt-1 text-xs text-slate-muted">关闭后，超长文本将被截断而不是分段</p>
            </div>

            {isTemplate && (
              <div className="space-y-4 rounded-lg border border-primary/15 bg-slate-50/60 p-4">
                <div className="text-sm font-medium text-slate-700">请求模板配置</div>
                <p className="-mt-2 text-xs text-slate-muted">
                  可用占位符：{"{{text}} {{textXml}} {{voice}} {{model}} {{rate}} {{pitch}} {{format}} {{instructions}} {{apiKey}} {{preview}}"}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">请求方法</label>
                    <SearchableSelect
                      options={[
                        { value: "POST", label: "POST" },
                        { value: "GET", label: "GET" },
                      ]}
                      value={form.templateMethod}
                      onChange={(v) => update("templateMethod", v as "POST" | "GET")}
                      searchPlaceholder="搜索方法..."
                      unit="种方法"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">响应类型</label>
                    <SearchableSelect
                      options={[
                        { value: "audio", label: "音频直出" },
                        { value: "json", label: "JSON 内取字段" },
                      ]}
                      value={form.templateResponseType}
                      onChange={(v) => update("templateResponseType", v as "audio" | "json")}
                      searchPlaceholder="搜索响应类型..."
                      unit="种类型"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    请求头 <span className="text-slate-faint">(每行 Key: Value)</span>
                  </label>
                  <textarea
                    value={form.templateHeaders}
                    onChange={(e) => update("templateHeaders", e.target.value)}
                    rows={3}
                    placeholder={"xi-api-key: {{apiKey}}\nContent-Type: application/json"}
                    className="w-full rounded-[10px] border border-primary/15 px-3 py-2 font-mono text-xs outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                  />
                </div>

                {form.templateMethod === "GET" ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      查询串 <span className="text-slate-faint">(占位符会自动 URL 编码)</span>
                    </label>
                    <textarea
                      value={form.templateQuery}
                      onChange={(e) => update("templateQuery", e.target.value)}
                      rows={2}
                      placeholder="text={{text}}&voice={{voice}}"
                      className="w-full rounded-[10px] border border-primary/15 px-3 py-2 font-mono text-xs outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">请求体类型</label>
                        <SearchableSelect
                          options={[
                            { value: "json", label: "JSON" },
                            { value: "raw", label: "原样（SSML/XML 等）" },
                          ]}
                          value={form.templateBodyType}
                          onChange={(v) => update("templateBodyType", v as "json" | "raw")}
                          searchPlaceholder="搜索类型..."
                          unit="种类型"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">请求体模板</label>
                      <textarea
                        value={form.templateBody}
                        onChange={(e) => update("templateBody", e.target.value)}
                        rows={4}
                        placeholder={'{"text":"{{text}}","voice":"{{voice}}"}'}
                        className="w-full rounded-[10px] border border-primary/15 px-3 py-2 font-mono text-xs outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                      />
                    </div>
                  </>
                )}

                {form.templateResponseType === "json" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        音频字段路径
                      </label>
                      <input
                        type="text"
                        value={form.templateResponsePath}
                        onChange={(e) => update("templateResponsePath", e.target.value)}
                        placeholder="data.audio"
                        className="w-full rounded-[10px] border border-primary/15 px-3 py-2 font-mono text-xs outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">字段编码</label>
                      <SearchableSelect
                        options={[
                          { value: "base64", label: "Base64" },
                          { value: "hex", label: "Hex" },
                          { value: "url", label: "音频地址 URL" },
                        ]}
                        value={form.templateResponseEncoding}
                        onChange={(v) =>
                          update("templateResponseEncoding", v as "base64" | "hex" | "url")
                        }
                        searchPlaceholder="搜索编码..."
                        unit="种编码"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              className="rounded-[10px] bg-primary px-5 py-2 text-sm font-medium text-white transition-all hover:bg-primary-dark active:scale-[0.98]"
            >
              {editingId ? "更新API" : "保存API"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
                className="ml-2 rounded-[10px] border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-all hover:bg-slate-50"
              >
                取消编辑
              </button>
            )}
          </form>

          <hr className="my-6 border-slate-100" />

          <div className="mb-3 flex items-center justify-between">
            <h6 className="m-0 text-sm font-medium text-slate-700">已保存的自定义API</h6>
            <div className="flex gap-1.5">
              <button
                type="button"
                title="导出所有自定义API配置"
                onClick={onExportApis}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-all hover:bg-slate-50"
              >
                <FileDown size={13} /> 导出
              </button>
              <button
                type="button"
                title="导入自定义API配置"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-all hover:bg-slate-50"
              >
                <FileUp size={13} /> 导入
              </button>
              {batchMode && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedIds.length === 0) {
                      show("请先选择要删除的API", "warning");
                      return;
                    }
                    if (confirm(`确定要删除选中的 ${selectedIds.length} 个API吗？`)) {
                      onDeleteApis(selectedIds);
                      setBatchMode(false);
                      setSelectedIds([]);
                      setSelectAll(false);
                    }
                  }}
                  className="flex items-center gap-1 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs text-white transition-all hover:bg-red-600"
                >
                  <Trash2 size={13} /> 删除选中
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (apiEntries.length === 0) {
                    show("没有可管理的自定义API", "info");
                    return;
                  }
                  setBatchMode((m) => !m);
                  setSelectedIds([]);
                  setSelectAll(false);
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-all hover:bg-slate-50"
              >
                {batchMode ? "取消" : "批量管理"}
              </button>
            </div>
          </div>

          {batchMode && apiEntries.length > 0 && (
            <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={(e) => {
                    setSelectAll(e.target.checked);
                    setSelectedIds(e.target.checked ? apiEntries.map((a) => a.id) : []);
                  }}
                  className="h-4 w-4 accent-[#4a90e2]"
                />
                全选
              </label>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />

          <div className="mt-3 space-y-2">
            {apiEntries.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-faint">暂无自定义API</div>
            ) : (
              apiEntries.map((api) => (
                <div
                  key={api.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 border-l-[3px] border-l-transparent px-4 py-3 transition-all hover:border-l-primary hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {batchMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(api.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, api.id] : prev.filter((id) => id !== api.id)
                          );
                        }}
                        className="h-4 w-4 shrink-0 accent-[#4a90e2]"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{api.name}</div>
                      <div className="truncate text-xs text-slate-muted">
                        {api.endpoint} · {FORMAT_LABELS[api.format] ?? api.format}
                        {api.manual?.length ? ` · ${api.manual.length} 个讲述人` : ""}
                      </div>
                    </div>
                  </div>
                  {!batchMode && (
                    <div className="ml-3 flex shrink-0 gap-1">
                      <button
                        type="button"
                        title="编辑"
                        onClick={() => editApi(api)}
                        className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-primary-soft hover:text-primary"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title="复制"
                        onClick={() => onCopyApi(api.id)}
                        className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-primary-soft hover:text-primary"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={() => {
                          if (confirm(`确定要删除自定义API「${api.name}」吗？`)) {
                            onDeleteApis([api.id]);
                          }
                        }}
                        className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-all hover:bg-slate-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
