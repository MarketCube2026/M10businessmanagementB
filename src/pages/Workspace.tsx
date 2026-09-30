import { ChevronRight, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import {
  DocumentRow,
  Kind,
  labels,
  roleNames,
  statuses,
  tools,
} from "../../shared/domain";
import { api, go, money } from "../api";
import {
  canWrite,
  Empty,
  isManager,
  Modal,
  Page,
  pageFor,
  pages,
  User,
} from "../ui";

export function Dashboard({
  epoch,
  user,
  report,
}: {
  epoch: number;
  user: User;
  report: (e: any) => void;
}) {
  const [d, setD] = useState<any>();
  useEffect(() => {
    api("/dashboard").then(setD).catch(report);
  }, [epoch]);
  if (!d) return <p>加载工作台…</p>;
  return (
    <>
      <div className="welcome">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString("zh-CN", { dateStyle: "full" })}
          </p>
          <h1>你好，{user.name}</h1>
          <p className="muted">
            今天有 {d.tasks.length} 项待办，{d.alerts.length} 项业务预警。
          </p>
        </div>
        <button className="primary" onClick={() => go("tools")}>
          <Sparkles size={17} /> 打开工具中心
        </button>
      </div>
      <div className="kpis">
        {[
          ["进行中商机", d.opportunities, "opportunities"],
          ["已签合同额", money(d.signedCents), "contracts"],
          ["交付中项目", d.projects, "projects"],
          ["待回款余额", money(d.pendingCents), "payments"],
        ].map(([label, value, route]) => (
          <button className="kpi" key={label} onClick={() => go(route)}>
            <div className="kpi-top">
              {label}
              <ChevronRight size={16} />
            </div>
            <strong>{value}</strong>
            <small className="blue">查看业务明细 →</small>
          </button>
        ))}
      </div>
      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>业务全景</h2>
            <span className="muted">当前可见业务</span>
          </div>
          <div className="stage-grid">
            {pages
              .filter((p) => /0[1-9]/.test(p.name))
              .map((p) => (
                <button key={p.id} onClick={() => go(p.id)}>
                  <p.icon size={19} />
                  <b>{p.name}</b>
                  <strong>
                    {p.kinds.reduce((s, k) => s + (d.counts[k] || 0), 0)}
                  </strong>
                </button>
              ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>待办与风险预警</h2>
            <span className="tag orange">{d.alerts.length} 项提醒</span>
          </div>
          {[...d.alerts, ...d.tasks]
            .slice(0, 12)
            .map((r: DocumentRow, i: number) => (
              <button
                className="task row-link"
                key={r.id + i}
                onClick={() => go("record/" + r.id)}
              >
                <span className="dot orange" />
                <div>
                  <b>{r.title}</b>
                  <small>
                    {labels[r.kind]} · {r.data.dueDate || "异常待处理"}
                  </small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
          {!d.alerts.length && !d.tasks.length && (
            <Empty text="暂无待处理事项，新增业务后在此跟踪。" />
          )}
        </section>
      </div>
    </>
  );
}

export function RecordList({
  page,
  user,
  epoch,
  report,
  openCreate,
  search,
  caseFilter,
}: {
  page?: Page;
  user: User;
  epoch: number;
  report: (e: any) => void;
  openCreate: (k: Kind) => void;
  search?: string;
  caseFilter?: string;
}) {
  const storageKey='business-list-'+user.id+'-'+(page?.id||caseFilter||'search');
  const [initial]=useState<any>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}');}catch{return {};}});
  const [kind, setKind] = useState<Kind | undefined>(initial.kind||page?.kinds[0]),
    [rows, setRows] = useState<DocumentRow[]>([]),
    [q, setQ] = useState(search || initial.q||""),
    [status, setStatus] = useState(initial.status||""),
    [number, setNumber] = useState<number>(initial.number||1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [board, setBoard] = useState(false),
    [csv, setCsv] = useState(false);
  const [nature, setNature] = useState(initial.nature||(caseFilter ? "scenario" : "")),
    [businessLine, setBusinessLine] = useState(initial.businessLine||"");
  const [ownerId, setOwnerId] = useState(initial.ownerId||""),
    [customerId, setCustomerId] = useState(initial.customerId||""),
    [owners, setOwners] = useState<User[]>([]),
    [customers, setCustomers] = useState<any[]>([]);
  useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify({kind,q,status,number,nature,businessLine,ownerId,customerId}));sessionStorage.setItem('last-business-list',location.hash.slice(1));},[kind,q,status,number,nature,businessLine,ownerId,customerId]);
  useEffect(()=>{const y=Number(sessionStorage.getItem(storageKey+'-scroll')||0);const t=setTimeout(()=>window.scrollTo(0,y),100);const save=()=>sessionStorage.setItem(storageKey+'-scroll',String(window.scrollY));addEventListener('scroll',save);return()=>{clearTimeout(t);removeEventListener('scroll',save);};},[]);
  useEffect(() => {
    Promise.all([api("/users"), api("/customers")])
      .then(([u, c]) => {
        setOwners(u);
        setCustomers(c);
      })
      .catch(report);
  }, [epoch]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      q,
      status,
      page: String(number),
      limit: "20",
    });
    if (!status) params.delete("status");
    if (kind) params.set("kind", kind);
    if (ownerId) params.set("ownerId", ownerId);
    if (customerId) params.set("customerId", customerId);
    if (caseFilter) params.set("caseId", caseFilter);
    if (nature) params.set("nature", nature);
    if (businessLine) params.set("businessLine", businessLine);
    let current = true;
    api("/records?" + params)
      .then((d) => {
        if (current) {
          setRows(d.rows);
          setTotal(d.total);
        }
      })
      .catch(report)
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    epoch,
    kind,
    q,
    status,
    number,
    ownerId,
    customerId,
    nature,
    businessLine,
    caseFilter,
  ]);
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {page?.kinds.map((k) => (
            <button
              key={k}
              className={kind === k ? "selected" : ""}
              onClick={() => {
                setKind(k);
                setNumber(1);
              }}
            >
              {labels[k]}
            </button>
          ))}
          {!page && <h2>全局搜索</h2>}
        </div>
        {kind &&
          canWrite(user, kind) &&
          !["receipt", "opportunity"].includes(kind) && (
            <button className="primary" onClick={() => openCreate(kind)}>
              <Plus size={16} />
              新建{labels[kind]}
            </button>
          )}
      </div>
      <div className="filters">
        <select
          aria-label="数据性质"
          value={nature}
          onChange={(e) => {
            setNature(e.target.value);
            setNumber(1);
          }}
        >
          <option value="">全部数据性质</option>
          <option value="daily">日常业务</option>
          <option value="history">历史档案</option>
          <option value="scenario">演练案例</option>
        </select>
        <select
          aria-label="业务线筛选"
          value={businessLine}
          onChange={(e) => {
            setBusinessLine(e.target.value);
            setNumber(1);
          }}
        >
          <option value="">PB + SR</option>
          <option>PB</option>
          <option>SR</option>
        </select>
        <label className="filter-input">
          <Search size={16} />
          <input
            aria-label="搜索标题"
            placeholder="搜索标题…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setNumber(1);
            }}
          />
        </label>
        <select
          aria-label="状态筛选"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setNumber(1);
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(statuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {kind === "lead" && canWrite(user, kind) && (
          <button className="secondary" onClick={() => setCsv(true)}>
            导入 CSV
          </button>
        )}
        {kind === "project" && (
          <button className="secondary" onClick={() => setBoard(!board)}>
            {board ? "列表视图" : "看板视图"}
          </button>
        )}
        <span className="muted">{total} 条记录</span>
      </div>
      <div className="filters">
        <select
          aria-label="负责人筛选"
          value={ownerId}
          onChange={(e) => {
            setOwnerId(e.target.value);
            setNumber(1);
          }}
        >
          <option value="">全部负责人</option>
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          aria-label="客户筛选"
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setNumber(1);
          }}
        >
          <option value="">全部客户</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p>正在加载…</p>
      ) : board ? (
        <div className="kanban">
          {["active", "done"].map((s) => (
            <section className="panel" key={s}>
              <h2>{statuses[s]}</h2>
              {rows
                .filter((r) => r.status === s)
                .map((r) => (
                  <button
                    className="board-card"
                    key={r.id}
                    onClick={() => go("record/" + r.id)}
                  >
                    <b>{r.title}</b>
                    <p>{r.case?.customer.name}</p>
                    <small>计划 {r.data.dueDate}</small>
                  </button>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>名称 / 客户</th>
                <th>状态</th>
                <th>金额 / 计划日期</th>
                <th>最近更新</th>
                <th />
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
                      {r.data.favorite ? "★ " : ""}
                      {r.title}
                    </button>
                    <small>
                      {r.case?.customer.name || "独立记录"} · {labels[r.kind]}
                    </small>
                  </td>
                  <td>
                    <span
                      className={
                        "tag " +
                        (["rejected", "abnormal"].includes(r.status)
                          ? "orange"
                          : "blue")
                      }
                    >
                      {statuses[r.status] || r.status}
                    </span>
                  </td>
                  <td>
                    {r.data.amountCents !== undefined
                      ? money(r.data.amountCents)
                      : r.data.dueDate || "—"}
                  </td>
                  <td>{new Date(r.updatedAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      aria-label={"打开" + r.title}
                      onClick={() => go("record/" + r.id)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty text="暂无记录。可新建业务，或从上一环节转换。" />
          )}
        </div>
      )}
      <div className="pagination">
        <button disabled={number === 1} onClick={() => setNumber((n) => n - 1)}>
          上一页
        </button>
        <span>第 {number} 页</span>
        <button
          disabled={number * 20 >= total}
          onClick={() => setNumber((n) => n + 1)}
        >
          下一页
        </button>
      </div>
      {csv && (
        <CsvModal
          close={() => setCsv(false)}
          done={() => {
            setCsv(false);
            setQ("");
            api("/records?kind=lead")
              .then((d) => {
                setRows(d.rows);
                setTotal(d.total);
              })
              .catch(report);
          }}
        />
      )}
    </>
  );
}

export function CsvModal({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const [csv, setCsv] = useState("title,company,target,source,notes\n"),
    [error, setError] = useState("");
  return (
    <Modal title="导入线索 CSV" close={close}>
      <p className="hint">
        标题 title、公司 company 必填。最多500条，整批校验后导入。
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setCsv(await f.text());
        }}
      />
      <textarea
        rows={10}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button
        className="primary"
        onClick={() =>
          api("/import/leads", "POST", { csv })
            .then(done)
            .catch((e) => setError(e.message))
        }
      >
        确认导入
      </button>
    </Modal>
  );
}

export function Tools({ open }: { open: (k: Kind) => void }) {
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">12 TOOLS · ONE WORKFLOW</p>
          <h1>业务工具中心</h1>
          <p className="muted">每个工具连接到业务记录，生成草稿后由你确认。</p>
        </div>
      </div>
      <div className="tool-grid">
        {tools.map(([id, label, kind], i) => (
          <section className="tool-card" key={id}>
            <div className={"tool-icon " + (i % 2 ? "violet" : "blue")}>
              <Sparkles size={20} />
            </div>
            <p className="eyebrow">
              TOOL {String(i + 1).padStart(2, "0")} · {labels[kind]}
            </p>
            <h3>{label}</h3>
            <p>
              {id === "knowledge"
                ? "检索有权查看的已发布资料，展示原始片段与引用。"
                : "在关联记录详情中填写输入，查看、编辑并确认模板或规则结果。"}
            </p>
            <button onClick={() => go(pageFor(kind))}>
              打开业务记录 <ChevronRight size={14} />
            </button>
          </section>
        ))}
      </div>
    </>
  );
}

export function Customers({
  user,
  epoch,
  done,
  report,
}: {
  user: User;
  epoch: number;
  done: (s?: string) => void;
  report: (e: any) => void;
}) {
  const [customers, setCustomers] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [dialog, setDialog] = useState<string | null>(null),
    [rows, setRows] = useState<DocumentRow[]>([]);
  const [customerSearch,setCustomerSearch]=useState(""),[customerLine,setCustomerLine]=useState(""),[customerNature,setCustomerNature]=useState("");
  const customerListRef=useRef<HTMLDivElement>(null);
  const visibleCustomers=customers.filter(c=>{
    const matchesText=(c.name+' '+(c.contact||'')).toLowerCase().includes(customerSearch.trim().toLowerCase());
    const matchesCase=(!customerLine&&!customerNature)||c.cases.some((item:any)=>(!customerLine||item.businessLine===customerLine)&&(!customerNature||item.nature===customerNature));
    return matchesText&&(matchesCase||(!c.cases.length&&!customerLine&&customerNature==='daily'&&!c.source?.startsWith('history:')));
  });
  useEffect(()=>{if(customerListRef.current)customerListRef.current.scrollTop=0;},[customerSearch,customerLine,customerNature]);
  useEffect(() => {
    api("/customers")
      .then((d) => {
        setCustomers(d);
        if (selected) setSelected(d.find((c: any) => c.id === selected.id));
      })
      .catch(report);
  }, [epoch]);
  useEffect(() => {
    let current=true;
    setRows([]);
    if (!selected) return;
    Promise.all(
      selected.cases.map((c: any) =>
        api("/records?caseId=" + c.id + "&limit=200"),
      ),
    )
      .then((all) => {if(current)setRows(all.flatMap((x) => x.rows));})
      .catch(report);
    return()=>{current=false;};
  }, [selected, epoch]);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">CUSTOMER 360</p>
          <h1>客户与联系人</h1>
          <p className="muted">从客户档案追踪商机、拜访和履约进展</p>
        </div>
        {canWrite(user, "lead") && (
          <button className="primary" onClick={() => setDialog("new")}>
            <Plus size={16} />
            新增客户
          </button>
        )}
      </div>
      <div className="customer-grid">
        <section className="panel customer-list-panel">
          <div className="customer-list-filters">
            <input aria-label="搜索客户或联系人" placeholder="搜索客户名称、联系人…" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}/>
            <div className="customer-selects">
              <select aria-label="客户业务线筛选" value={customerLine} onChange={e=>setCustomerLine(e.target.value)}><option value="">全部业务线</option><option value="PB">PB 药企合作</option><option value="SR">SR 科研合作</option></select>
              <select aria-label="客户数据范围筛选" value={customerNature} onChange={e=>setCustomerNature(e.target.value)}><option value="">全部数据</option><option value="daily">日常业务</option><option value="history">历史档案</option><option value="scenario">演练客户</option></select>
            </div>
            <div className="customer-list-count"><span>显示 {visibleCustomers.length} / {customers.length} 个客户</span><button type="button" className="link" onClick={()=>{setCustomerSearch('');setCustomerLine('');setCustomerNature('');}}>清除筛选</button></div>
          </div>
          <div className="customer-list-scroll" ref={customerListRef} role="region" aria-label="客户列表" tabIndex={0}>
          {visibleCustomers.map((c) => (
            <button
              key={c.id}
              className={
                "customer-row " + (selected?.id === c.id ? "chosen" : "")
              }
              onClick={() => setSelected(c)}
              aria-pressed={selected?.id===c.id}
            >
              <b>{c.name}</b>
              <small>
                {c.contact || "未填写联系人"} · {c.cases.length} 个商机
              </small>
            </button>
          ))}
          {!visibleCustomers.length && (
            <Empty text={customers.length?"没有匹配客户，请调整筛选条件。":"暂无客户，创建客户或转换线索开始。"} />
          )}
          </div>
        </section>
        <section className="panel customer-detail-panel">
          {selected ? (
            <>
              <div className="panel-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.contact}</p>
                </div>
              </div>
              <div className="action-bar">
                {canWrite(user, "lead") && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setDialog("edit")}
                    >
                      编辑客户
                    </button>
                    <button
                      className="primary"
                      onClick={() => setDialog("case")}
                    >
                      新建业务档案
                    </button>
                  </>
                )}
                {isManager(user) && (
                  <button
                    className="secondary"
                    onClick={() => setDialog("grants")}
                  >
                    团队授权
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => go("customers-contacts")}
                >
                  联系人管理
                </button>
              </div>
              <h3>客户业务时间线</h3>
              {selected&&!visibleCustomers.some(c=>c.id===selected.id)&&<p className="muted">当前客户不在筛选结果中，详情仍为你保留。</p>}
              <div className="customer-timeline" role="region" aria-label="客户业务时间线" tabIndex={0}>
              {rows
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((r) => (
                  <button
                    className="task row-link"
                    key={r.id}
                    onClick={() => go("record/" + r.id)}
                  >
                    <div>
                      <b>{r.title}</b>
                      <small>
                        {labels[r.kind]} · {statuses[r.status]} ·{" "}
                        {new Date(r.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                ))}
              {!rows.length && (
                <p className="muted">
                  尚无业务记录。创建业务档案后可在各环节新增记录。
                </p>
              )}
              </div>
            </>
          ) : (
            <Empty text="选择客户查看关联业务与时间线" />
          )}
        </section>
      </div>
      {dialog && (
        <CustomerModal
          mode={dialog}
          customer={selected}
          close={() => setDialog(null)}
          done={() => {
            setDialog(null);
            done();
          }}
        />
      )}
    </>
  );
}

export function CustomerModal({
  mode,
  customer,
  close,
  done,
}: {
  mode: string;
  customer: any;
  close: () => void;
  done: () => void;
}) {
  const [name, setName] = useState(mode === "edit" ? customer.name : ""),
    [contact, setContact] = useState(mode === "edit" ? customer.contact : ""),
    [users, setUsers] = useState<User[]>([]),
    [grants, setGrants] = useState<string[]>(
      customer?.grants.map((g: any) => g.userId) || [],
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (mode === "grants")
      api("/users")
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, []);
  return (
    <Modal
      title={
        mode === "case"
          ? "新建业务档案"
          : mode === "grants"
            ? "客户团队授权"
            : mode === "edit"
              ? "编辑客户"
              : "新增客户"
      }
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (mode === "grants")
              await api("/customers/" + customer.id + "/grants", "POST", {
                userIds: grants,
              });
            else if (mode === "case")
              await api("/cases", "POST", {
                customerId: customer.id,
                title: name,
              });
            else
              await api(
                mode === "edit" ? "/customers/" + customer.id : "/customers",
                mode === "edit" ? "PATCH" : "POST",
                {
                  name,
                  contact,
                  ...(mode === "edit" ? { version: customer.version } : {}),
                },
              );
            done();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        {mode === "grants" ? (
          <>
            <p className="hint">
              授权后成员可查看该客户全部商机；写入和审批仍受角色限制。
            </p>
            {users.map((u) => (
              <label className="check-label" key={u.id}>
                <input
                  type="checkbox"
                  checked={grants.includes(u.id)}
                  onChange={(e) =>
                    setGrants(
                      e.target.checked
                        ? [...grants, u.id]
                        : grants.filter((id) => id !== u.id),
                    )
                  }
                />
                {u.name} · {roleNames[u.role]}
              </label>
            ))}
          </>
        ) : (
          <>
            <label>
              {mode === "case" ? "商机 / 业务档案名称" : "客户名称"}
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {mode !== "case" && (
              <label>
                主要联系人
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary">保存</button>
        </div>
      </form>
    </Modal>
  );
}

export function Settings({
  user,
  done,
  report,
}: {
  user: User;
  done: (s?: string) => void;
  report: (e: any) => void;
}) {
  const [audit, setAudit] = useState<any[]>([]),
    [demo, setDemo] = useState(false),
    [confirm, setConfirm] = useState("");
  useEffect(() => {
    api("/environment").then((x) => setDemo(x.demo));
    if (isManager(user)) api("/audit").then(setAudit).catch(report);
  }, []);
  return (
    <>
      <section className="panel">
        <h2>运行环境</h2>
        <p>
          当前环境：{demo ? "演示数据库" : "日常业务数据库"} · AI：本地演示
          Provider
        </p>
        <p className="hint">
          实时药企管线、语音转写、大模型、企业微信、外部 CRM
          尚未接入。资料和业务数据保存在本机。
        </p>
        {user.role === "admin" && demo && (
          <details>
            <summary>重置演示业务数据</summary>
            <p className="error">
              将清空演示客户与业务历史，账号保留。输入 RESET DEMO 确认。
            </p>
            <input
              aria-label="重置确认文字"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              className="secondary"
              disabled={confirm !== "RESET DEMO"}
              onClick={() =>
                api("/demo/reset", "POST", { confirm })
                  .then(() => {
                    setConfirm("");
                    done("演示业务数据已清空");
                  })
                  .catch(report)
              }
            >
              重置演示数据
            </button>
          </details>
        )}
      </section>
      {isManager(user) && (
        <details className="panel">
          <summary>审计日志（最近200条）</summary>
          <div className="timeline">
            {audit.map((a) => (
              <div key={a.id}>
                <b>{a.action}</b> · {a.detail}
                <small>
                  {new Date(a.createdAt).toLocaleString()} · {a.actorId}
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
      <h2>检测能力配置</h2>
    </>
  );
}

export function Accounts({
  user,
  report,
}: {
  user: User;
  report: (e: any) => void;
}) {
  const [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [ok, setOk] = useState("");
  return (
    <section className="panel account-panel">
      <div className="panel-head">
        <h2>账号与角色</h2>
        {user.role === "admin" && (
          <button
            className="secondary"
            onClick={() => {
              setShow(true);
              setError("");
              setOk("");
            }}
          >
            创建团队账号
          </button>
        )}
      </div>
      <details>
        <summary>修改我的密码</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("/password", "POST", {
                current: form.get("current"),
                password: form.get("password"),
              });
              location.reload();
            } catch (e) {
              report(e);
            }
          }}
        >
          <label>
            当前密码
            <input
              name="current"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            新密码（至少10位）
            <input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </label>
          <button className="secondary">修改并重新登录</button>
        </form>
      </details>
      {ok && <p className="hint">{ok}</p>}
      {show && (
        <Modal title="创建团队账号" close={() => setShow(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("/users", "POST", data);
                setShow(false);
                setOk("账号已创建；请在客户档案中分配团队访问权限。");
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <label>
              用户名（小写字母 / 数字 / 下划线）
              <input
                name="username"
                required
                pattern="[a-z0-9_-]{2,40}"
                autoComplete="off"
              />
            </label>
            <label>
              姓名
              <input name="name" required />
            </label>
            <label>
              角色
              <select name="role">
                {Object.entries(roleNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              初始密码（至少10位）
              <input
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary">创建账号</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
