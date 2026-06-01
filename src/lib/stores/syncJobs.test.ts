import { describe, expect, it } from "vitest";
import { failedJobPatch } from "./syncJobs";

describe("failedJobPatch", () => {
  it("keeps a job pending until the fifth failed attempt", () => {
    expect(failedJobPatch(0, "network").status).toBe("pending");
    expect(failedJobPatch(3, "network").status).toBe("pending");
    expect(failedJobPatch(4, "network")).toMatchObject({
      attempts: 5,
      status: "failed",
      last_error: "network"
    });
  });
});
