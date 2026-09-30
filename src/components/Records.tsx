import {
  ArrowLeft,
  ChevronRight,
  Download,
  Plus,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DocumentRow,
  fields,
  Kind,
  labels,
  reviewers,
  roleNames,
  statuses,
  tools,
} from "../../shared/domain";
import { api, go, money } from "../api";
import { Workflow } from "./Workflow";
import {BusinessData,LineItems} from './BusinessData';
import {
  canWrite,
  costAllowed,
  Empty,
  isManager,
  Modal,
  pageFor,
  User,
} from "../ui";

export const parentKind: Partial<Record<Kind, Kind>> = {
  quote: "proposal",
  contract: "quote",
  project: "contract",
  sample: "project",
  milestone: "project",
  receivable: "project",
  review: "project",
};

export function RecordEditor({
  kind,
  record,
  parent,
  user,
  close,
  saved,
}: {
  kind: Kind;
  record?: DocumentRow;
  parent?: DocumentRow;
  user: User;
  close: () => void;
  saved: (r: DocumentRow) => void;
}) {
  const [title, setTitle] = useState(record?.title || ""),
    [data, setData] = useState<Record<string, any>>(
      record?.data || {
        ...(kind === "quote" && parent ? { samples: parent.data.samples } : {}),
        ...(kind === "lead" ? { company: "" } : {}),
      },
    ),
    [caseId, setCaseId] = useState(record?.caseId || parent?.caseId || ""),
    [parentId, setParentId] = useState(record?.parentId || parent?.id || ""),
    [cases, setCases] = useState<any[]>([]),
    [parents, setParents] = useState<DocumentRow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/cases")
      .then(setCases)
      .catch((e) => setError(e.message));
  }, []);
  const [dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false);
  const requestClose=()=>dirty?setDiscard(true):close();
  useEffect(() => {
    if (!parentKind[kind] || !caseId) return;
    api(
      "/records?kind=" + parentKind[kind] + "&caseId=" + caseId + "&limit=200",
    )
      .then((d) => setParents(d.rows))
      .catch((e) => setError(e.message));
  }, [caseId, kind]);
  return (
    <Modal title={(record ? "编辑" : "新建") + labels[kind]} close={requestClose}>
      <form
        onChange={()=>setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault();
          if(busy)return;
          setBusy(true);
          setError("");
          try {
            const cleaned = Object.fromEntries(
              Object.entries(data).filter(
                ([key]) =>
                  fields[kind].some((f) => f.key === key) &&
                  (costAllowed(user) ||
                    !["unitCost", "centerCost", "riskCost"].includes(key)),
              ),
            );
            const result = await api(
              record ? "/records/" + record.id : "/records",
              record ? "PATCH" : "POST",
              record
                ? { title, data: cleaned, version: record.version }
                : {
                    kind,
                    title,
                    data: cleaned,
                    ...(caseId ? { caseId } : {}),
                    ...(parentId ? { parentId } : {}),
                  },
            );
            saved(result);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          标题
          <input
            autoFocus
            required
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!record && (
          <label>
            关联商机
            <select
              value={caseId}
              required={!["lead", "knowledge", "capability"].includes(kind)}
              onChange={(e) => {
                setCaseId(e.target.value);
                setParentId("");
              }}
            >
              <option value="">请选择（线索 / 知识可暂不关联）</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customer.name} / {c.title}
                </option>
              ))}
            </select>
            <small>
              没有可选商机？先在线索中“转为商机”，或在客户档案中创建业务档案。
            </small>
          </label>
        )}
        {!record && parentKind[kind] && (
          <label>
            前置{labels[parentKind[kind]!]}
            <select
              required
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">请选择满足审核条件的记录</option>
              {parents.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.title} · {statuses[r.status]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind==='quote'&&<section><h3>多单位报价（可选）</h3><p className="hint">有多项服务时增加明细；否则使用下面的单价与样本数。</p><LineItems items={data.lineItems?JSON.parse(data.lineItems):[]} cost={costAllowed(user)} onChange={items=>{setDirty(true);setData({...data,lineItems:items.length?JSON.stringify(items):''});}}/></section>}
        <div className="form-fields">
          {fields[kind]
            .filter(f=>f.key!=='lineItems')
            .filter(
              (f) =>
                costAllowed(user) ||
                !["unitCost", "centerCost", "riskCost"].includes(f.key),
            )
            .map((f) => (
              <label
                key={f.key}
                className={f.type === "textarea" ? "wide" : ""}
              >
                {f.label}
                {f.type === "textarea" ? (
                  <textarea
                    required={
                      f.required &&
                      ![
                        "proposal",
                        "study",
                        "contract",
                        "review",
                        "knowledge",
                      ].includes(kind)
                    }
                    rows={8}
                    value={data[f.key] || ""}
                    onChange={(e) =>
                      setData({ ...data, [f.key]: e.target.value })
                    }
                  />
                ) : f.type === "select" ? (
                  <select
                    aria-label={f.label}
                    value={data[f.key] || ""}
                    onChange={(e) =>
                      setData({ ...data, [f.key]: e.target.value })
                    }
                  >
                    <option value="">请选择</option>
                    {f.options?.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={
                      f.required &&
                      !(
                        kind === "quote" &&
                        data.lineItems &&
                        ["samples", "unitPrice"].includes(f.key)
                      )
                    }
                    type={f.type || "text"}
                    min={f.type === "number" ? 0 : undefined}
                    step={
                      ["samples", "centers"].includes(f.key)
                        ? 1
                        : f.type === "number"
                          ? "0.01"
                          : undefined
                    }
                    value={data[f.key] ?? ""}
                    onChange={(e) =>
                      setData({
                        ...data,
                        [f.key]:
                          f.type === "number" && e.target.value !== ""
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" className="secondary" onClick={requestClose}>
            取消
          </button>
          <button disabled={busy} className="primary">
            {busy ? "保存中…" : "保存记录"}
          </button>
        </div>
      </form>
      {discard&&<div className="hint" role="alert"><p>存在未保存修改。确定放弃吗？</p><button type="button" className="secondary" onClick={()=>setDiscard(false)}>继续编辑</button><button type="button" className="secondary" onClick={close}>放弃修改</button></div>}
    </Modal>
  );
}

export type DetailRow = DocumentRow & {
  files: any[];
  revisions: any[];
  tasks: any[];
  children: DocumentRow[];
};

export function Detail({
  id,
  user,
  epoch,
  edit,
  create,
  done,
  report,
}: {
  id: string;
  user: User;
  epoch: number;
  edit: (r: DocumentRow) => void;
  create: (k: Kind, p: DocumentRow) => void;
  done: (s?: string) => void;
  report: (e: any) => void;
}) {
  const [r, setR] = useState<DetailRow>(),
    [actionModal, setActionModal] = useState<string | null>(null),
    [tool, setTool] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [local, setLocal] = useState(0);
  const load = () =>
    api("/records/" + id)
      .then(setR)
      .catch(report)
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, [id, epoch, local]);
  useEffect(() => {
    if (!r?.tasks.some((t) => ["queued", "processing"].includes(t.status)))
      return;
    const timer = setTimeout(() => setLocal((v) => v + 1), 800);
    return () => clearTimeout(timer);
  }, [r]);
  if (loading) return <p>加载详情…</p>;
  if (!r) return <Empty text="记录不存在或没有访问权限" />;
  const editable =
    [
      "draft",
      "rejected",
      "follow",
      "watch",
      "active",
      "normal",
      "abnormal",
    ].includes(r.status) && !r.archived;
  const can = canWrite(user, r.kind);
  const actions: { id: string; label: string }[] = [];
  if(can&&r.kind==='opportunity'&&!r.archived&&r.status!=='lost')actions.push({id:'followup',label:'记录有效跟进'});
  if (!r.archived) {
    if (can && reviewers[r.kind] && ["draft", "rejected"].includes(r.status))
      actions.push({ id: "submit", label: "提交审核" });
    if (
      r.status === "submitted" &&
      (isManager(user) || user.role === reviewers[r.kind])
    )
      actions.push(
        { id: "approve", label: "审核通过" },
        { id: "reject", label: "退回修改" },
      );
    if (can && r.kind === "lead") {
      if (r.status === "draft")
        actions.push({ id: "convert", label: "转为商机" });
      actions.push({
        id: "favorite",
        label: r.data.favorite ? "取消收藏" : "收藏线索",
      });
    }
    if (
      can &&
      r.kind === "opportunity" &&
      ["draft", "watch", "follow"].includes(r.status)
    )
      actions.push(
        { id: "follow", label: "决定跟进" },
        { id: "watch", label: "暂时观望" },
        { id: "lost", label: "放弃机会" },
      );
    if (can && r.kind === "visit" && r.status === "draft")
      actions.push({ id: "confirm", label: "确认纪要并创建待办" });
    if (can && r.kind === "contract" && r.status === "approved")
      actions.push({ id: "sign", label: "登记签署" });
    if (
      can &&
      ["task", "project", "milestone", "sample"].includes(r.kind) &&
      !["done"].includes(r.status)
    )
      actions.push({ id: "done", label: "完成 / 验收" });
    if (can && r.kind === "sample" && r.status !== "done")
      actions.push({ id: "abnormal", label: "登记异常" });
    if (r.kind === "receivable" && costAllowed(user) && r.status !== "paid")
      actions.push({ id: "receive", label: "确认到账" });
    if (
      can &&
      ["knowledge", "review"].includes(r.kind) &&
      r.status === "approved"
    )
      actions.push({ id: "publish", label: "确认脱敏并发布" });
    if (
      can &&
      ["proposal", "study", "quote"].includes(r.kind) &&
      ["approved", "rejected"].includes(r.status)
    )
      actions.push({ id: "revise", label: "创建修订版" });
    if (isManager(user)) actions.push({ id: "assign", label: "分派负责人" });
    if (can) actions.push({ id: "comment", label: "添加评论" });
    if (
      can &&
      !["receivable", "receipt"].includes(r.kind) &&
      ["draft", "rejected", "done", "lost", "published"].includes(r.status)
    )
      actions.push({ id: "archive", label: "归档" });
  }
  const children: Kind[] =
    r.kind === "opportunity" && r.status === "follow"
      ? ["visit", "proposal", "study"]
      : r.kind === "proposal" && r.status === "approved"
        ? ["quote"]
        : r.kind === "quote" && r.status === "approved"
          ? ["contract"]
          : r.kind === "contract" && r.status === "signed"
            ? ["project"]
            : r.kind === "project"
              ? r.status === "active"
                ? ["sample", "milestone", "receivable"]
                : r.status === "done"
                  ? ["review", "receivable", "maintenance"]
                  : []
              : [];
  return (
    <>
      <button className="back" onClick={() => go(sessionStorage.getItem('last-business-list')||pageFor(r.kind))}>
        <ArrowLeft size={16} />
        返回{labels[r.kind]}列表
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {r.case?.customer.name || "独立记录"} / {labels[r.kind]}
          </p>
          <h1>{r.title}</h1>
          <p className="muted">
            版本 {r.version} · {new Date(r.updatedAt).toLocaleString()}{" "}
            {r.archived ? "· 已归档" : ""}
          </p>
        </div>
        <span className="tag blue">{statuses[r.status]}</span>
      </div>
      <div className="detail-summary"><span><b>当前阶段</b>{(r as any).phase||labels[r.kind]} · {statuses[r.status]}</span><span><b>负责人</b>{(r as any).ownerName||'待分配'}</span><span><b>下一步</b>{r.data.nextAction||({submitted:'等待对应角色审核',approved:'执行下一环节',signed:'创建交付项目',done:'查看结项记录与回款',historical:'核对来源，不执行模拟审批'} as any)[r.status]||'补充业务内容并提交下一环节'}</span><span><b>有效跟进</b>{(r as any).lastFollowUpAt?new Date((r as any).lastFollowUpAt).toLocaleString():'未记录'}</span></div>
      <div className="action-bar">
        {can && editable && r.kind !== "receivable" && (
          <button className="primary" onClick={() => edit(r)}>
            编辑内容
          </button>
        )}
        {actions.map((a) => (
          <button
            className="secondary"
            key={a.id}
            onClick={() => setActionModal(a.id)}
          >
            {a.label}
          </button>
        ))}
        {children
          .filter((k) => canWrite(user, k))
          .map((k) => (
            <button className="primary" key={k} onClick={() => create(k, r)}>
              <Plus size={14} />
              创建{labels[k]}
            </button>
          ))}
        {["docx", "pdf"].map((f) => (
          <a
            className="secondary"
            href={"/api/v1/records/" + id + "/export/" + f}
            target="_blank"
            rel="noreferrer"
            key={f}
          >
            <Download size={13} />
            {f.toUpperCase()}
          </a>
        ))}
      </div>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>业务内容</h2>
              {r.parentId && (
                <button
                  className="link"
                  onClick={() => go("record/" + r.parentId)}
                >
                  查看前置记录 →
                </button>
              )}
            </div>
            {r.data.amountCents !== undefined && (
              <div className="money-strip">
                <span>
                  总金额<b>{money(r.data.amountCents)}</b>
                </span>
                {r.kind === "receivable" && (
                  <>
                    <span>
                      已收<b>{money(r.data.receivedCents || 0)}</b>
                    </span>
                    <span>
                      未收
                      <b>
                        {money(
                          r.data.amountCents - (r.data.receivedCents || 0),
                        )}
                      </b>
                    </span>
                  </>
                )}
                {costAllowed(user) && r.kind === "quote" && (
                  <>
                    <span>
                      成本
                      <b>
                        {r.data.costCents === null
                          ? "未填写"
                          : money(r.data.costCents)}
                      </b>
                    </span>
                    <span>
                      毛利率
                      <b>
                        {r.data.margin === null
                          ? "待核算"
                          : (r.data.margin * 100).toFixed(1) + "%"}
                      </b>
                    </span>
                  </>
                )}
              </div>
            )}
            {r.nature && r.nature !== "daily" && (
              <p className="hint">
                {r.nature === "history"
                  ? "历史档案：缺失信息未推定，审批状态以来源为准"
                  : "演练副本：金额、日期、审批和流水为模拟，不计入经营业绩"}{" "}
                · {r.businessLine}
              </p>
            )}
            {r.nature === "history" && (
              <details open>
                <summary>结构化历史字段与来源</summary>
                <BusinessData data={r.data}/>
                {user.role==='admin'&&<details><summary>管理员调试数据</summary><pre>{JSON.stringify(r.data,null,2)}</pre></details>}
                <button className="link" onClick={() => go("history")}>
                  前往来源核对（管理员）
                </button>
              </details>
            )}
            <dl className="record-data">
              {fields[r.kind]
                .filter(f=>f.key!=='lineItems')
                .filter(
                  (f) =>
                    costAllowed(user) ||
                    !["unitCost", "centerCost", "riskCost"].includes(f.key),
                )
                .map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{String(r.data[f.key] ?? "—")}</dd>
                  </div>
                ))}
            </dl>
            {r.data.lineItems&&<LineItems items={JSON.parse(r.data.lineItems)} cost={costAllowed(user)} readOnly/>}
            {r.data.evaluation && (
              <p className="hint">评估依据：{r.data.evaluation}</p>
            )}
            {r.data.issue && <p className="error">异常记录：{r.data.issue}</p>}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>关联业务与行动项</h2>
            </div>
            {r.children.map((c) => (
              <button
                className="task row-link"
                key={c.id}
                onClick={() => go("record/" + c.id)}
              >
                <div>
                  <b>{c.title}</b>
                  <small>
                    {labels[c.kind]} · {statuses[c.status]}
                  </small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
            {!r.children.length && <p className="muted">暂无下游记录。</p>}
          </section>
          <Workflow record={r} />
          <section className="panel">
            <div className="panel-head">
              <h2>文件与解析</h2>
            </div>
            {r.kind === "quote" && !costAllowed(user) && (
              <p className="hint">
                报价附件由财务管理；可使用上方按钮导出销售报价。
              </p>
            )}
            {can &&
              !r.archived &&
              (r.kind !== "quote" || costAllowed(user)) && (
                <label className="upload">
                  上传 PDF / DOCX / TXT / 录音（≤20MB）
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.mp3,.wav,.m4a"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const form = new FormData();
                      form.append("file", f);
                      try {
                        await api("/records/" + id + "/files", "POST", form);
                        done("文件已保存");
                      } catch (e) {
                        report(e);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            {r.files.map((f) => (
              <details className="file-row" key={f.id}>
                <summary>
                  {f.name}{" "}
                  <span className="muted">
                    {
                      (
                        {
                          parsed: "已提取文字",
                          parse_failed: "解析失败：请人工补录",
                          needs_manual_text: "未提取到文字：扫描件请人工补录",
                          transcription_unconfigured:
                            "语音服务未配置，仅保存录音",
                        } as any
                      )[f.parseStatus]
                    }
                  </span>
                </summary>
                <div className="action-bar">
                  <a href={"/api/v1/files/" + f.id} target="_blank">
                    下载原件
                  </a>
                  {f.mime.startsWith("application/pdf") && (
                    <a
                      href={"/api/v1/files/" + f.id + "?preview=1"}
                      target="_blank"
                    >
                      预览 PDF
                    </a>
                  )}
                </div>
                <pre>{f.text || "没有可用的解析文本。"}</pre>
              </details>
            ))}
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>
                <Sparkles size={16} /> 辅助工具
              </h2>
            </div>
            <p className="hint">
              当前使用演示模板与规则，结果须人工核验，不连接外部模型。
            </p>
            {tools
              .filter((t) => t[2] === r.kind)
              .map((t) => (
                <button
                  disabled={!can || r.archived}
                  className="tool-launch"
                  key={t[0]}
                  onClick={() => setTool(t[0])}
                >
                  {t[1]}
                  <ChevronRight size={15} />
                </button>
              ))}
            {!tools.some((t) => t[2] === r.kind) && (
              <p className="muted">此业务使用标准表单处理。</p>
            )}
            {r.tasks.map((t) => (
              <AiResult
                key={t.id + ":" + t.status}
                task={t}
                record={r}
                writable={can && editable}
                done={done}
                report={report}
              />
            ))}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>版本与操作历史</h2>
            </div>
            <div className="timeline">
              {r.revisions.map((v) => (
                <details key={v.id}>
                  <summary>
                    v{v.version} → v{v.version + 1} · {v.action}
                    <small>{new Date(v.createdAt).toLocaleString()}</small>
                  </summary>
                  <p>{v.comment || "无附加说明"}</p>
                  <BusinessData data={v.snapshot.data}/>
                </details>
              ))}
              {!r.revisions.length && (
                <p className="muted">首次创建，尚无变更。</p>
              )}
            </div>
          </section>
        </div>
      </div>
      {actionModal && (
        <ActionModal
          action={actionModal}
          record={r}
          close={() => setActionModal(null)}
          done={(result) => {
            setActionModal(null);
            done("业务操作已完成");
            if (result.id !== id) go("record/" + result.id);
          }}
        />
      )}
      {tool && (
        <ToolModal
          tool={tool}
          record={r}
          close={() => setTool(null)}
          done={() => {
            setTool(null);
            done("任务已创建");
          }}
        />
      )}
    </>
  );
}

export function ActionModal({
  action,
  record,
  close,
  done,
}: {
  action: string;
  record: DocumentRow;
  close: () => void;
  done: (r: DocumentRow) => void;
}) {
  const [comment, setComment] = useState(""),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [signer, setSigner] = useState(""),
    [date, setDate] = useState(""),
    [userId, setUserId] = useState(""),
    [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (action === "assign")
      api("/management/assignees/"+record.id)
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [action]);
  return (
    <Modal title="确认业务操作" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            done(
              await api("/records/" + record.id + "/actions", "POST", {
                action,
                version: record.version,
                comment:
                  action === "sign"
                    ? JSON.stringify({ signer, signedDate: date })
                    : comment,
                ...(action === "receive"
                  ? { amount: Number(amount), reference }
                  : {}),
                ...(action === "assign" ? { userId } : {}),
              }),
            );
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="hint">
          {record.title} · 当前版本 {record.version}
          <br />
          {action === "publish"
            ? "请确认内容已脱敏并适合团队复用。"
            : action === "archive"
              ? "归档后记录退出活动列表，历史审计保留。"
              : "本次操作将保存到业务历史。"}
        </p>
        {action === "receive" && (
          <>
            <label>
              到账金额（元）
              <input
                required
                type="number"
                min=".01"
                step=".01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              银行流水号
              <input
                required
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </>
        )}
        {action === "sign" && (
          <>
            <label>
              签署人
              <input
                required
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
              />
            </label>
            <label>
              签署日期
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </>
        )}
        {action === "assign" && (
          <label>
            负责人
            <select
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">请选择</option>
              {users.map((u) => (
                <option value={u.id} key={u.id}>
                  {u.name} · {roleNames[u.role]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          操作说明 / 审核意见
          <textarea
            required={[
              "reject",
              "follow",
              "watch",
              "lost",
              "abnormal",
              "comment",
            ].includes(action)}
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button className="secondary" type="button" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            确认操作
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ToolModal({
  tool,
  record,
  close,
  done,
}: {
  tool: string;
  record: DocumentRow;
  close: () => void;
  done: () => void;
}) {
  const [input, setInput] = useState(record.data.notes || record.title),
    [error, setError] = useState("");
  return (
    <Modal title={tools.find((t) => t[0] === tool)![1]} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          api("/ai", "POST", { recordId: record.id, tool, input })
            .then(done)
            .catch((e) => setError(e.message));
        }}
      >
        <p className="hint">
          演示 Provider：结构化模板与本地规则。生成结果不会自动写入业务。
        </p>
        <label>
          {tool === "knowledge" ? "搜索关键词（空格分隔）" : "需求与补充信息"}
          <textarea
            required
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary">生成待确认结果</button>
      </form>
    </Modal>
  );
}

export function AiResult({
  task,
  record,
  writable,
  done,
  report,
}: {
  task: any;
  record: DocumentRow;
  writable: boolean;
  done: (s?: string) => void;
  report: (e: any) => void;
}) {
  const [output, setOutput] = useState(task.output);
  return (
    <details className="ai-result" open={task.status === "succeeded"}>
      <summary>
        {tools.find((t) => t[0] === task.tool)?.[1]} ·{" "}
        {
          (
            {
              queued: "排队中",
              processing: "处理中",
              succeeded: "待确认",
              failed: "失败",
              confirmed: "已确认",
            } as any
          )[task.status]
        }
      </summary>
      <p className="hint">
        来源 {task.source} · 尝试 {task.attempts} 次
      </p>
      {task.error && <p className="error">{task.error}</p>}
      {task.output && (
        <textarea
          aria-label="工具生成结果"
          rows={12}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          readOnly={!writable || task.status === "confirmed"}
        />
      )}
      <div className="action-bar">
        {task.status === "succeeded" && writable && (
          <button
            className="primary"
            onClick={() =>
              api("/ai/" + task.id + "/confirm", "POST", {
                output,
                version: record.version,
              })
                .then(() => done("已确认并写入正文"))
                .catch(report)
            }
          >
            确认写入正文
          </button>
        )}
        {task.status === "failed" && writable && (
          <button
            className="secondary"
            onClick={() =>
              api("/ai/" + task.id + "/retry", "POST")
                .then(() => done("重新排队"))
                .catch(report)
            }
          >
            重试任务
          </button>
        )}
      </div>
    </details>
  );
}
