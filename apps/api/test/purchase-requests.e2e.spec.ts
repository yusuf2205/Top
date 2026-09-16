import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.1 Phase D — create, idempotency, header PATCH, and item CRUD for
 * Purchase Request, all over real HTTP against real Postgres. Read/list/
 * visibility scenarios live in purchase-requests-read.e2e.spec.ts.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pr");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Admin", email, password });
  return {
    email,
    accessToken: res.body.accessToken as string,
    userId: res.body.user.id as string,
    organizationId: res.body.user.organizationId as string,
  };
}

async function inviteAndLogin(app: INestApplication, admin: OrgContext, role: string): Promise<OrgContext> {
  const email = uniqueEmail(role.toLowerCase());
  const password = "correct-horse-battery-staple";
  const invite = await request(app.getHttpServer())
    .post("/api/v1/members/invitations")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ email, role });
  await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invite.body.rawToken as string}/accept`)
    .send({ fullName: "Test User", password });
  const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
  return {
    email,
    accessToken: login.body.accessToken as string,
    userId: login.body.user.id as string,
    organizationId: admin.organizationId,
  };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

async function createProduct(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; sku: string; name: string }> {
  const sku = `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ sku, name: "PR Test Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "QUANTITY", ...overrides });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string, sku: res.body.sku as string, name: res.body.name as string };
}

function postPR(app: INestApplication, token: string, body: Record<string, unknown>) {
  return authed(app, token).post("/api/v1/purchase-requests").send(body);
}

async function postPROk(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await postPR(app, token, body);
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string; items: Array<Record<string, unknown>> };
}

function getPR(app: INestApplication, token: string, id: string) {
  return authed(app, token).get(`/api/v1/purchase-requests/${id}`);
}

function patchPR(app: INestApplication, token: string, id: string, body: Record<string, unknown>) {
  return authed(app, token).patch(`/api/v1/purchase-requests/${id}`).send(body);
}

function addItem(app: INestApplication, token: string, id: string, body: Record<string, unknown>) {
  return authed(app, token).post(`/api/v1/purchase-requests/${id}/items`).send(body);
}

function updateItem(app: INestApplication, token: string, id: string, itemId: string, body: Record<string, unknown>) {
  return authed(app, token).patch(`/api/v1/purchase-requests/${id}/items/${itemId}`).send(body);
}

function removeItem(app: INestApplication, token: string, id: string, itemId: string) {
  return authed(app, token).delete(`/api/v1/purchase-requests/${id}/items/${itemId}`);
}

const freeTextItem = { itemName: "Copper busbar 20x3", quantity: "500.000", uomCode: "KG" };

describe("M3.1 Phase D — Purchase Request create / idempotency / header / items", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedDepartment(organizationId: string): Promise<string> {
    const dept = await db.department.create({ data: { organizationId, name: `Production-${Date.now()}-${Math.random()}` } });
    return dept.id;
  }
  async function seedCategory(organizationId: string): Promise<string> {
    const cat = await db.category.create({ data: { organizationId, name: `Materials-${Date.now()}-${Math.random()}` } });
    return cat.id;
  }

  // ────────────────────────────────────────────────────────────
  // 1-20. CREATE
  // ────────────────────────────────────────────────────────────
  describe("create", () => {
    it("1/7. EMPLOYEE creates own PR — requesterId is the authenticated user, never client-supplied", async () => {
      const admin = await registerOrg(app, "PR Create Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const res = await postPR(app, employee.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(201);
      expect(res.body.requesterId).toBe(employee.userId);
    });

    it("2. ADMIN creates PR", async () => {
      const admin = await registerOrg(app, "PR Create Admin Co");
      const res = await postPR(app, admin.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(201);
    });

    it("3. PROCUREMENT_MANAGER creates PR", async () => {
      const admin = await registerOrg(app, "PR Create Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const res = await postPR(app, manager.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(201);
    });

    it("4. PROCUREMENT_SPECIALIST creates PR", async () => {
      const admin = await registerOrg(app, "PR Create Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const res = await postPR(app, specialist.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(201);
    });

    it("5. SUPPLIER denied create", async () => {
      const admin = await registerOrg(app, "PR Create SupplierDeny Co");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const res = await postPR(app, supplier.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(403);
    });

    it("6. APPROVER denied create", async () => {
      const admin = await registerOrg(app, "PR Create ApproverDeny Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const res = await postPR(app, approver.accessToken, { items: [freeTextItem] });
      expect(res.status).toBe(403);
    });

    it("8/9. requestNumber generated correctly and sequentially within one org", async () => {
      const admin = await registerOrg(app, "PR Number Co");
      const first = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const second = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const year = new Date().getUTCFullYear();
      expect(first.requestNumber).toBe(`PR-${year}-000001`);
      expect(second.requestNumber).toBe(`PR-${year}-000002`);
    });

    it("10. separate organizations get independent sequences", async () => {
      const orgA = await registerOrg(app, "PR SeqOrgA Co");
      const orgB = await registerOrg(app, "PR SeqOrgB Co");
      const prA = await postPROk(app, orgA.accessToken, { items: [freeTextItem] });
      const prB = await postPROk(app, orgB.accessToken, { items: [freeTextItem] });
      const year = new Date().getUTCFullYear();
      expect(prA.requestNumber).toBe(`PR-${year}-000001`);
      expect(prB.requestNumber).toBe(`PR-${year}-000001`);
    });

    it("11. free-text item — itemName as given, skuSnapshot/productId null", async () => {
      const admin = await registerOrg(app, "PR FreeText Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      expect(pr.items[0]!.itemName).toBe(freeTextItem.itemName);
      expect(pr.items[0]!.skuSnapshot).toBeNull();
      expect(pr.items[0]!.productId).toBeNull();
    });

    it("12/16/17. product-backed item: server-derived snapshot, requested UOM preserved even when it differs from Product.baseUomCode, quantity returned as string", async () => {
      const admin = await registerOrg(app, "PR ProductBacked Co");
      const product = await createProduct(app, admin.accessToken, { baseUomCode: "KG" });
      const pr = await postPROk(app, admin.accessToken, {
        items: [{ productId: product.id, quantity: "10.500", uomCode: "PCS" }], // deliberately different from baseUomCode
      });
      const line = pr.items[0]!;
      expect(line.productId).toBe(product.id);
      expect(line.itemName).toBe(product.name);
      expect(line.skuSnapshot).toBe(product.sku);
      expect(line.uomCode).toBe("PCS"); // preserved, never converted/forced to match baseUomCode
      expect(typeof line.quantity).toBe("string");
      expect(Number(line.quantity)).toBe(10.5); // Decimal.toString() strips trailing zeros — compare numerically
    });

    it("13. foreign-tenant product rejected safely", async () => {
      const orgA = await registerOrg(app, "PR ForeignProduct A Co");
      const orgB = await registerOrg(app, "PR ForeignProduct B Co");
      const productB = await createProduct(app, orgB.accessToken);
      const res = await postPR(app, orgA.accessToken, { items: [{ productId: productB.id, quantity: "1.000", uomCode: "KG" }] });
      expect(res.status).toBe(404);
    });

    it("14. foreign department rejected safely", async () => {
      const orgA = await registerOrg(app, "PR ForeignDept A Co");
      const orgB = await registerOrg(app, "PR ForeignDept B Co");
      const deptB = await seedDepartment(orgB.organizationId);
      const res = await postPR(app, orgA.accessToken, { departmentId: deptB, items: [freeTextItem] });
      expect(res.status).toBe(404);
    });

    it("15. foreign category rejected safely", async () => {
      const orgA = await registerOrg(app, "PR ForeignCat A Co");
      const orgB = await registerOrg(app, "PR ForeignCat B Co");
      const catB = await seedCategory(orgB.organizationId);
      const res = await postPR(app, orgA.accessToken, { categoryId: catB, items: [freeTextItem] });
      expect(res.status).toBe(404);
    });

    it("18/19. create rollback leaves no PR/items/audit and does not consume a sequence value", async () => {
      const admin = await registerOrg(app, "PR Rollback Co");
      const before = await db.purchaseRequest.count({ where: { organizationId: admin.organizationId } });
      const auditBefore = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED" } });
      // PurchaseRequestItem has no own organizationId (parent-scoped child —
      // Architecture Gate §K) — scope this org's item count through the
      // relation, never a bare itemName match (which would also match
      // identically-named items created by other tests/orgs in this run).
      const itemsBefore = await db.purchaseRequestItem.count({ where: { purchaseRequest: { organizationId: admin.organizationId } } });

      const res = await postPR(app, admin.accessToken, {
        items: [freeTextItem, { productId: "00000000-0000-0000-0000-000000000000", quantity: "1.000", uomCode: "KG" }],
      });
      expect(res.status).toBe(404);

      const after = await db.purchaseRequest.count({ where: { organizationId: admin.organizationId } });
      const auditAfter = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED" } });
      expect(after).toBe(before);
      expect(auditAfter).toBe(auditBefore);
      const itemsAfter = await db.purchaseRequestItem.count({ where: { purchaseRequest: { organizationId: admin.organizationId } } });
      expect(itemsAfter).toBe(itemsBefore);

      // 19: the next successful create still gets 000001 — the failed
      // attempt's sequence increment was rolled back with everything else.
      const succeeded = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const year = new Date().getUTCFullYear();
      expect(succeeded.requestNumber).toBe(`PR-${year}-000001`);
    });

    it("20. AuditLog created atomically with a successful PR", async () => {
      const admin = await registerOrg(app, "PR AuditAtomic Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const audits = await db.auditLog.findMany({
        where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED", entityId: pr.id },
      });
      expect(audits).toHaveLength(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 21-30. IDEMPOTENCY
  // ────────────────────────────────────────────────────────────
  describe("idempotency", () => {
    it("21. no key — two POSTs create two distinct PRs", async () => {
      const admin = await registerOrg(app, "PR NoKey Co");
      const a = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const b = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      expect(a.id).not.toBe(b.id);
      expect(a.requestNumber).not.toBe(b.requestNumber);
    });

    it("22/23/24. same key + same payload replays the existing PR, no second audit, no second sequence consumption", async () => {
      const admin = await registerOrg(app, "PR IdemReplay Co");
      const body = { idempotencyKey: "idem-key-1", items: [freeTextItem] };
      const first = await postPROk(app, admin.accessToken, body);
      const auditBefore = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED" } });

      const replay = await postPROk(app, admin.accessToken, body);
      expect(replay.id).toBe(first.id);

      const auditAfter = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED" } });
      expect(auditAfter).toBe(auditBefore);

      const fresh = await postPROk(app, admin.accessToken, { items: [freeTextItem] }); // no key, genuinely new
      const year = new Date().getUTCFullYear();
      expect(fresh.requestNumber).toBe(`PR-${year}-000002`); // not 000003 — the replay never consumed a number
    });

    it("25. same key + different payload -> 409, no duplicate PR", async () => {
      const admin = await registerOrg(app, "PR IdemMismatch Co");
      await postPROk(app, admin.accessToken, { idempotencyKey: "idem-key-2", items: [freeTextItem] });
      const res = await postPR(app, admin.accessToken, {
        idempotencyKey: "idem-key-2",
        items: [{ itemName: "Different item entirely", quantity: "1.000", uomCode: "PCS" }],
      });
      expect(res.status).toBe(409);
      const count = await db.purchaseRequest.count({ where: { organizationId: admin.organizationId, idempotencyKey: "idem-key-2" } });
      expect(count).toBe(1);
    });

    it("26/27/28. concurrent same key + same payload yields exactly one PR, same id, one creation audit", async () => {
      const admin = await registerOrg(app, "PR IdemConcurrent Co");
      const body = { idempotencyKey: "idem-key-concurrent-1", items: [freeTextItem] };
      const [r1, r2] = await Promise.all([postPR(app, admin.accessToken, body), postPR(app, admin.accessToken, body)]);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      expect(r1.body.id).toBe(r2.body.id);

      const count = await db.purchaseRequest.count({ where: { organizationId: admin.organizationId, idempotencyKey: "idem-key-concurrent-1" } });
      expect(count).toBe(1);
      const audits = await db.auditLog.count({
        where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_CREATED", entityId: r1.body.id },
      });
      expect(audits).toBe(1);
    });

    it("29. the same idempotency key string may be used independently by two different organizations", async () => {
      const orgA = await registerOrg(app, "PR IdemOrgA Co");
      const orgB = await registerOrg(app, "PR IdemOrgB Co");
      const key = "shared-literal-key";
      const prA = await postPROk(app, orgA.accessToken, { idempotencyKey: key, items: [freeTextItem] });
      const prB = await postPROk(app, orgB.accessToken, { idempotencyKey: key, items: [freeTextItem] });
      expect(prA.id).not.toBe(prB.id);
    });

    it("30. an unauthorized role cannot probe/replay an existing idempotency key", async () => {
      const admin = await registerOrg(app, "PR IdemProbe Co");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const key = "probe-target-key";
      const original = await postPROk(app, admin.accessToken, { idempotencyKey: key, items: [freeTextItem] });

      const res = await postPR(app, supplier.accessToken, { idempotencyKey: key, items: [freeTextItem] });
      expect(res.status).toBe(403); // role denial fires before any idempotency lookup — never the replayed PR
      expect(res.body.id).not.toBe(original.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 31-38. HEADER PATCH
  // ────────────────────────────────────────────────────────────
  describe("header PATCH", () => {
    it("31. owner EMPLOYEE edits own DRAFT", async () => {
      const admin = await registerOrg(app, "PR PatchOwner Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const pr = await postPROk(app, employee.accessToken, { items: [freeTextItem] });
      const res = await patchPR(app, employee.accessToken, pr.id, { reason: "updated reason" });
      expect(res.status).toBe(200);
      expect(res.body.reason).toBe("updated reason");
    });

    it("32. EMPLOYEE cannot edit another user's DRAFT", async () => {
      const admin = await registerOrg(app, "PR PatchForeignEmployee Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const pr = await postPROk(app, employeeA.accessToken, { items: [freeTextItem] });
      const res = await patchPR(app, employeeB.accessToken, pr.id, { reason: "hijacked" });
      expect(res.status).toBe(404);
    });

    it("33. a procurement role can edit any org DRAFT", async () => {
      const admin = await registerOrg(app, "PR PatchProcRole Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const pr = await postPROk(app, employee.accessToken, { items: [freeTextItem] });
      const res = await patchPR(app, manager.accessToken, pr.id, { reason: "manager edit" });
      expect(res.status).toBe(200);
    });

    it("34. foreign tenant cannot edit", async () => {
      const orgA = await registerOrg(app, "PR PatchTenantA Co");
      const orgB = await registerOrg(app, "PR PatchTenantB Co");
      const pr = await postPROk(app, orgA.accessToken, { items: [freeTextItem] });
      const res = await patchPR(app, orgB.accessToken, pr.id, { reason: "cross tenant" });
      expect(res.status).toBe(404);
    });

    it("35. server-controlled field rejected on PATCH", async () => {
      const admin = await registerOrg(app, "PR PatchServerField Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const res = await patchPR(app, admin.accessToken, pr.id, { status: "APPROVED" });
      expect(res.status).toBe(400);
    });

    it("36/37. an actual change writes exactly one AuditLog entry; a no-op PATCH writes none", async () => {
      const admin = await registerOrg(app, "PR PatchAudit Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem], priority: "HIGH" });

      const before = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_UPDATED", entityId: pr.id } });
      await patchPR(app, admin.accessToken, pr.id, { priority: "URGENT" });
      const afterRealChange = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_UPDATED", entityId: pr.id } });
      expect(afterRealChange).toBe(before + 1);

      await patchPR(app, admin.accessToken, pr.id, { priority: "URGENT" }); // same value as current — no-op
      const afterNoOp = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_UPDATED", entityId: pr.id } });
      expect(afterNoOp).toBe(afterRealChange);
    });

    it("38. a failed PATCH (invalid reference) leaves the header and audit trail untouched", async () => {
      const admin = await registerOrg(app, "PR PatchRollback Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem], reason: "original reason" });
      const auditBefore = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_UPDATED", entityId: pr.id } });

      const res = await patchPR(app, admin.accessToken, pr.id, { departmentId: "00000000-0000-0000-0000-000000000000", reason: "should not stick" });
      expect(res.status).toBe(404);

      const detail = await getPR(app, admin.accessToken, pr.id);
      expect(detail.body.reason).toBe("original reason");
      const auditAfter = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_UPDATED", entityId: pr.id } });
      expect(auditAfter).toBe(auditBefore);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 39-52. ITEMS
  // ────────────────────────────────────────────────────────────
  describe("items", () => {
    it("39. add free-text item", async () => {
      const admin = await registerOrg(app, "PR AddFreeText Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const res = await addItem(app, admin.accessToken, pr.id, { itemName: "Aluminium busbar 30x5", quantity: "1200.000", uomCode: "KG" });
      expect(res.status).toBe(201);
      expect(res.body.itemName).toBe("Aluminium busbar 30x5");
    });

    it("40/41. add product-backed item — snapshot server-derived from the actual current Product", async () => {
      const admin = await registerOrg(app, "PR AddProductBacked Co");
      const product = await createProduct(app, admin.accessToken);
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const res = await addItem(app, admin.accessToken, pr.id, { productId: product.id, quantity: "5.000", uomCode: "KG" });
      expect(res.status).toBe(201);
      expect(res.body.itemName).toBe(product.name);
      expect(res.body.skuSnapshot).toBe(product.sku);
    });

    it("42. add item with a foreign-tenant product is rejected", async () => {
      const orgA = await registerOrg(app, "PR AddForeignProduct A Co");
      const orgB = await registerOrg(app, "PR AddForeignProduct B Co");
      const productB = await createProduct(app, orgB.accessToken);
      const pr = await postPROk(app, orgA.accessToken, { items: [freeTextItem] });
      const res = await addItem(app, orgA.accessToken, pr.id, { productId: productB.id, quantity: "1.000", uomCode: "KG" });
      expect(res.status).toBe(404);
    });

    it("43/44. update item quantity and uomCode", async () => {
      const admin = await registerOrg(app, "PR UpdateItem Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const itemId = pr.items[0]!.id as string;

      const res1 = await updateItem(app, admin.accessToken, pr.id, itemId, { quantity: "750.000" });
      expect(res1.status).toBe(200);
      expect(Number(res1.body.quantity)).toBe(750);

      const res2 = await updateItem(app, admin.accessToken, pr.id, itemId, { uomCode: "TON" });
      expect(res2.status).toBe(200);
      expect(res2.body.uomCode).toBe("TON");
    });

    it("45. item identity fields are rejected on PATCH", async () => {
      const admin = await registerOrg(app, "PR UpdateItemIdentity Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const itemId = pr.items[0]!.id as string;
      const res = await updateItem(app, admin.accessToken, pr.id, itemId, { productId: "11111111-1111-1111-1111-111111111111" });
      expect(res.status).toBe(400);
    });

    it("46/47/48. remove an item, including the final remaining item, captured in AuditLog", async () => {
      const admin = await registerOrg(app, "PR RemoveItem Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const itemId = pr.items[0]!.id as string;

      const res = await removeItem(app, admin.accessToken, pr.id, itemId);
      expect(res.status).toBe(200);

      const detail = await getPR(app, admin.accessToken, pr.id);
      expect(detail.body.items).toHaveLength(0); // 47: final item removal allowed, PR still exists as DRAFT
      expect(detail.body.status).toBe("DRAFT");

      const audits = await db.auditLog.findMany({
        where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_ITEM_REMOVED", entityId: itemId },
      });
      expect(audits).toHaveLength(1);
      expect((audits[0]!.oldValue as Record<string, unknown>).itemName).toBe(freeTextItem.itemName);
    });

    it("49. an item cannot be mutated through a different (foreign) PR in the same org", async () => {
      const admin = await registerOrg(app, "PR ForeignItemSamePR Co");
      const prA = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const prB = await postPROk(app, admin.accessToken, { items: [{ itemName: "Other item", quantity: "1.000", uomCode: "PCS" }] });
      const itemBId = prB.items[0]!.id as string;

      const res = await updateItem(app, admin.accessToken, prA.id, itemBId, { quantity: "999.000" });
      expect(res.status).toBe(404);
    });

    it("50. Org A cannot reach Org B's item, even with correct PR and item ids", async () => {
      const orgA = await registerOrg(app, "PR CrossTenantItem A Co");
      const orgB = await registerOrg(app, "PR CrossTenantItem B Co");
      const prB = await postPROk(app, orgB.accessToken, { items: [freeTextItem] });
      const itemBId = prB.items[0]!.id as string;

      const res = await updateItem(app, orgA.accessToken, prB.id, itemBId, { quantity: "1.000" });
      expect(res.status).toBe(404);
    });

    it("51. add/update/delete audit atomicity — a rejected add leaves no item row and no audit row", async () => {
      const admin = await registerOrg(app, "PR ItemAuditAtomic Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const itemsBefore = await db.purchaseRequestItem.count({ where: { purchaseRequestId: pr.id } });
      const auditBefore = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_ITEM_ADDED" } });

      const res = await addItem(app, admin.accessToken, pr.id, { productId: "00000000-0000-0000-0000-000000000000", quantity: "1.000", uomCode: "KG" });
      expect(res.status).toBe(404);

      const itemsAfter = await db.purchaseRequestItem.count({ where: { purchaseRequestId: pr.id } });
      const auditAfter = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_ITEM_ADDED" } });
      expect(itemsAfter).toBe(itemsBefore);
      expect(auditAfter).toBe(auditBefore);
    });

    it("52. a no-op item PATCH writes no audit", async () => {
      const admin = await registerOrg(app, "PR ItemNoOp Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const itemId = pr.items[0]!.id as string;

      const before = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_ITEM_UPDATED", entityId: itemId } });
      const res = await updateItem(app, admin.accessToken, pr.id, itemId, { quantity: freeTextItem.quantity, uomCode: freeTextItem.uomCode });
      expect(res.status).toBe(200);
      const after = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "PURCHASE_REQUEST_ITEM_UPDATED", entityId: itemId } });
      expect(after).toBe(before);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Concurrency (§42)
  // ────────────────────────────────────────────────────────────
  describe("concurrency", () => {
    it("concurrent first-PR creation in a fresh org/year: both succeed with distinct, non-duplicate requestNumbers, no orphan items", async () => {
      const admin = await registerOrg(app, "PR ConcurrentFirst Co");
      const [r1, r2] = await Promise.all([
        postPR(app, admin.accessToken, { items: [freeTextItem] }),
        postPR(app, admin.accessToken, { items: [freeTextItem] }),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.requestNumber).not.toBe(r2.body.requestNumber);
      const year = new Date().getUTCFullYear();
      const numbers = [r1.body.requestNumber, r2.body.requestNumber].sort();
      expect(numbers).toEqual([`PR-${year}-000001`, `PR-${year}-000002`]);

      // No orphan items — every item row's parent PR actually exists.
      const items = await db.purchaseRequestItem.findMany({ where: { purchaseRequestId: { in: [r1.body.id, r2.body.id] } } });
      for (const item of items) {
        const parent = await db.purchaseRequest.findUnique({ where: { id: item.purchaseRequestId } });
        expect(parent).not.toBeNull();
      }
    });
  });
});
