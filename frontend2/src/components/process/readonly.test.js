import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia } from "pinia";
import { createVuetify } from "vuetify";

import ProcessTable from "./Table.vue";
import ProcessTile from "../common/Tile.vue";
import labels from "@/locales/zh";
import { useAppStore } from "@/stores/app";

const disabledAttribute = /\sdisabled(?:\s|=|>)/;

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderProcess(component, name) {
  const process = {
    uid: `node:rpc:${name}`,
    name,
    supervisor: "node",
    statename: "RUNNING",
    running: true,
    logfile: "/tmp/stdout.log",
    stderr_logfile: "/tmp/stderr.log",
  };
  const supervisor = {
    name: "node",
    running: true,
    processes: { [process.uid]: process },
  };
  const pinia = createPinia();
  const props =
    component === ProcessTable
      ? {
          processes: [process],
          supervisors: [supervisor],
          selectedUids: [],
          labels,
          connected: true,
          dataReady: true,
        }
      : { process };
  const app = createSSRApp(component, props);
  app.use(pinia).use(createVuetify());
  const store = useAppStore(pinia);
  store.updateMultivisor({
    name: "cluster",
    supervisors: { node: supervisor },
  });
  store.connected = true;
  store.dataStatus = "ready";
  return renderToString(app);
}

function findTag(html, tagName, marker) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) || [];
  const tag = tags.find((candidate) => candidate.includes(marker));
  expect(tag).toBeDefined();
  return tag;
}

describe.each([
  ["进程卡片", ProcessTable],
  ["旧页面进程条目", ProcessTile],
])("%s 的只读服务", (name, component) => {
  test("multivisor-rpc 禁止勾选和启停，更多查看入口仍可用", async () => {
    const html = await renderProcess(component, "multivisor-rpc");
    const actionSuffix = component === ProcessTable ? " multivisor-rpc" : "";

    expect(html).toContain("is-protected");
    expect(findTag(html, "input", 'type="checkbox"')).toMatch(
      disabledAttribute,
    );
    expect(
      findTag(html, "button", `aria-label="${labels.restart}${actionSuffix}"`),
    ).toMatch(disabledAttribute);
    expect(
      findTag(html, "button", `aria-label="${labels.stop}${actionSuffix}"`),
    ).toMatch(disabledAttribute);
    expect(
      findTag(
        html,
        "button",
        `aria-label="${labels.moreActions}${actionSuffix}"`,
      ),
    ).not.toMatch(disabledAttribute);

    if (component === ProcessTable) {
      expect(findTag(html, "button", "proc-card-name")).not.toMatch(
        disabledAttribute,
      );
      expect(
        findTag(html, "button", `aria-label="${labels.logs} multivisor-rpc"`),
      ).not.toMatch(disabledAttribute);
    }
  });

  test("普通同前缀进程仍可勾选和启停", async () => {
    const processName = "multivisor-rpc-worker";
    const html = await renderProcess(component, processName);
    const actionSuffix = component === ProcessTable ? ` ${processName}` : "";

    expect(html).not.toContain("is-protected");
    expect(findTag(html, "input", 'type="checkbox"')).not.toMatch(
      disabledAttribute,
    );
    expect(
      findTag(html, "button", `aria-label="${labels.restart}${actionSuffix}"`),
    ).not.toMatch(disabledAttribute);
    expect(
      findTag(html, "button", `aria-label="${labels.stop}${actionSuffix}"`),
    ).not.toMatch(disabledAttribute);
  });
});
