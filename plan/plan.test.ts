import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { api } from "encore.dev/api";
import * as plan from "./plan";

describe("Plan API", () => {
    const testWorkspaceId = "11111111-1111-1111-1111-111111111111";
    const testPlanId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    beforeAll(async () => {
        // Insert test data before running tests
        await plan.insertTestData();
    });

    beforeEach(async () => {
        // Set workspace context before each test
        await plan.changeCurrentWorkspace({ workspace_id: testWorkspaceId });
    });

    describe("list", () => {
        it("should list plans for current workspace", async () => {
            const response = await plan.list();
            expect(response.plans).toBeDefined();
            expect(response.plans.length).toBeGreaterThan(0);
            expect(response.plans[0].workspace_id).toBe(testWorkspaceId);
        });
    });

    describe("get", () => {
        it("should get a specific plan", async () => {
            const response = await plan.get({ id: testPlanId });
            expect(response).toBeDefined();
            expect(response.id).toBe(testPlanId);
            expect(response.workspace_id).toBe(testWorkspaceId);
        });

        it("should throw not found for non-existent plan", async () => {
            await expect(
                plan.get({ id: "00000000-0000-0000-0000-000000000000" })
            ).rejects.toThrow("Plan not found");
        });
    });

    describe("create", () => {
        it("should create a new plan", async () => {
            const newPlan = {
                name: "Test Plan",
                workspace_id: testWorkspaceId
            };

            const response = await plan.create(newPlan);
            expect(response).toBeDefined();
            expect(response.name).toBe(newPlan.name);
            expect(response.workspace_id).toBe(testWorkspaceId);
            expect(response.id).toBeDefined();
        });
    });

    describe("update", () => {
        it("should update an existing plan", async () => {
            const updatedName = "Updated Plan Name";
            const response = await plan.update({
                id: testPlanId,
                name: updatedName
            });

            expect(response).toBeDefined();
            expect(response.id).toBe(testPlanId);
            expect(response.name).toBe(updatedName);
            expect(response.workspace_id).toBe(testWorkspaceId);
        });

        it("should throw not found for non-existent plan", async () => {
            await expect(
                plan.update({
                    id: "00000000-0000-0000-0000-000000000000",
                    name: "Test"
                })
            ).rejects.toThrow("Plan not found");
        });
    });

    describe("remove", () => {
        it("should delete an existing plan", async () => {
            // First create a plan to delete
            const newPlan = await plan.create({
                name: "Plan to Delete",
                workspace_id: testWorkspaceId
            });

            // Delete the plan
            await plan.remove({ id: newPlan.id });

            // Verify plan is deleted
            await expect(
                plan.get({ id: newPlan.id })
            ).rejects.toThrow("Plan not found");
        });
    });

    describe("workspace context", () => {
        it("should enforce workspace isolation", async () => {
            // Create a plan in the current workspace
            const newPlan = await plan.create({
                name: "Workspace Test Plan",
                workspace_id: testWorkspaceId
            });

            // Change to a different workspace
            await plan.changeCurrentWorkspace({
                workspace_id: "22222222-2222-2222-2222-222222222222"
            });

            // List plans in new workspace - should not include the plan we just created
            const response = await plan.list();
            const planIds = response.plans.map(p => p.id);
            expect(planIds).not.toContain(newPlan.id);
        });

        it("should throw error when workspace not found", async () => {
            await expect(
                plan.changeCurrentWorkspace({
                    workspace_id: "00000000-0000-0000-0000-000000000000"
                })
            ).rejects.toThrow("Workspace not found");
        });
    });
});
