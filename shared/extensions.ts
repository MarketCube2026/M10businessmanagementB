import { z } from "zod";
export const extensionKinds = [
  "deliverable",
  "quality",
  "order",
  "settlement",
  "invoice",
] as const;
export type ExtensionKind = (typeof extensionKinds)[number];
export const extensionLabels = {
  deliverable: "交付包",
  quality: "稽查整改",
  order: "服务 / 试剂订单",
  settlement: "结算单",
  invoice: "发票",
};
export const units = ["样本", "Lane", "FC", "G", "M", "套", "项"] as const;
export const itemSchema = z.object({
  name: z.string().trim().min(1),
  unit: z.enum(units),
  quantity: z.number().positive().max(1e7),
  price: z.number().nonnegative().max(1e8),
  cost: z.number().nonnegative().optional(),
  supplier: z.string().optional(),
  delivered: z.number().nonnegative().optional(),
  adjustmentCents: z.number().int().optional(),
  adjustmentReason: z.string().optional(),
  conversion: z.string().optional(),
});
export function priceItems(items: unknown) {
  const rows = z.array(itemSchema).min(1).max(100).parse(items);
  let amountCents = 0;
  for (const r of rows) {
    if ((r.delivered || 0) > r.quantity) throw Error("交付数量超过订单数量");
    if (r.adjustmentCents && !r.adjustmentReason)
      throw Error("补测或折算必须填写依据");
    const amount =
      Math.round(Math.round(r.price * 100) * r.quantity) +
      (r.adjustmentCents || 0);
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw Error("订单金额无效");
    amountCents += amount;
  }
  if (!Number.isSafeInteger(amountCents)) throw Error("金额超出范围");
  return { items: rows, amountCents };
}
export function addDays(
  start: string,
  count: number,
  type: "calendar" | "working",
  calendar: { date: string; working: boolean }[] = [],
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 3660
  )
    throw Error("周期参数无效");
  const d = new Date(start + "T00:00:00Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== start)
    throw Error("日期无效");
  let n = 0;
  while (n < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const key = d.toISOString().slice(0, 10),
      override = calendar.find((c) => c.date === key);
    if (
      type === "calendar" ||
      (override ? override.working : ![0, 6].includes(d.getUTCDay()))
    )
      n++;
  }
  return d.toISOString().slice(0, 10);
}
