import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";

import ProcessLog from "./Log.vue";
import labels from "@/locales/zh";
import { useProcessLog } from "@/composables/useProcessLog";

vi.mock("@/composables/useProcessLog", () => ({
  useProcessLog: vi.fn(),
}));

const logText = "INFO 第一行\nERROR <tag> & detail\nINFO 最后一行";

let selection;
let previousRange;
let selectedRanges;
let copiedText;

beforeEach(() => {
  previousRange = { text: "原有选区" };
  selectedRanges = [{ ...previousRange, cloneRange: () => previousRange }];
  copiedText = "";
  selection = {
    get rangeCount() {
      return selectedRanges.length;
    },
    getRangeAt: (index) => selectedRanges[index],
    removeAllRanges: () => {
      selectedRanges = [];
    },
    addRange: (range) => selectedRanges.push(range),
  };
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { getSelection: () => selection });
  vi.stubGlobal("document", {
    createRange: () => ({
      selectNodeContents(element) {
        this.element = element;
      },
    }),
    execCommand: vi.fn(() => {
      copiedText = selectedRanges[0].element.textContent;
      return true;
    }),
  });
  vi.mocked(useProcessLog).mockReturnValue({
    text: ref(logText),
    remoteSize: ref(0),
    localSize: ref(0),
    error: ref(""),
    autoScroll: ref(false),
    clearDisplay: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function createLog() {
  const vnode = h(ProcessLog, {
    active: true,
    labels,
    uid: "node:group:worker",
  });
  const app = createSSRApp({ render: () => vnode });
  app.use(createVuetify());
  await renderToString(app);

  const output = { textContent: logText };
  const pane = {
    textContent: `复制失败提示\n${logText}`,
    querySelector: (selector) => (selector === "pre" ? output : null),
  };
  vnode.component.refs.logPaneElement = pane;
  return { state: vnode.component.setupState, output, pane };
}

describe("日志文本复制", () => {
  test("现代剪贴板 API 可用时复制输出区文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(writeText).toHaveBeenCalledWith(logText);
    expect(state.copyState).toBe("success");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("HTTP 环境没有剪贴板 API 时复制现有日志元素，并恢复原选区", async () => {
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe(logText);
    expect(state.copyState).toBe("success");
    expect(selectedRanges.map((range) => range.text)).toEqual(["原有选区"]);
  });

  test("只复制筛选后的日志，不包含复制提示", async () => {
    const { state, output } = await createLog();
    state.logSearch = "ERROR";
    output.textContent = state.visibleLogLines.join("\n");

    await state.copyVisibleLog();

    expect(copiedText).toBe("ERROR <tag> & detail");
    expect(state.copyState).toBe("success");
  });

  test("原来没有选区时，复制后清除临时选区", async () => {
    selectedRanges = [];
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(copiedText).toBe(logText);
    expect(selectedRanges).toEqual([]);
  });

  test("复制指令返回失败时保留失败反馈，并恢复原选区", async () => {
    document.execCommand.mockReturnValue(false);
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(state.copyState).toBe("failed");
    expect(copiedText).toBe("");
    expect(selectedRanges.map((range) => range.text)).toEqual(["原有选区"]);
  });

  test("复制指令抛出异常时保留失败反馈，并恢复原选区", async () => {
    document.execCommand.mockImplementation(() => {
      throw new Error("copy denied");
    });
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(state.copyState).toBe("failed");
    expect(selectedRanges.map((range) => range.text)).toEqual(["原有选区"]);
  });

  test("现代剪贴板拒绝写入时保留失败反馈", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(state.copyState).toBe("failed");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("日志元素不存在时不执行复制", async () => {
    const { state, pane } = await createLog();
    pane.querySelector = () => null;

    await state.copyVisibleLog();

    expect(state.copyState).toBe("failed");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("浏览器未提供文本选区时不执行复制", async () => {
    window.getSelection = () => null;
    const { state } = await createLog();

    await state.copyVisibleLog();

    expect(state.copyState).toBe("failed");
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});
