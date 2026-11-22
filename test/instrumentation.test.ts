import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogWarningsFunction } from "ai";
import { register } from "@/instrumentation";

const logger = () =>
  (globalThis as { AI_SDK_LOG_WARNINGS?: LogWarningsFunction }).AI_SDK_LOG_WARNINGS!;

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS;
});

describe("AI SDK warning logger", () => {
  it("drops only the known benign reasoning-part note", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    register();
    logger()({
      provider: "gateway",
      model: "openai/gpt-5-mini",
      warnings: [
        {
          type: "other",
          message: "Non-OpenAI reasoning parts are not supported. Skipping reasoning part.",
        },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("still logs every other warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    register();
    logger()({
      provider: "gateway",
      model: "openai/gpt-5-mini",
      warnings: [{ type: "unsupported", feature: "temperature" }],
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("temperature");
  });
});
