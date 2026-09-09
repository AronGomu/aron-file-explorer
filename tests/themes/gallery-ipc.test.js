import { act } from "react";
import { afterAll, beforeAll, expect, test } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";

let container;
beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  await act(async () => { await import("./gallery/main.jsx"); });
});
afterAll(() => {
  clearMocks();
  container.remove();
});

test.each(["unknown", "get_settings", "plugin:fs|read_file"])(
  "gallery rejects %s through actual Tauri invoke, never host IPC",
  async command => {
    await expect(invoke(command, { path: "/fixture-only" })).rejects.toThrow(
      `Unknown theme gallery IPC command: ${command}`,
    );
  },
);
