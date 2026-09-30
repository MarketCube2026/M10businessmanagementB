import { Bell, LogOut, Search, FolderKanban, ChevronDown, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { DocumentRow, Kind, roleNames } from "../shared/domain";
import { api, go } from "./api";
import { Detail, RecordEditor } from "./components/Records";
import {
  Accounts,
  Customers,
  Dashboard,
  RecordList,
  Settings,
  Tools,
} from "./pages/Workspace";
import { pageFor, pages, User } from "./ui";
import { HistoryPage, ScenarioPage } from "./pages/History";
import {Management,ManagerGuide,RandomCases} from './pages/Management';

export function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "dashboard");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "dashboard");
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function App() {
  const route = useRoute(),
    [businessOpen,setBusinessOpen]=useState(false),
    [otherOpen,setOtherOpen]=useState(false),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [epoch, setEpoch] = useState(0),
    [globalSearch, setGlobalSearch] = useState(""),
    [editor, setEditor] = useState<{
      kind: Kind;
      record?: DocumentRow;
      parent?: DocumentRow;
    } | null>(null);
  useEffect(() => {
    api<User>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  const refresh = () => setEpoch((v) => v + 1);
  const report = (e: any) => {
    setError(e.message || String(e));
  };
  const done = (message = "已保存") => {
    setSuccess(message);
    setTimeout(() => setSuccess(""), 2800);
    refresh();
  };
  if (!ready) return <div className="loading">正在连接本地业务服务…</div>;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setError("");
          refresh();
        }}
      />
    );
  const [section, id] = route.split("?")[0].split("/"),
    page = pages.find((p) => p.id === section) || pages[0];
  const businessPages=pages.filter(p=>/^0[1-9] ·/.test(p.name));
  const visiblePages=pages.filter(p=>!['history','scenarios'].includes(p.id)||user.role==='admin').filter(p=>!['random','reports'].includes(p.id)||['admin','manager'].includes(user.role));
  const otherPages=visiblePages.filter(p=>['guide','history','random','scenarios'].includes(p.id));
  const navItem=(p:typeof pages[number])=><button key={p.id} aria-label={p.name} title={p.name} className={section===p.id?'active':''} aria-current={section===p.id?'page':undefined} onClick={()=>go(p.id)}><p.icon size={17}/><span>{p.name}</span></button>;
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="logo">✦</div>
          <div>
            <b>BD Flow</b>
            <span>检测业务中控</span>
          </div>
        </div>
        <div className="workspace">
          <span className="avatar">{user.name[0]}</span>
          <div>
            <b>{user.name}</b>
            <small>{roleNames[user.role]} · 本地工作空间</small>
          </div>
        </div>
        <nav>
          {visiblePages.map(p=>{
            if(p.id==='leads')return <div className="business-nav" key="business-modules"><button type="button" className={'business-nav-toggle '+(businessPages.some(p=>p.id===section)?'active':'')} aria-label="业务模块" title="业务模块" aria-expanded={businessOpen} aria-controls="business-module-links" onClick={()=>setBusinessOpen(open=>!open)}><FolderKanban size={17}/><span>业务模块</span><ChevronDown size={14} className={'business-nav-chevron '+(businessOpen?'expanded':'')}/></button><div id="business-module-links" className="business-nav-links" hidden={!businessOpen}>{businessPages.map(navItem)}</div></div>;
            if(p.id==='guide')return <div className="business-nav" key="other-modules"><button type="button" className={'business-nav-toggle '+(otherPages.some(p=>p.id===section)?'active':'')} aria-label="其他" title="其他" aria-expanded={otherOpen} aria-controls="other-module-links" onClick={()=>setOtherOpen(open=>!open)}><MoreHorizontal size={17}/><span>其他</span><ChevronDown size={14} className={'business-nav-chevron '+(otherOpen?'expanded':'')}/></button><div id="other-module-links" className="business-nav-links" hidden={!otherOpen}>{otherPages.map(navItem)}</div></div>;
            if(otherPages.some(o=>o.id===p.id))return null;
            return businessPages.some(b=>b.id===p.id)?null:navItem(p);
          })}
        </nav>
        <div className="side-bottom">
          <button
            className="settings"
            onClick={() =>
              api("/logout", "POST")
                .then(() => setUser(null))
                .catch(report)
            }
          >
            <LogOut size={14} /> 退出登录
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="crumb">
            BD Flow /{" "}
            <span>
              {section === "record"
                ? "业务详情"
                : section === "search"
                  ? "全局搜索"
                  : page.name}
            </span>
          </div>
          <form
            className="head-actions"
            onSubmit={(e) => {
              e.preventDefault();
              go("search/" + encodeURIComponent(globalSearch));
            }}
          >
            <div className="search">
              <Search size={17} />
              <input
                aria-label="全局搜索"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="搜索业务记录，按回车"
              />
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="通知与预警"
              onClick={() => go("dashboard")}
            >
              <Bell size={18} />
            </button>
            <span className="top-avatar">{user.name[0]}</span>
          </form>
        </header>
        <div className="content">
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {id && section === "record" ? (
            <Detail
              key={id}
              id={id}
              user={user}
              epoch={epoch}
              edit={(record) => setEditor({ kind: record.kind, record })}
              create={(kind, parent) => setEditor({ kind, parent })}
              done={done}
              report={report}
            />
          ) : section === "history" ? (
            <HistoryPage />
          ) : section === "scenarios" ? (
            <ScenarioPage />
          ) : section === "scenario-records" ? (
            <RecordList
              user={user}
              epoch={epoch}
              report={report}
              openCreate={(kind) => setEditor({ kind })}
              caseFilter={id}
            />
          ) : section === "dashboard" ? (
            <Management user={user}/>
          ) : section === "management" ? (
            <Management user={user} mode={new URLSearchParams(route.split('?')[1]).get('view')||'overview'}/>
          ) : section === "guide" ? (
            <ManagerGuide/>
          ) : section === "random" ? (
            <RandomCases/>
          ) : section === "customers" ? (
            <Customers user={user} epoch={epoch} done={done} report={report} />
          ) : section === "tools" ? (
            <Tools
              open={(k) => {
                go(pageFor(k));
                setEditor({ kind: k });
              }}
            />
          ) : section === "search" ? (
            <RecordList
              key={route}
              search={decodeURIComponent(id || "")}
              user={user}
              epoch={epoch}
              report={report}
              openCreate={(kind) => setEditor({ kind })}
            />
          ) : (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">全流程业务协作</p>
                  <h1>{page.name}</h1>
                  <p className="muted">
                    数据实时保存至本地数据库 · 审批与操作全程留痕
                  </p>
                </div>
              </div>
              {section === "settings" && (
                <>
                  <Accounts user={user} report={report} />
                  <Settings user={user} done={done} report={report} />
                </>
              )}
              <RecordList
                key={section}
                page={page}
                user={user}
                epoch={epoch}
                report={report}
                openCreate={(kind) => setEditor({ kind })}
              />
            </>
          )}
        </div>
      </main>
      {success && (
        <div className="toast" role="status">
          {success}
        </div>
      )}
      {editor && (
        <RecordEditor
          {...editor}
          user={user}
          close={() => setEditor(null)}
          saved={(r) => {
            setEditor(null);
            done();
            go("record/" + r.id);
          }}
        />
      )}
    </div>
  );
}

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [demo, setDemo] = useState(false);
  useEffect(() => {
    api("/environment")
      .then((x) => setDemo(x.demo))
      .catch(() => setError("服务不可用，请启动后端"));
  }, []);
  return (
    <div className="login">
      <div className="login-intro">
        <div className="logo">✦</div>
        <p>BD FLOW / WORKSPACE</p>
        <h1>
          把每一次机会，
          <br />
          连接成业务成果。
        </h1>
        <p>线索 · 拜访 · 方案 · 交付 · 回款</p>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onLogin(await api("/login", "POST", { username, password }));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>登录业务中控</h2>
        <p className="muted">使用你的团队账号继续</p>
        <label>
          用户名
          <input
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "正在登录…" : "登录工作空间"}
        </button>
        {demo && (
          <div className="hint">
            演示账号：admin / bd / manager / technical / delivery / finance /
            legal
            <br />
            演示密码：Demo2026!
            <br />
            演示数据与日常业务数据库分开。
          </div>
        )}
      </form>
    </div>
  );
}
