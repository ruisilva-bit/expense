import test from "node:test";
import assert from "node:assert/strict";

import { fetchAllPages } from "./fetch-all-pages";

test("fetchAllPages collects every page until the first short page", async () => {
  const calls: number[] = [];
  const items = await fetchAllPages(async (page) => {
    calls.push(page);
    const pages: Record<number, number[]> = {
      1: [1, 2],
      2: [3, 4],
      3: [5],
    };
    return { items: pages[page] ?? [], pageSize: 2 };
  });

  assert.deepEqual(items, [1, 2, 3, 4, 5]);
  assert.deepEqual(calls, [1, 2, 3]);
});

test("fetchAllPages requests the empty page after an exact multiple", async () => {
  const calls: number[] = [];
  const items = await fetchAllPages(async (page) => {
    calls.push(page);
    const pages: Record<number, string[]> = {
      1: ["a", "b"],
      2: ["c", "d"],
    };
    return { items: pages[page] ?? [], pageSize: 2 };
  });

  assert.deepEqual(items, ["a", "b", "c", "d"]);
  assert.deepEqual(calls, [1, 2, 3]);
});

test("fetchAllPages rejects invalid pagination metadata", async () => {
  await assert.rejects(
    () => fetchAllPages(async () => ({ items: [], pageSize: 0 })),
    /invalid page size/
  );
});
