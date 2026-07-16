import { describe, it, expect } from "vitest";
import { exportAsHtml, exportAsPdf, isPathAuthorizationError } from "./file-system";

describe("file-system utilities", () => {
  it("exportAsHtml is a function", () => {
    expect(typeof exportAsHtml).toBe("function");
  });

  it("exportAsPdf is a function", () => {
    expect(typeof exportAsPdf).toBe("function");
  });

  it("identifies only the stable native authorization failure", () => {
    expect(isPathAuthorizationError(new Error("MARKD_PATH_NOT_AUTHORIZED: choose the file again."))).toBe(true);
    expect(isPathAuthorizationError(new Error("Unable to read this file."))).toBe(false);
    expect(isPathAuthorizationError("MARKD_PATH_NOT_AUTHORIZED: choose the file again.")).toBe(true);
  });
});
