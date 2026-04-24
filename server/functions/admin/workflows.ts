import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as service from "../../services/workflow";
import { createWorkflowSchema, updateWorkflowSchema } from "../../schemas/workflow";

function getCustomerId(c: { req: { header: (name: string) => string | undefined } }) {
  const customerId = c.req.header('x-customer-id');
  if (!customerId) throw new Error('Missing X-Customer-Id header');
  return customerId;
}

const workflows = new Hono()
  .get("/:id", async (c) => {
    const result = await service.getWorkflow(c.req.param("id"));

    if (!result) {
      return c.json({ error: "Workflow not found" }, 404);
    }

    return c.json(result, 200);
  })
  .get("/", async (c) => {
    const allWorkflows = await service.listWorkflows();
    return c.json({ workflows: allWorkflows }, 200);
  })
  .post(
    "/",
    zValidator("json", createWorkflowSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const body = c.req.valid("json");
      const workflow = await service.createWorkflow(customerId, body);
      return c.json({ workflow }, 200);
    }
  )
  .patch("/:id/publish", async (c) => {
    const result = await service.publishWorkflow(c.req.param("id"));
    if (!result) return c.json({ error: "Workflow not found" }, 404);
    return c.json({ workflow: result }, 200);
  })
  .put(
    "/:id",
    zValidator("json", updateWorkflowSchema),
    async (c) => {
      const body = c.req.valid("json");
      const updatedWorkflow = await service.updateWorkflow(c.req.param("id"), body);

      if (!updatedWorkflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      return c.json({ workflow: updatedWorkflow }, 200);
    }
  );

export { workflows };
