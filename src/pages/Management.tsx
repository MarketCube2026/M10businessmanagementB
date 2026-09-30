import { useEffect, useState } from "react";
import { api, go, money } from "../api";
import { Modal, User, isManager } from "../ui";
import { labels, statuses, roleNames } from "../../shared/domain";
import { extensionLabels } from "../../shared/extensions";
const kinds: any = { ...labels, ...extensionLabels };
const statusNames: any = {
  ...statuses,
  completed: "已验收",
  closed: "已关闭",
  passed: "已通过",
  retained: "展示中",
  running: "执行中",
  ready: "待执行",
  failed: "失败",
};
export function Management({
  user,
  mode = "overview",
}: {
  user: User;
  mode?: string;
}) {
  const key = "management-filters-" + user.id;
  const [filters, setFilters] = useState<any>(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || '{"nature":"daily"}');
      } catch {
        return { nature: "daily" };
      }
    }),
    [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [users, setUsers] = useState<any[]>([]),
    [customers, setCustomers] = useState<any[]>([]),
    [epoch, setEpoch] = useState(0),
    [action, setAction] = useState<any>(),
    [report, setReport] = useState<any>(),
    [reports, setReports] = useState<any[]>([]),
    [drill, setDrill] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = () => setEpoch((n) => n + 1);
  const failure = (e: any) => setError(e.message);
  useEffect(() => {
    sessionStorage.setItem(key, JSON.stringify(filters));
    let active = true;
    api(
      "/management?" +
        new URLSearchParams(
          Object.entries(filters).filter(([, v]) => !!v) as any,
        ),
    )
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch(failure);
    return () => {
      active = false;
    };
  }, [filters, epoch]);
  useEffect(() => {
    Promise.all([api("/users"), api("/customers")])
      .then(([u, c]) => {
        setUsers(u);
        setCustomers(c);
      })
      .catch(failure);
    if (isManager(user))
      api("/management/reports").then(setReports).catch(failure);
  }, [epoch]);
  const set = (k: string, v: string) => setFilters({ ...filters, [k]: v });
  const generate = async () => {
    setBusy(true);
    try {
      setReport(await api("/management/reports", "POST", filters));
      reload();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };
  const tableRows = drill
    ? data?.rows.filter((r: any) =>
        drill.startsWith("stage:")
          ? r.kind === "opportunity" && r.phase === drill.slice(6)
          : drill === "contract"
            ? r.kind === "contract" && r.status === "signed"
            : drill === "project"
              ? r.kind === "project" && r.status === "active"
              : drill === "opportunity"
                ? r.kind === "opportunity" &&
                  !["已签", "丢单"].includes(r.phase)
                : ["pending", "overdue"].includes(drill)
                  ? r.kind === "receivable" &&
                    r.data.amountCents > (r.data.receivedCents || 0) &&
                    (drill !== "overdue" ||
                      r.data.dueDate < new Date().toISOString().slice(0, 10))
                  : r.kind === drill,
      )
    : [];
  return (
    <>
      <div className="welcome">
        <div>
          <p className="eyebrow">
            {isManager(user) ? "TEAM OPERATIONS" : "MY WORKSPACE"} ·{" "}
            {new Date().toLocaleDateString()}
          </p>
          <h1>你好，{user.name}</h1>
          <p className="muted">
            {isManager(user)
              ? "先处理风险与决策，再推进团队下一步。"
              : "查看分配给你的任务和本角色待审批事项。"}
          </p>
        </div>
        <div className="action-bar">
          {isManager(user) && (
            <button
              className="primary"
              disabled={busy || !data}
              onClick={generate}
            >
              {busy ? "生成中…" : "生成经营周报"}
            </button>
          )}
          <button className="secondary" onClick={() => go("guide")}>
            负责人使用指南
          </button>
        </div>
      </div>
      <div className="filters manager-filters">
        <label>
          数据范围
          <select
            aria-label="数据范围"
            value={filters.nature}
            onChange={(e) => set("nature", e.target.value)}
          >
            <option value="daily">日常业务</option>
            <option value="scenario">演练数据</option>
            <option value="history">历史档案</option>
          </select>
        </label>
        <label>
          业务线
          <select
            aria-label="业务线筛选"
            value={filters.businessLine || ""}
            onChange={(e) => set("businessLine", e.target.value)}
          >
            <option value="">全部</option>
            <option>PB</option>
            <option>SR</option>
          </select>
        </label>
        <label>
          负责人
          <select
            aria-label="负责人筛选"
            value={filters.ownerId || ""}
            onChange={(e) => set("ownerId", e.target.value)}
          >
            <option value="">全部授权成员</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          客户
          <select
            aria-label="客户筛选"
            value={filters.customerId || ""}
            onChange={(e) => set("customerId", e.target.value)}
          >
            <option value="">全部授权客户</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          创建日期从
          <input
            aria-label="创建日期从"
            type="date"
            value={filters.from || ""}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label>
          至
          <input
            aria-label="创建日期至"
            type="date"
            value={filters.to || ""}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() => setFilters({ nature: "daily" })}
        >
          清除筛选
        </button>
      </div>
      {filters.nature !== "daily" && (
        <p className="scope-banner">
          {filters.nature === "scenario"
            ? "当前查看演练数据，所有模拟金额和审批不计入日常经营指标。"
            : "当前查看历史档案，未知金额及未证实审批不计入正式经营业绩。"}
        </p>
      )}
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button onClick={reload}>重试</button>
        </div>
      )}
      {!data ? (
        <p>正在加载工作台…</p>
      ) : (
        <>
          <div className="kpis">
            {[
              ["进行中商机", data.opportunities, "opportunity"],
              ["已签合同额", money(data.signedCents), "contract"],
              ["交付中项目", data.projects, "project"],
              ["待回款余额", money(data.pendingCents), "pending"],
              ["逾期回款", money(data.overdueCents), "overdue"],
            ].map(([name, value, k]) => (
              <button className="kpi" key={name} onClick={() => setDrill(k)}>
                <div className="kpi-top">{name} ↗</div>
                <strong>{value}</strong>
                <small className="blue">同口径明细</small>
              </button>
            ))}
          </div>
          <p className="muted">
            口径：{data.dateBasis}。订单 {money(data.workflowTotals.order)} /
            结算 {money(data.workflowTotals.settlement)} / 开票{" "}
            {money(data.workflowTotals.invoice)} / 实收{" "}
            {money(data.receivedCents)}，分别统计，不相加。
          </p>
          {drill && (
            <section className="panel drill">
              <div className="panel-head">
                <h2>指标明细 · 保留当前筛选</h2>
                <button onClick={() => setDrill("")}>收起</button>
              </div>
              <BusinessRows rows={tableRows} />
            </section>
          )}
          <div className="tabs manager-tabs">
            {[
              ["overview", "团队概览"],
              ["approvals", "待审批 " + data.approvals.length],
              ["tasks", "待办 " + data.tasks.length],
              ["risks", "风险 " + data.risks.length],
              ["reports", "经营周报"],
            ]
              .filter(([k]) => k !== "reports" || isManager(user))
              .map(([k, n]) => (
                <button
                  key={k}
                  className={mode === k ? "selected" : ""}
                  onClick={() => go("management?view=" + k)}
                >
                  {n}
                </button>
              ))}
          </div>
          {mode === "overview" && (
            <section className="panel">
              <div className="panel-head">
                <h2>商机阶段</h2>
                <span className="muted">依据关联业务计算，独立于审批状态</span>
              </div>
              <div className="stage-grid">
                {Object.entries(data.stageCounts).map(([s, n]) => (
                  <button key={s} onClick={() => setDrill("stage:" + s)}>
                    <b>{s}</b>
                    <strong>{String(n)}</strong>
                  </button>
                ))}
              </div>
            </section>
          )}
          {(mode === "overview" || mode === "approvals") && (
            <section className="panel">
              <div className="panel-head">
                <h2>待我审批</h2>
                <span className="muted">仅显示当前角色可审核的记录；概览最多6项</span>
              </div>
              {data.approvals.length ? (
                data.approvals.slice(0,mode==='overview'?6:undefined).map((r: any) => (
                  <div className="task" key={r.type + r.id}>
                    <div>
                      <b>{r.title}</b>
                      <small>
                        {kinds[r.kind]} · 申请人 {r.requester} · v{r.version}
                      </small>
                    </div>
                    <button
                      className="link"
                      onClick={() => go("record/" + r.recordId)}
                    >
                      查看依据
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setAction({ type: "approve", row: r })}
                    >
                      审核
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  暂无待审。BD提交方案、报价或合同后，会流转给对应审核角色。
                </p>
              )}
            </section>
          )}
          {(mode === "overview" || mode === "risks") && (
            <section className="panel">
              <div className="panel-head">
                <h2>风险与跟进</h2>
                {isManager(user) && (
                  <button
                    className="link"
                    onClick={() => setAction({ type: "settings" })}
                  >
                    停滞阈值 {data.threshold} 天
                  </button>
                )}
              </div>
              {data.risks.length ? (
                data.risks.slice(0,mode==='overview'?6:undefined).map((r: any) => (
                  <div className="task" key={r.key}>
                    <span className="dot orange" />
                    <div>
                      <b>{r.title}</b>
                      <small>
                        {r.type} · {r.ownerName} · {r.note}
                      </small>
                      {r.handling?.[0] && (
                        <small>
                          已安排处理：{r.handling[0].note} ·{" "}
                          {r.handling[0].dueDate}；条件仍存在，继续提醒
                        </small>
                      )}
                    </div>
                    <button
                      className="link"
                      onClick={() => go("record/" + r.recordId)}
                    >
                      查看
                    </button>
                    {isManager(user) && (
                      <button
                        className="secondary"
                        onClick={() => setAction({ type: "risk", row: r })}
                      >
                        安排处理
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">
                  当前范围暂无风险。历史档案不自动变为逾期任务。
                </p>
              )}
            </section>
          )}
          {(mode === "tasks" || mode === "overview") && (
            <section className="panel">
              <h2>{isManager(user) ? "团队待办" : "我的待办"}</h2>
              {data.tasks.slice(0,mode==='overview'?6:undefined).map((r: any) => (
                <div className="task" key={r.id}>
                  <div>
                    <b>{r.title}</b>
                    <small>
                      {r.ownerName} · 截止 {r.data.dueDate || "未填写"}
                    </small>
                  </div>
                  <button className="link" onClick={() => go("record/" + r.id)}>
                    查看
                  </button>
                  {isManager(user) && (
                    <button
                      className="secondary"
                      onClick={() => setAction({ type: "assign", row: r })}
                    >
                      分派
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={() => setAction({ type: "postpone", row: r })}
                  >
                    延期
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setAction({ type: "done", row: r })}
                  >
                    完成
                  </button>
                </div>
              ))}
              {!data.tasks.length && (
                <p className="muted">
                  暂无待办。确认拜访纪要后会自动创建下一步行动。
                </p>
              )}
            </section>
          )}
          {mode === "reports" && (
            <section className="panel">
              <h2>我的经营周报</h2>
              {reports.map((r) => (
                <div className="task" key={r.id}>
                  <div>
                    <b>
                      {r.title} · {new Date(r.createdAt).toLocaleDateString()}
                    </b>
                    <small>版本 {r.version}</small>
                  </div>
                  <button className="secondary" onClick={() => setReport(r)}>
                    编辑与导出
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {action && (
        <ManagementAction
          action={action}
          nature={filters.nature}
          close={() => setAction(null)}
          saved={() => {
            setAction(null);
            reload();
          }}
        />
      )}
      {report && (
        <Modal title="经营周报 · 可编辑草稿" close={() => setReport(null)}>
          <textarea
            aria-label="周报正文"
            rows={18}
            value={report.content}
            onChange={(e) => setReport({ ...report, content: e.target.value })}
          />
          <div className="action-bar">
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/management/reports/" + report.id, "PATCH", {
                    content: report.content,
                    version: report.version,
                  });
                  setReport({ ...report, version: report.version + 1 });
                  reload();
                } catch (e) {
                  failure(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存修改
            </button>
            <a
              className="secondary"
              href={"/api/v1/management/reports/" + report.id + "/export"}
            >
              导出已保存Word
            </a>
          </div>
          <p className="hint">
            正文包含记录ID，点击工作台明细可核验来源。缺失数据不自动补造。
          </p>
        </Modal>
      )}
    </>
  );
}
export function BusinessRows({ rows }: { rows: any[] }) {
  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <th>业务</th>
            <th>负责人</th>
            <th>阶段 / 状态</th>
            <th>金额（应收显示未收余额）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="record-title"
                  onClick={() => go("record/" + r.id)}
                >
                  {r.title}
                </button>
                <small>{r.case?.customer?.name}</small>
              </td>
              <td>{r.ownerName || "—"}</td>
              <td>
                {r.phase || ""} / {statusNames[r.status] || r.status}
              </td>
              <td>
                {r.data.amountCents !== undefined
                  ? money(r.kind==='receivable'?r.data.amountCents-(r.data.receivedCents||0):r.data.amountCents)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="hint">当前筛选下没有对应记录。</p>}
    </div>
  );
}
function ManagementAction({ action, nature, close, saved }: any) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [users, setUsers] = useState<any[]>([]);
  const r = action.row;
  useEffect(() => {
    if (["risk", "assign"].includes(action.type))
      api("/management/assignees/" + (r.recordId || r.id))
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, []);
  return (
    <Modal
      title={
        {
          risk: "安排风险处理",
          approve: "业务审核",
          assign: "任务分派",
          postpone: "任务延期",
          done: "完成任务",
          settings: "停滞提醒规则",
        }[action.type as string] || "处理"
      }
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const f = Object.fromEntries(new FormData(e.currentTarget));
          try {
            if (action.type === "settings")
              await api("/management/settings", "POST", {
                stagnantDays: Number(f.days),
              });
            else if (action.type === "risk")
              await api("/management/risks", "POST", {
                key: r.key,
                recordId: r.recordId,
                assigneeId: f.assigneeId,
                dueDate: f.dueDate,
                note: f.note,
                nature,
              });
            else if (action.type === "approve")
              await api(
                r.type === "workflow"
                  ? "/workflow/" + r.id + "/actions"
                  : "/records/" + r.id + "/actions",
                "POST",
                { version: r.version, action: f.decision, comment: f.note },
              );
            else if (action.type === "done")
              await api("/records/" + r.id + "/actions", "POST", {
                version: r.version,
                action: "done",
                comment: f.note,
              });
            else
              await api("/management/tasks/" + r.id, "POST", {
                version: r.version,
                action: action.type,
                assigneeId: f.assigneeId,
                dueDate: f.dueDate,
                note: f.note,
              });
            saved();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {r && (
          <p className="hint">
            {r.title}
            {r.note ? " · " + r.note : ""}
          </p>
        )}
        {action.type === "settings" ? (
          <label>
            无有效跟进天数
            <input
              name="days"
              type="number"
              min="1"
              max="180"
              defaultValue="14"
              required
            />
          </label>
        ) : (
          <>
            {["risk", "assign"].includes(action.type) && (
              <label>
                负责人
                <select aria-label="负责人" name="assigneeId" required>
                  <option value="">选择已有客户权限的成员</option>
                  {users.map((u) => (
                    <option value={u.id} key={u.id}>
                      {u.name} · {roleNames[u.role as keyof typeof roleNames]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {["risk", "postpone"].includes(action.type) && (
              <label>
                截止日期
                <input name="dueDate" type="date" required />
              </label>
            )}
            {action.type === "approve" && (
              <label>
                审核决定
                <select aria-label="审核决定" name="decision">
                  <option value="approve">通过</option>
                  <option value="reject">退回修改</option>
                </select>
              </label>
            )}
            <label>
              处理说明
              <textarea name="note" rows={4} required />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "处理中…" : "确认处理"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ManagerGuide() {
  return (
    <section className="panel">
      <h1>BD负责人使用指南</h1>
      <h2>每天早上：风险和决策</h2>
      <p>
        工作台默认显示日常业务。先查看逾期回款、待审批和风险，点击“安排处理”指定已授权成员、截止日期及要求。处理记录不会掩盖仍存在的风险。
      </p>
      <h2>日常：推进下一步</h2>
      <p>
        从客户或商机详情查看当前阶段、下一步动作与责任人。拜访纪要确认后生成待办；普通编辑不算有效跟进，使用“记录有效跟进”或确认拜访纪要。
      </p>
      <h2>周会：按团队口径复盘</h2>
      <p>
        选择PB/SR、成员、客户及创建日期范围，再生成经营周报。签约、订单、结算、开票和到账分别统计；预计金额不当作收入。指标卡点击后展示同一筛选下明细。
      </p>
      <h2>演练与历史</h2>
      <p>
        切换“演练数据”体验30套不同阶段的业务；原有5套案例继续保留。历史档案保持原始证据状态，不可直接作为审批流程推进。
      </p>
      <h2>权限与分工</h2>
      <p>
        主管先在客户档案授权，再分派任务。BD提交，技术审方案，法务审合同，财务审报价并确认回款，交付人员验收；原件及历史核对仍限管理员。
      </p>
    </section>
  );
}
export function RandomCases() {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  const [resetBatch,setResetBatch]=useState<string|null>(null),[busy,setBusy]=useState(false);
  useEffect(() => {
    api("/random-runs")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <h1>30套随机业务演练</h1>
      <p className="scope-banner">
        固定随机种子，可复现。不同阶段案例供操作体验；完整30轮验收在独立测试库执行，报告另行保存。
      </p>
      {error && <p className="error">{error}</p>}
      <details className="panel"><summary>批次维护（只影响指定演练数据）</summary>{Array.from(new Set(rows.filter(r=>r.status!=='reset').map(r=>r.batch))).map(batch=><button key={batch} className="secondary" onClick={()=>setResetBatch(batch)}>重置 {batch}</button>)}</details>
      {resetBatch&&<Modal title="重置指定演练批次" close={()=>setResetBatch(null)}><p className="hint">将备份并清理此批次演练记录，历史资料和日常业务不受影响。执行证据保留。</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);const f=new FormData(e.currentTarget);try{await api('/random-runs/reset','POST',{batch:resetBatch,confirmation:f.get('confirmation')});setResetBatch(null);setRows(await api('/random-runs'));}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><label>输入 RESET {resetBatch}<input required name="confirmation"/></label><button className="primary" disabled={busy}>确认重置该批次</button></form></Modal>}
      <div className="tool-grid">
        {rows.filter(r=>r.caseId).map((r) => (
          <section className="panel" key={r.id}>
            <h2>
              {r.index + 1}. {r.type}
            </h2>
            <p>
              种子 {r.seed} ·{" "}
              {
                {
                  early: "前期商机",
                  approval: "待审批",
                  delivery: "交付中",
                  partial: "部分回款",
                  complete: "已结项",
                }[r.target as string]
              }{" "}
              · {statusNames[r.status]}
            </p>
            <button
              className="primary"
              onClick={() => go("scenario-records/" + r.caseId)}
            >
              进入案例记录
            </button>
            <details>
              <summary>流程证据 · {JSON.parse(r.steps).length} 步</summary>
              {JSON.parse(r.steps).map((s: any, i: number) => (
                <p key={i}>
                  {i + 1}. {(roleNames as any)[s.role]||s.role} · {s.status>=400?'异常操作已被正确拦截':s.method==='get'?'已核验业务数据':s.method==='patch'?'已保存业务修改':'已完成业务操作'}{" "}
                  {s.recordId && /^\/records(\/|$)/.test(s.url)&&!s.url.includes('/actions') && (
                    <button
                      className="link"
                      onClick={() => go("record/" + s.recordId)}
                    >
                      查看
                    </button>
                  )}
                </p>
              ))}
            </details>
          </section>
        ))}
      </div>
    </>
  );
}
