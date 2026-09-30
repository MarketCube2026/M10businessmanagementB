import { useEffect, useState } from "react";
import { api, money, go } from "../api";
import { Modal, costAllowed, User, isManager } from "../ui";
import {
  extensionKinds,
  extensionLabels,
  ExtensionKind,
} from "../../shared/extensions";
import { BusinessData, LineItems } from "./BusinessData";
const statusText: any = {
  draft: "草稿",
  submitted: "待审批",
  approved: "已通过",
  rejected: "退回修改",
  completed: "已验收",
  closed: "已关闭",
};
function canWrite(u: User, k: string) {
  return (
    isManager(u) ||
    (k === "deliverable" || k === "quality"
      ? ["technical", "delivery"]
      : k === "order"
        ? ["bd", "finance"]
        : ["finance"]
    ).includes(u.role)
  );
}
export function Workflow({ record }: { record: any }) {
  const [rows, setRows] = useState<any[]>([]),
    [user, setUser] = useState<User>(),
    [editor, setEditor] = useState<any>(),
    [action, setAction] = useState<any>(),
    [error, setError] = useState(""),
    [calendar, setCalendar] = useState<any>();
  const load = () =>
    api("/workflow?recordId=" + record.id)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/me")
      .then(setUser)
      .catch((e) => setError(e.message));
  }, [record.id]);
  if (
    !["project", "contract"].includes(record.kind) ||
    record.nature === "history" ||
    !user
  )
    return null;
  const totals = (k: string) =>
    rows
      .filter((r) => r.kind === k && r.status === "approved")
      .reduce((s, r) => s + (r.data.amountCents || 0), 0);
  return (
    <section className="panel">
      <h2>交付、质量与结算</h2>
      <div className="money-strip">
        <span>
          合同总额
          <b>
            {record.data.amountCents === null
              ? "按订单结算"
              : money(record.data.amountCents)}
          </b>
        </span>
        <span>
          订单额<b>{money(totals("order"))}</b>
        </span>
        <span>
          已结算<b>{money(totals("settlement"))}</b>
        </span>
        <span>
          已开票<b>{money(totals("invoice"))}</b>
        </span>
        <span>
          已收款
          <b>
            {money(
              record.children
                ?.filter((r: any) => r.kind === "receivable")
                .reduce(
                  (n: number, r: any) => n + (r.data.receivedCents || 0),
                  0,
                ),
            )}
          </b>
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button onClick={load}>重试</button>
        </p>
      )}
      <div className="action-bar">
        {extensionKinds
          .filter(
            (k) =>
              canWrite(user, k) &&
              !(
                record.status === "done" &&
                ["deliverable", "quality"].includes(k)
              ),
          )
          .map((k) => (
            <button
              className="secondary"
              key={k}
              onClick={() => setEditor({ kind: k })}
            >
              新增{extensionLabels[k]}
            </button>
          ))}
      </div>
      {rows.map((r) => (
        <details className="file-row" key={r.id}>
          <summary>
            {r.title} · {extensionLabels[r.kind as ExtensionKind]} ·{" "}
            {statusText[r.status]} · v{r.version}
            {r.data.amountCents !== undefined
              ? " · " + money(r.data.amountCents)
              : ""}
          </summary>
          <BusinessData data={r.data} />
          {r.data.items && (
            <LineItems items={r.data.items} readOnly cost={costAllowed(user)} />
          )}
          <div className="action-bar">
            {canWrite(user, r.kind) &&
              ["draft", "rejected"].includes(r.status) && (
                <>
                  <button
                    className="secondary"
                    onClick={() => setAction({ row: r, action: "submit" })}
                  >
                    提交审核
                  </button>
                  {["deliverable", "quality"].includes(r.kind) && (
                    <button
                      className="secondary"
                      onClick={() => setEditor({ kind: r.kind, existing: r })}
                    >
                      修订内容
                    </button>
                  )}
                </>
              )}
            {r.status === "submitted" &&
              (isManager(user) ||
                user.role ===
                  (["order", "settlement", "invoice"].includes(r.kind)
                    ? "finance"
                    : "technical")) && (
                <>
                  <button
                    className="secondary"
                    onClick={() => setAction({ row: r, action: "approve" })}
                  >
                    通过
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setAction({ row: r, action: "reject" })}
                  >
                    退回
                  </button>
                </>
              )}
            {r.status === "approved" &&
              ["deliverable", "quality"].includes(r.kind) &&
              canWrite(user, r.kind) &&
              (r.kind !== "quality" ||
                isManager(user) ||
                user.role === "technical") && (
                <button
                  className="primary"
                  onClick={() =>
                    setAction({
                      row: r,
                      action: r.kind === "quality" ? "close" : "complete",
                    })
                  }
                >
                  验收 / 复核关闭
                </button>
              )}
            {r.kind === "settlement" &&
              r.status === "approved" &&
              !r.data.receivableId &&
              costAllowed(user) && (
                <button
                  className="primary"
                  onClick={() => setAction({ row: r, action: "receivable" })}
                >
                  生成应收
                </button>
              )}
            {r.data.receivableId && (
              <button
                className="secondary"
                onClick={() => go("record/" + r.data.receivableId)}
              >
                查看应收与回款
              </button>
            )}
          </div>
          <details>
            <summary>版本与操作记录</summary>
            {(r.data.history || []).map((h: any, i: number) => (
              <p key={i}>
                {h.at} · {h.action} · {h.comment}
              </p>
            ))}
            {(r.data.revisions || []).map((v: any, i: number) => (
              <div key={i}>
                <b>v{v.version}</b>
                <BusinessData data={v} />
              </div>
            ))}
          </details>
          {user.role === "admin" && (
            <details>
              <summary>管理员调试数据</summary>
              <pre>{JSON.stringify(r.data, null, 2)}</pre>
            </details>
          )}
        </details>
      ))}
      <details>
        <summary>检测周期与工作日历</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              setCalendar(
                await api("/calendar/calculate", "POST", {
                  start: f.get("start"),
                  days: Number(f.get("days")),
                  type: f.get("type"),
                }),
              );
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <label>
            起始日期
            <input type="date" name="start" required />
          </label>
          <label>
            周期天数
            <input type="number" name="days" min="0" required />
          </label>
          <label>
            口径
            <select name="type">
              <option value="calendar">自然日</option>
              <option value="working">工作日</option>
            </select>
          </label>
          <button className="secondary">计算计划日期</button>
        </form>
        {calendar && (
          <p>
            {calendar.dueDate} · {calendar.basis}
          </p>
        )}
        {isManager(user) && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api("/calendar", "POST", {
                  date: f.get("date"),
                  working: f.get("working") === "yes",
                  note: f.get("note"),
                });
                setCalendar({
                  dueDate: "日历已保存",
                  basis: "后续计算使用此例外",
                });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <label>
              节假日 / 调休日期
              <input required type="date" name="date" />
            </label>
            <select name="working">
              <option value="no">休息日</option>
              <option value="yes">工作日</option>
            </select>
            <input name="note" required placeholder="日历来源 / 说明" />
            <button className="secondary">保存日历例外</button>
          </form>
        )}
      </details>
      {editor && (
        <WorkflowEditor
          {...editor}
          user={user}
          record={record}
          rows={rows}
          close={() => setEditor(undefined)}
          saved={() => {
            setEditor(undefined);
            load();
          }}
        />
      )}
      {action && (
        <WorkflowAction
          {...action}
          close={() => setAction(undefined)}
          saved={() => {
            setAction(undefined);
            load();
          }}
        />
      )}
    </section>
  );
}
function WorkflowAction({ row, action, close, saved }: any) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="业务确认" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await api("/workflow/" + row.id + "/actions", "POST", {
              action,
              version: row.version,
              comment: f.get("comment"),
              ...(action === "receivable" ? { dueDate: f.get("dueDate") } : {}),
            });
            saved();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="hint">
          {row.title} · v{row.version}
        </p>
        {action === "receivable" && (
          <label>
            应收到期日期
            <input required name="dueDate" type="date" />
          </label>
        )}
        <label>
          审核、验收或整改说明
          <textarea required name="comment" rows={4} />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button disabled={busy} className="primary">
            确认操作
          </button>
        </div>
      </form>
    </Modal>
  );
}
function WorkflowEditor({
  kind,
  existing,
  record,
  rows,
  user,
  close,
  saved,
}: any) {
  const [items, setItems] = useState<any[]>(
      existing?.data.items || [{ name: "", unit: "项", quantity: 1, price: 0 }],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const requestClose = () => (dirty ? setDiscard(true) : close());
  return (
    <Modal
      title={
        (existing ? "修订" : "新增") + extensionLabels[kind as ExtensionKind]
      }
      close={requestClose}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const f = new FormData(e.currentTarget);
          const data: any = Object.fromEntries(f);
          const title = data.title;
          delete data.title;
          if (kind === "order") data.items = items;
          if (kind === "settlement") data.orderIds = f.getAll("orderId");
          if (kind === "invoice") data.amount = Number(data.amount);
          try {
            await api(
              existing ? "/workflow/" + existing.id : "/workflow",
              existing ? "PATCH" : "POST",
              existing
                ? { version: existing.version, title, data }
                : { recordId: record.id, kind, title, data },
            );
            saved();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          名称
          <input required name="title" defaultValue={existing?.title} />
        </label>
        {kind === "order" ? (
          <LineItems
            items={items}
            cost={costAllowed(user)}
            onChange={(i) => {
              setDirty(true);
              setItems(i);
            }}
          />
        ) : kind === "settlement" ? (
          <label>
            已审批订单
            {rows
              .filter((r: any) => r.kind === "order" && r.status === "approved")
              .map((r: any) => (
                <label className="check-label" key={r.id}>
                  <input type="checkbox" name="orderId" value={r.id} />
                  {r.title} {money(r.data.amountCents)}
                </label>
              ))}
          </label>
        ) : kind === "invoice" ? (
          <>
            <label>
              结算单
              <select required name="settlementId">
                <option value="">请选择</option>
                {rows
                  .filter(
                    (r: any) =>
                      r.kind === "settlement" && r.status === "approved",
                  )
                  .map((r: any) => (
                    <option value={r.id} key={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              发票号码
              <input name="number" required />
            </label>
            <label>
              开票金额（元）
              <input
                name="amount"
                type="number"
                min=".01"
                step=".01"
                required
              />
            </label>
            <label>
              开票日期
              <input name="date" type="date" required />
            </label>
          </>
        ) : (
          <>
            <label>
              {kind === "quality" ? "问题及依据" : "交付类型 / 分支"}
              <input name="type" required defaultValue={existing?.data.type} />
            </label>
            <label>
              责任人 / 责任部门
              <input
                name="responsible"
                required
                defaultValue={existing?.data.responsible}
              />
            </label>
            <label>
              计划完成日期
              <input
                name="dueDate"
                type="date"
                required
                defaultValue={existing?.data.dueDate}
              />
            </label>
            <label>
              {kind === "quality"
                ? "整改要求与复核证据"
                : "交付范围、图表清单、版本及验收要求"}
              <textarea
                name="requirements"
                required
                defaultValue={existing?.data.requirements}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" className="secondary" onClick={requestClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            保存草稿
          </button>
        </div>
      </form>
      {discard && (
        <div className="hint">
          <p>存在未保存修改，是否放弃？</p>
          <button onClick={() => setDiscard(false)}>继续编辑</button>
          <button onClick={close}>放弃修改</button>
        </div>
      )}
    </Modal>
  );
}
