import { expect, it } from "vitest";
import { createEditHistory, recordSourceEdit, travelEditHistory } from "./edit-history";

it("invalidates redo on a new edit and ignores controlled-value echoes", () => {
  const history = createEditHistory("a");
  recordSourceEdit(history, "ab", 2);
  recordSourceEdit(history, "abc", 3);
  expect(travelEditHistory(history, false)?.text).toBe("ab");
  recordSourceEdit(history, "ab");
  expect(history.future).toHaveLength(1);
  recordSourceEdit(history, "abd", 3);
  expect(travelEditHistory(history, true)).toBeUndefined();
  expect(travelEditHistory(history, false)?.text).toBe("ab");
});

it("bounds retained source snapshots while keeping the most recent undo", () => {
  const history = createEditHistory("a");
  for (let i = 0; i < 150; i++) recordSourceEdit(history, String(i));
  expect(history.past).toHaveLength(100);
  const large = "a".repeat(2_000_001);
  recordSourceEdit(history, large);
  recordSourceEdit(history, "small");
  expect(history.past).toHaveLength(1);
  expect(travelEditHistory(history, false)?.text).toBe(large);
});

it("groups adjacent source typing but keeps commands and history travel separate", () => {
  const history = createEditHistory("");
  recordSourceEdit(history, "a", 1, 1, "insertText");
  recordSourceEdit(history, "ab", 2, 2, "insertText");
  recordSourceEdit(history, "abc", 3, 3, "insertText");
  recordSourceEdit(history, "**abc**", 2, 5);
  expect(travelEditHistory(history, false)?.text).toBe("abc");
  expect(travelEditHistory(history, false)?.text).toBe("");
  expect(travelEditHistory(history, true)?.text).toBe("abc");
  recordSourceEdit(history, "abcd", 4, 4, "insertText");
  expect(travelEditHistory(history, false)?.text).toBe("abc");
});
