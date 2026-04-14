import { NextRequest, NextResponse } from "next/server";
import { ensureFamilyMember, getCategory, getRequestUser } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CategoryType = "income" | "expense" | "transfer";
type CategoryRecord = {
  id: string;
  family_id: string;
  name: string;
  type: string | null;
  affects_loan: boolean | null;
  color?: string | null;
};
type QueryError = { message: string } | null;
type CategoryQueryResult = { data: CategoryRecord[] | null; error: QueryError };
type CategorySingleResult = { data: CategoryRecord | null; error: QueryError };

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const normalizeType = (value: string | null | undefined): CategoryType => {
  if (value === "income" || value === "transfer") return value;
  return "expense";
};

const normalizeColor = (value: unknown) => {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color) return null;
  return HEX_COLOR_REGEX.test(color) ? color.toLowerCase() : null;
};

const isMissingColorColumnError = (message: string) => {
  const lower = message.toLowerCase();
  const mentionsColorColumn = lower.includes("color") && (lower.includes("column") || lower.includes("schema cache"));
  const missingSignal = lower.includes("does not exist") || lower.includes("could not find");
  return mentionsColorColumn && missingSignal;
};

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("familyId") ?? "";
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  let includeColor = true;
  let rows = (await admin
    .from("categories")
    .select("id,family_id,name,type,affects_loan,color")
    .eq("family_id", familyId)
    .order("name", { ascending: true })) as CategoryQueryResult;

  if (rows.error && isMissingColorColumnError(rows.error.message)) {
    includeColor = false;
    rows = (await admin
      .from("categories")
      .select("id,family_id,name,type,affects_loan")
      .eq("family_id", familyId)
      .order("name", { ascending: true })) as CategoryQueryResult;
  }

  if (rows.error) {
    return NextResponse.json({ error: rows.error.message }, { status: 400 });
  }

  const categories = (rows.data ?? []).map((category) => ({
    id: category.id,
    family_id: category.family_id,
    name: category.name,
    type: normalizeType(category.type as string | null),
    affects_loan: Boolean(category.affects_loan),
    color: includeColor ? normalizeColor((category as { color?: string | null }).color) : null,
  }));

  return NextResponse.json({ categories, color_supported: includeColor });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    name?: string;
    type?: CategoryType;
    affects_loan?: boolean;
    color?: string | null;
  };

  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  const type = normalizeType(payload.type);
  const affectsLoan = Boolean(payload.affects_loan);
  const color = normalizeColor(payload.color);

  if (!familyId || !name) {
    return NextResponse.json({ error: "familyId and name are required." }, { status: 400 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  let insert = (await admin
    .from("categories")
    .insert({
      family_id: familyId,
      name,
      type,
      affects_loan: affectsLoan,
      color,
    })
    .select("id,family_id,name,type,affects_loan,color")
    .single()) as CategorySingleResult;

  if (insert.error && isMissingColorColumnError(insert.error.message)) {
    if (color !== null) {
      return NextResponse.json(
        {
          error:
            "Category color is not available in this database yet. Run migration supabase/sql/10_categories_color.sql.",
        },
        { status: 400 }
      );
    }
    insert = (await admin
      .from("categories")
      .insert({
        family_id: familyId,
        name,
        type,
        affects_loan: affectsLoan,
      })
      .select("id,family_id,name,type,affects_loan")
      .single()) as CategorySingleResult;
  }

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to create category." }, { status: 400 });
  }

  const categoryData = insert.data;

  return NextResponse.json(
    {
      category: {
        id: categoryData.id,
        family_id: categoryData.family_id,
        name: categoryData.name,
        type: normalizeType(categoryData.type),
        affects_loan: Boolean(categoryData.affects_loan),
        color: normalizeColor(categoryData.color),
      },
    },
    { status: 201 }
  );
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    categoryId?: string;
    name?: string;
    type?: CategoryType;
    affects_loan?: boolean;
    color?: string | null;
  };

  const categoryId = (payload.categoryId ?? "").trim();
  const name = payload.name?.trim();
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required." }, { status: 400 });
  }
  if (!name && payload.type === undefined && payload.affects_loan === undefined && payload.color === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const category = await getCategory(categoryId);
  if (category.error || !category.data) {
    return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(category.data.family_id, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const updatePayload: Record<string, unknown> = {};
  if (name) updatePayload.name = name;
  if (payload.type !== undefined) updatePayload.type = normalizeType(payload.type);
  if (payload.affects_loan !== undefined) updatePayload.affects_loan = Boolean(payload.affects_loan);
  if (payload.color !== undefined) updatePayload.color = normalizeColor(payload.color);

  const admin = supabaseAdmin();
  let update = (await admin
    .from("categories")
    .update(updatePayload)
    .eq("id", categoryId)
    .select("id,family_id,name,type,affects_loan,color")
    .single()) as CategorySingleResult;

  if (update.error && isMissingColorColumnError(update.error.message)) {
    if (payload.color !== undefined) {
      return NextResponse.json(
        {
          error:
            "Category color is not available in this database yet. Run migration supabase/sql/10_categories_color.sql.",
        },
        { status: 400 }
      );
    }
    const fallbackPayload: Record<string, unknown> = { ...updatePayload };
    delete fallbackPayload.color;
    if (!Object.keys(fallbackPayload).length) {
      return NextResponse.json(
        {
          category: {
            id: category.data.id,
            family_id: category.data.family_id,
            name: category.data.name,
            type: normalizeType(category.data.type),
            affects_loan: Boolean(category.data.affects_loan),
            color: null,
          },
        }
      );
    }
    update = (await admin
      .from("categories")
      .update(fallbackPayload)
      .eq("id", categoryId)
      .select("id,family_id,name,type,affects_loan")
      .single()) as CategorySingleResult;
  }

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update category." }, { status: 400 });
  }

  const updatedCategory = update.data;

  return NextResponse.json({
    category: {
      id: updatedCategory.id,
      family_id: updatedCategory.family_id,
      name: updatedCategory.name,
      type: normalizeType(updatedCategory.type),
      affects_loan: Boolean(updatedCategory.affects_loan),
      color: normalizeColor(updatedCategory.color),
    },
  });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { categoryId?: string };
  const categoryId = (payload.categoryId ?? "").trim();
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required." }, { status: 400 });
  }

  const category = await getCategory(categoryId);
  if (category.error || !category.data) {
    return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(category.data.family_id, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const del = await admin.from("categories").delete().eq("id", categoryId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
