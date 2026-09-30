import { useEffect, useState } from "react";
import { api, go } from "../api";
import { Modal } from "../ui";
export function HistoryPage() {
  const [sources, setSources] = useState<any[]>([]),
    [batches, setBatches] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [line, setLine] = useState(""),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [selected, setSelected] = useState<any>(),
    [busy, setBusy] = useState(false);
  const [undoId,setUndoId]=useState<string|null>(null);
  const reload = () => setEpoch((v) => v + 1);
  useEffect(() => {
    Promise.all([api("/sources"), api("/imports")])
      .then(([s, b]) => {
        setSources(s);
        setBatches(b);
      })
      .catch((e) => setError(e.message));
  }, [epoch]);
  useEffect(() => {
    api(
      "/imports/rows?" +
        new URLSearchParams({ q, category, line, page: String(page) }),
    )
      .then((d) => {
        setRows(d.rows);
        setTotal(d.total);
      })
      .catch((e) => setError(e.message));
  }, [q, category, line, page, epoch]);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">PB / SR · SOURCE REGISTER</p>
          <h1>历史业务与资料核对</h1>
          <p className="muted">
            历史事实独立保存，不推定合同审批、样本明细或银行流水。
          </p>
        </div>
        <a className="primary" href="/api/v1/imports/export">
          导出最新核对表
        </a>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="kpis">
        {[
          ["源文件", sources.length],
          ["来源条目", total],
          ["历史批次", batches.length],
          ["业务线", "PB / SR"],
        ].map(([a, b]) => (
          <div className="kpi" key={a}>
            <div className="kpi-top">{a}</div>
            <strong>{b}</strong>
          </div>
        ))}
      </div>
      <details className="panel">
        <summary>来源原件与导入批次</summary>
        <p className="hint">
          原件及核对数据仅管理员可访问。普通附件限制20MB，本入口支持150MB PPTX。
        </p>
        <label>
          导入PPTX
          <input
            disabled={busy}
            type="file"
            accept=".pptx"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              const data = new FormData();
              data.append("file", f);
              try {
                await api("/imports/upload", "POST", data);
                reload();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {busy && <p>正在解析文件，请稍候…</p>}
        {sources.map((s) => (
          <div className="task" key={s.id}>
            <div>
              <b>{s.name}</b>
              <small>
                {s.businessLine} · {s.sourceDate} · {s._count.rows} 条 · SHA256{" "}
                {s.hash.slice(0, 12)}
              </small>
            </div>
            <a href={"/api/v1/sources/" + s.id + "/file"}>下载原件</a>
          </div>
        ))}
        {batches.map((b) => (
          <div className="task" key={b.id}>
            <div>
              <b>{b.title}</b>
              <small>
                {b.status} · {b._count.rows} 条
              </small>
            </div>
            {b.status === "preview" && (
              <button
                className="primary"
                onClick={() =>
                  api("/imports/" + b.id + "/apply", "POST")
                    .then(reload)
                    .catch((e) => setError(e.message))
                }
              >
                应用已识别事实
              </button>
            )}
            {b.status === "applied" && (
              <button
                className="secondary"
                onClick={() => setUndoId(b.id)}
              >
                撤销批次
              </button>
            )}
          </div>
        ))}
      </details>
      <div className="filters">
        <input
          placeholder="检索来源正文"
          aria-label="检索来源正文"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="业务线"
          value={line}
          onChange={(e) => {
            setLine(e.target.value);
            setPage(1);
          }}
        >
          <option value="">PB + SR</option>
          <option>PB</option>
          <option>SR</option>
        </select>
        <select
          aria-label="核对类别"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部类别</option>
          {[
            "项目档案",
            "商务与拜访",
            "交付与质量",
            "订单与财务",
            "经营快照",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>资料 / 页码</th>
              <th>业务分类</th>
              <th>内容与核对情况</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "normal", maxWidth: 260 }}>
                  {r.source.name}
                  <small>
                    {r.locator} · {r.source.sourceDate} ·{" "}
                    {r.source.businessLine}
                  </small>
                </td>
                <td>
                  {r.category}
                  <small>
                    {
                      (
                        {
                          fact: "有来源事实",
                          pending: "待核实",
                          conflict: "来源冲突",
                          missing: "缺失",
                        } as any
                      )[r.evidence]
                    }
                  </small>
                </td>
                <td style={{ whiteSpace: "normal", maxWidth: 420 }}>
                  {r.raw.slice(0, 220)}
                  {r.raw.length > 220 ? "…" : ""}
                  <small className="error">{r.issues}</small>
                </td>
                <td>
                  <button className="link" onClick={() => setSelected(r)}>
                    核对详情
                  </button>
                  {r.recordId && (
                    <button
                      className="link"
                      onClick={() => go("record/" + r.recordId)}
                    >
                      业务记录
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        {page} / {Math.max(1, Math.ceil(total / 30))}
        <button disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
      {undoId&&<Modal title="撤销导入批次" close={()=>setUndoId(null)}><p>仅撤销未被修改或使用的本批次新增记录；原始来源与审计保留。</p><div className="form-footer"><button className="secondary" onClick={()=>setUndoId(null)}>取消</button><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/imports/'+undoId+'/undo','POST');setUndoId(null);reload();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>确认撤销</button></div></Modal>}
      {selected && (
        <Modal
          title={"来源核对 · " + selected.locator}
          close={() => setSelected(undefined)}
        >
          <p>{selected.source.name}</p>
          <pre>{selected.raw}</pre>
          <label>
            证据状态
            <select
              value={selected.evidence}
              onChange={(e) =>
                setSelected({ ...selected, evidence: e.target.value })
              }
            >
              <option value="fact">有来源事实</option>
              <option value="pending">待核实</option>
              <option value="missing">缺失</option>
              <option value="conflict">来源冲突</option>
            </select>
          </label>
          <label>
            核对意见
            <textarea
              value={selected.issues}
              onChange={(e) =>
                setSelected({ ...selected, issues: e.target.value })
              }
            />
          </label>
          <details>
            <summary>字段映射</summary>
            <pre>{JSON.stringify(selected.normalized, null, 2)}</pre>
          </details>
          <button
            className="primary"
            onClick={() =>
              api("/imports/rows/" + selected.id, "PATCH", {
                evidence: selected.evidence,
                issues: selected.issues,
                normalized: selected.normalized,
              })
                .then(() => {
                  setSelected(undefined);
                  reload();
                })
                .catch((e) => setError(e.message))
            }
          >
            保存核对结论
          </button>
        </Modal>
      )}
    </>
  );
}
export function ScenarioPage() {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const load = () =>
    api("/scenarios")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <h1>业务案例演练</h1>
      <p className="hint">
        演练内容包含明确标记的模拟金额、日期、审批和流水，不计入默认经营指标；不链接受限原件。初始化建立待办记录，“执行验收”逐步调用实际业务接口。
      </p>
      {error && <p className="error">{error}</p>}
      <div className="tool-grid">
        {rows.map((s) => (
          <section className="panel" key={s.id}>
            <h2>{s.title}</h2>
            <p>
              {s.code} · {s.status}
            </p>
            <div className="action-bar">
              {s.caseId && (
                <button
                  className="secondary"
                  onClick={() => go("scenario-records/" + s.caseId)}
                >
                  查看案例记录
                </button>
              )}
              <button
                disabled={
                  !!busy || s.status === "passed" || s.status === "running"
                }
                className="primary"
                onClick={async () => {
                  setBusy(s.id);
                  try {
                    await api("/scenarios/" + s.id + "/run", "POST");
                    await load();
                  } catch (e: any) {
                    setError(e.message);
                    await load();
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === s.id ? "正在执行实际流程…" : "执行闭环验收"}
              </button>
            </div>
            <details>
              <summary>步骤与验收证据</summary>
              {JSON.parse(s.steps).map((x: any, i: number) => (
                <p key={i}>
                  {i + 1}. {x.label} · {x.status}{" "}
                  {x.recordId && (
                    <button
                      className="link"
                      onClick={() => go("record/" + x.recordId)}
                    >
                      打开记录
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
