"use client";

import { useState } from "react";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { PrettySelect } from "@/components/PrettySelect";
import { useAppState } from "@/context/AppState";
import { resolveCategoryColor } from "@/lib/category-color";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";

type CategoryType = "income" | "expense" | "transfer";
type Category = {
  id: string;
  family_id: string;
  name: string;
  type: CategoryType;
  affects_loan: boolean;
  color?: string | null;
};

export default function CategoriesPage() {
  const { selectedFamily } = useAppState();
  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>("expense");
  const [affectsLoan, setAffectsLoan] = useState(false);
  const [color, setColor] = useState("#0ea5e9");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingType, setEditingType] = useState<CategoryType>("expense");
  const [editingAffectsLoan, setEditingAffectsLoan] = useState(false);
  const [editingColor, setEditingColor] = useState("#0ea5e9");
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const { data, error, mutate, isLoading } = useSWR(
    selectedFamily ? `categories:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<{ categories: Category[]; color_supported?: boolean }>(
        `/api/categories?familyId=${encodeURIComponent(selectedFamily!.id)}`,
        { method: "GET", headers }
      );
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const createCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFamily) return;
    if (!name.trim()) return;

    setErrorMessage(null);
    setIsSaving(true);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ category: Category }>("/api/categories", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          familyId: selectedFamily.id,
          name: name.trim(),
          type,
          affects_loan: affectsLoan,
          color,
        }),
      });

      setName("");
      setType("expense");
      setAffectsLoan(false);
      setColor("#0ea5e9");
      await mutate();
    } catch (createError) {
      setErrorMessage(createError instanceof Error ? createError.message : "Failed to create category.");
    } finally {
      setIsSaving(false);
    }
  };
  const typeOptions = [
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    { value: "transfer", label: "Transfer" },
  ];

  const editCategory = async (
    categoryId: string,
    nextName: string,
    nextType: CategoryType,
    nextAffectsLoan: boolean,
    nextColor: string
  ) => {
    if (!nextName.trim()) return;
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ category: Category }>("/api/categories", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          categoryId,
          name: nextName.trim(),
          type: nextType,
          affects_loan: nextAffectsLoan,
          color: nextColor,
        }),
      });
      await mutate();
    } catch (updateError) {
      setErrorMessage(updateError instanceof Error ? updateError.message : "Failed to update category.");
    }
  };

  const deleteCategory = async (categoryId: string) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/categories", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ categoryId }),
      });
      await mutate();
    } catch (deleteError) {
      setErrorMessage(deleteError instanceof Error ? deleteError.message : "Failed to delete category.");
    }
  };

  const updateCategoryColor = async (category: Category, nextColor: string) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ category: Category }>("/api/categories", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          categoryId: category.id,
          color: nextColor,
        }),
      });
      await mutate();
    } catch (updateError) {
      setErrorMessage(updateError instanceof Error ? updateError.message : "Failed to update category color.");
    }
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6 lg:pl-64">
        <div>
          <p className="text-sm text-slate-500">Categories</p>
          <h1 className="text-2xl font-semibold">{selectedFamily ? "Manage categories" : "Select a family"}</h1>
        </div>

        {(error || errorMessage) && (
          <div className="card p-3 text-sm text-red-700 bg-red-50 border-red-200">
            {error ? `Could not load categories: ${error.message}` : errorMessage}
          </div>
        )}

        {selectedFamily && data?.color_supported === false && (
          <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">
            Category color persistence is not enabled in the database yet. Run{" "}
            <code>supabase/sql/10_categories_color.sql</code> in Supabase SQL Editor, then run{" "}
            <code>{"notify pgrst, 'reload schema';"}</code>.
          </div>
        )}

        {!selectedFamily && <div className="card p-4">Select a family first.</div>}

        {selectedFamily && (
          <>
            <form onSubmit={createCategory} className="card p-4 space-y-3">
              <h2 className="text-lg font-semibold">Create category</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  className="input"
                  placeholder="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
                <PrettySelect
                  value={type}
                  onChange={(value) => setType(value as CategoryType)}
                  options={typeOptions}
                  placeholder="Type"
                />
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={affectsLoan}
                    onChange={(event) => setAffectsLoan(event.target.checked)}
                  />
                  Affects loan
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>Color</span>
                  <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
                </label>
              </div>
              <button className="btn btn-primary w-fit" type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Create"}
              </button>
            </form>

            <section className="card p-4 space-y-3">
              <h2 className="text-lg font-semibold">All categories</h2>
              {isLoading && <p className="text-sm text-slate-500">Loading categories...</p>}
              {!isLoading && !(data?.categories ?? []).length && (
                <p className="text-sm text-slate-500">No categories yet.</p>
              )}
              <ul className="space-y-2">
                {(data?.categories ?? []).map((category) => (
                  <li key={category.id} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                    <div>
                      {(() => {
                        const categoryColor = resolveCategoryColor(category.color, category.name);
                        return (
                          <p className="font-medium flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: categoryColor }}
                            />
                            {category.name}
                          </p>
                        );
                      })()}
                      <p className="text-xs text-slate-500">
                        {category.type}
                        {category.affects_loan ? " · affects loan" : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        title="Category color"
                        value={resolveCategoryColor(category.color, category.name)}
                        onChange={(event) => {
                          void updateCategoryColor(category, event.target.value);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => {
                          setEditingCategory(category);
                          setEditingName(category.name);
                          setEditingType(category.type);
                          setEditingAffectsLoan(Boolean(category.affects_loan));
                          setEditingColor(resolveCategoryColor(category.color, category.name));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs text-red-600"
                        onClick={() => setDeletingCategory(category)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      <AppDialog
        open={Boolean(editingCategory)}
        onClose={() => setEditingCategory(null)}
        title="Edit category"
        subtitle="Category settings"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingCategory) return;
            void (async () => {
              await editCategory(
                editingCategory.id,
                editingName,
                editingType,
                editingAffectsLoan,
                editingColor
              );
              setEditingCategory(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input
              className="input"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Type</span>
            <PrettySelect
              value={editingType}
              onChange={(value) => setEditingType(value as CategoryType)}
              options={typeOptions}
              placeholder="Type"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={editingAffectsLoan}
              onChange={(event) => setEditingAffectsLoan(event.target.checked)}
            />
            Affects loan
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>Color</span>
            <input type="color" value={editingColor} onChange={(event) => setEditingColor(event.target.value)} />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingCategory(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingCategory)}
        title="Delete category"
        description={`Delete "${deletingCategory?.name ?? "this category"}"?`}
        confirmLabel="Delete category"
        destructive
        onClose={() => setDeletingCategory(null)}
        onConfirm={() => {
          if (!deletingCategory) return;
          void (async () => {
            await deleteCategory(deletingCategory.id);
            setDeletingCategory(null);
          })();
        }}
      />
    </div>
  );
}
