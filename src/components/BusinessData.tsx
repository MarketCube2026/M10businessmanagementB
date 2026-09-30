import { units } from "../../shared/extensions";
import { fields, labels, statuses } from "../../shared/domain";
export const displayNames: Record<string, string> = {
  ...Object.fromEntries(
    Object.values(fields)
      .flat()
      .map((f) => [f.key, f.label]),
  ),
  type: "类型 / 分支",
  responsible: "负责人 / 部门",
  requirements: "交付要求及证据",
  conclusion: "验收结论",
  versionLabel: "业务版本",
  number: "发票号码",
  date: "开票日期",
  sourceDate: "来源日期",
  sourcePage: "来源页",
  protocol: "临床方案号",
  projectCode: "项目编号",
  historicalStatus: "历史状态",
  missing: "缺失信息",
  sourceId: "来源档案ID",
  evidencePage: "证据页",
  sourceRowId: "来源条目ID",
  amountCents: "金额（分）",
  receivedCents: "已收（分）",
  nextAction: "下一步动作",
  priority: "优先级",
  orderIds: "结算订单ID",
  settlementId: "结算单ID",
  receivableId: "应收记录ID",
};
export function BusinessData({ data }: { data: any }) {
  return (
    <dl className="data-grid">
      {Object.entries(data || {})
        .filter(
          ([k, v]) =>
            v !== undefined &&
            v !== null &&
            !["history", "revisions", "items", "fields", "lineItems"].includes(
              k,
            ),
        )
        .map(([k, v]) => (
          <div key={k}>
            <dt>{displayNames[k] || k}</dt>
            <dd>
              {typeof v === "object"
                ? Array.isArray(v)
                  ? v
                      .map((x) =>
                        typeof x === "object"
                          ? Object.values(x).join(" / ")
                          : String(x),
                      )
                      .join("；")
                  : Object.entries(v as any)
                      .map(
                        ([a, b]) => (displayNames[a] || a) + "：" + String(b),
                      )
                      .join("；")
                : String(v)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function LineItems({
  items,
  onChange,
  cost = false,
  readOnly = false,
}: {
  items: any[];
  onChange?: (x: any[]) => void;
  cost?: boolean;
  readOnly?: boolean;
}) {
  const columns = [
    ["name", "服务/产品"],
    ["unit", "单位"],
    ["quantity", "数量"],
    ["price", "单价（元）"],
    ...(cost ? [["cost", "单位成本（元）"]] : []),
    ["supplier", "外包供应商"],
    ["delivered", "已交付量"],
    ["adjustmentCents", "折算调整（分）"],
    ["adjustmentReason", "折算依据"],
  ];
  const update = (i: number, k: string, value: any) =>
    onChange?.(items.map((v, j) => (i === j ? { ...v, [k]: value } : v)));
  return (
    <div className="line-items">
      <table>
        <thead>
          <tr>
            {columns.map(([k, n]) => (
              <th key={k}>{n}</th>
            ))}
            {!readOnly && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              {columns.map(([k, n]) => (
                <td key={k}>
                  {readOnly ? (
                    String(item[k] ?? "—")
                  ) : k === "unit" ? (
                    <select
                      aria-label={n + " " + (i + 1)}
                      value={item[k] || "项"}
                      onChange={(e) => update(i, k, e.target.value)}
                    >
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={n + " " + (i + 1)}
                      value={item[k] ?? ""}
                      required={["name", "quantity", "price"].includes(k)}
                      type={
                        [
                          "quantity",
                          "price",
                          "cost",
                          "delivered",
                          "adjustmentCents",
                        ].includes(k)
                          ? "number"
                          : "text"
                      }
                      step={k === "adjustmentCents" ? 1 : "0.01"}
                      min={k === "adjustmentCents" ? undefined : 0}
                      onChange={(e) =>
                        update(
                          i,
                          k,
                          [
                            "quantity",
                            "price",
                            "cost",
                            "delivered",
                            "adjustmentCents",
                          ].includes(k)
                            ? e.target.value === ""
                              ? undefined
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </td>
              ))}
              {!readOnly && (
                <td>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onChange?.(items.filter((_, j) => j !== i))}
                  >
                    删除
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange?.([
              ...items,
              { name: "", unit: "项", quantity: 1, price: 0 },
            ])
          }
        >
          增加明细
        </button>
      )}
    </div>
  );
}
