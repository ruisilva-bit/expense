export type PaginatedPage<T> = {
  items: T[];
  pageSize: number;
};

const MAX_PAGES = 10_000;

export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PaginatedPage<T>>
): Promise<T[]> {
  const allItems: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchPage(page);
    if (!Number.isInteger(result.pageSize) || result.pageSize < 1) {
      throw new Error("The paginated endpoint returned an invalid page size.");
    }
    if (result.items.length > result.pageSize) {
      throw new Error("The paginated endpoint returned more items than its page size.");
    }

    allItems.push(...result.items);
    if (result.items.length < result.pageSize) return allItems;
  }

  throw new Error(`Pagination exceeded the safety limit of ${MAX_PAGES} pages.`);
}
