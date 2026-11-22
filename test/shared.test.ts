import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { failure, isTransient, settle, toFailure } from "@/lib/agents/shared";

describe("isTransient", () => {
  it("retries network errors, rate limits and server errors", () => {
    expect(isTransient(new ApiRequestError(0, "NETWORK_ERROR", "down"))).toBe(true);
    expect(isTransient(new ApiRequestError(429, undefined, "slow down"))).toBe(true);
    expect(isTransient(new ApiRequestError(503, undefined, "unavailable"))).toBe(true);
  });

  it("does not retry client errors that won't fix themselves", () => {
    expect(isTransient(new ApiRequestError(404, "NOT_FOUND", "missing"))).toBe(false);
    expect(isTransient(new ApiRequestError(422, "VALIDATION_ERROR", "bad"))).toBe(false);
  });

  it("treats unknown errors (timeouts, aborts) as transient", () => {
    expect(isTransient(new Error("socket hang up"))).toBe(true);
  });
});

describe("toFailure", () => {
  it("maps 404 to not_found with the caller's message", () => {
    expect(toFailure(new ApiRequestError(404, "NOT_FOUND", "x"), "No such order.")).toEqual({
      ok: false,
      reason: "not_found",
      message: "No such order.",
    });
  });

  it("passes through validation messages without URLs or the bypass value", () => {
    const error = new ApiRequestError(
      422,
      "VALIDATION_ERROR",
      "Invalid category 'nope' at https://api.example.com/products?x-vercel-protection-bypass=SECRET123",
    );
    const result = toFailure(error, "unused");
    expect(result.reason).toBe("invalid_request");
    expect(result.message).toContain("Invalid category 'nope'");
    expect(result.message).not.toContain("https://");
    expect(result.message).not.toContain("SECRET123");
  });

  it("hides details of unexpected errors", () => {
    expect(toFailure(new Error("db password=hunter2"), "unused")).toEqual({
      ok: false,
      reason: "unavailable",
      message: expect.not.stringContaining("hunter2"),
    });
  });
});

describe("settle", () => {
  it("returns the step result when it succeeds", async () => {
    await expect(settle(async () => ({ ok: true as const, value: 1 }))).resolves.toEqual({
      ok: true,
      value: 1,
    });
  });

  it("returns permanent failures unchanged", async () => {
    const notFound = failure("not_found", "gone");
    await expect(settle(async () => notFound)).resolves.toBe(notFound);
  });

  it("turns an exhausted step into an honest 'unavailable' result", async () => {
    const result = await settle(async () => {
      throw new Error("still failing after retries");
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
