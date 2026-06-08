import { describe, expect, it } from "vitest";
import { ApiError, apiErrorMessage } from "./context";

describe("apiErrorMessage", () => {
  it("keeps explicit ApiError messages", () => {
    expect(apiErrorMessage(new ApiError("Forbidden", 403))).toBe("Forbidden");
  });

  it("extracts Supabase object error messages", () => {
    expect(apiErrorMessage({ message: "relation goal_maps does not exist", code: "42P01" })).toBe("relation goal_maps does not exist");
  });

  it("falls back to detail, hint, code, then the generic message", () => {
    expect(apiErrorMessage({ details: "Duplicate key", hint: "Use another name" })).toBe("Duplicate key");
    expect(apiErrorMessage({ hint: "Use another name" })).toBe("Use another name");
    expect(apiErrorMessage({ code: "23505" })).toBe("23505");
    expect(apiErrorMessage({})).toBe("Request failed");
  });
});
