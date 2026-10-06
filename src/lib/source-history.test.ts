import { expect, it } from "vitest";
import { createSourceHistory, recordSourceEdit, travelSourceHistory } from "./source-history";

it("invalidates redo on a new edit and ignores controlled-value echoes", () => {
  const history = createSourceHistory("a");
  recordSourceEdit(history, "ab", 2);
  recordSourceEdit(history, "abc", 3);
  expect(travelSourceHistory(history, false)?.text).toBe("ab");
  recordSourceEdit(history, "ab");
  expect(history.future).toHaveLength(1);
  recordSourceEdit(history, "abd", 3);
  expect(travelSourceHistory(history, true)).toBeUndefined();
  expect(travelSourceHistory(history, false)?.text).toBe("ab");
});

it("bounds retained source snapshots while keeping the most recent undo", () => {
  const history = createSourceHistory("a");
  for (let i = 0; i < 150; i++) recordSourceEdit(history, String(i));
  expect(history.past).toHaveLength(100);
  const large = "a".repeat(2_000_001);
  recordSourceEdit(history, large);
  recordSourceEdit(history, "small");
  expect(history.past).toHaveLength(1);
  expect(travelSourceHistory(history, false)?.text).toBe(large);
});
