import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderCase } from "./gallery/cases.jsx";

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("theme gallery harness", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("renders actual production Button for harness case", async () => {
    await act(async () => {
      root.render(
        <main data-theme-case="harness-button">
          {renderCase("harness-button")}
        </main>,
      );
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button.textContent).toBe("Harness button");
    expect(button.classList.contains("btn")).toBe(true);
    expect(button.classList.contains("btn-primary")).toBe(true);
  });

  test("unknown gallery case fails loudly", () => {
    expect(() => renderCase("unknown")).toThrow(
      "Unknown theme gallery case: unknown",
    );
  });
});
