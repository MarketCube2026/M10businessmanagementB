import {
  BookOpen,
  Calculator,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import React, { useEffect } from "react";
import { Kind, Role } from "../shared/domain";

export type User = { id: string; name: string; role: Role; username: string };

export type Page = {
  id: string;
  name: string;
  icon: typeof Users;
  kinds: Kind[];
};

export const pages: Page[] = [
  { id: "dashboard", name: "业务工作台", icon: LayoutDashboard, kinds: [] },
  { id: "customers", name: "客户与联系人", icon: Users, kinds: ["contact"] },
  {id:'management',name:'审批与任务中心',icon:ShieldCheck,kinds:[]},
  { id: "leads", name: "01 · 线索挖掘", icon: Radar, kinds: ["lead"] },
  {
    id: "opportunities",
    name: "02 · 机会评估",
    icon: ShieldCheck,
    kinds: ["opportunity"],
  },
  {
    id: "visits",
    name: "03 · 客户拜访",
    icon: Users,
    kinds: ["visit", "task"],
  },
  {
    id: "proposals",
    name: "04 · 方案设计",
    icon: FileText,
    kinds: ["proposal", "study"],
  },
  { id: "quotes", name: "05 · 报价谈判", icon: Calculator, kinds: ["quote"] },
  {
    id: "contracts",
    name: "06 · 合同风控",
    icon: ShieldCheck,
    kinds: ["contract"],
  },
  {
    id: "projects",
    name: "07 · 交付执行",
    icon: FolderKanban,
    kinds: ["project", "sample", "milestone"],
  },
  {
    id: "payments",
    name: "08 · 回款维护",
    icon: Calculator,
    kinds: ["receivable", "receipt", "maintenance"],
  },
  {
    id: "knowledge",
    name: "09 · 知识沉淀",
    icon: BookOpen,
    kinds: ["knowledge", "review"],
  },
  { id: "tools", name: "工具中心", icon: Sparkles, kinds: [] },
  {id:'guide',name:'负责人使用指南',icon:BookOpen,kinds:[]},
  {id:'history',name:'历史业务核对',icon:BookOpen,kinds:[]},
  {id:'random',name:'30套随机业务演练',icon:Sparkles,kinds:[]},
  {id:'scenarios',name:'五大案例演练',icon:Sparkles,kinds:[]},
  {
    id: "settings",
    name: "系统设置",
    icon: ShieldCheck,
    kinds: ["capability"],
  },
];

export const pageFor = (kind: Kind) =>
  kind === "contact"
    ? "customers-contacts"
    : pages.find((p) => p.kinds.includes(kind))?.id || "dashboard";

export const costAllowed = (u: User) =>
  ["admin", "manager", "finance"].includes(u.role);

export const isManager = (u: User) => ["admin", "manager"].includes(u.role);

export function canWrite(u: User, k: Kind) {
  if (isManager(u)) return true;
  const map: Partial<Record<Kind, Role[]>> = {
    quote: ["bd", "finance"],
    contract: ["bd", "legal"],
    project: ["delivery"],
    sample: ["delivery"],
    milestone: ["delivery"],
    receivable: ["finance"],
    receipt: ["finance"],
    capability: ["technical"],
    study: ["bd", "technical"],
    proposal: ["bd", "technical"],
    knowledge: ["bd", "technical", "delivery", "legal", "finance"],
    review: ["bd", "delivery"],
    task: ["bd", "technical", "delivery", "legal", "finance"],
  };
  return (map[k] || ["bd"]).includes(u.role);
}

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [close]);
  return (
    <div className="modal-back" onClick={close}>
      <section
        role="dialog"
        aria-label={title}
        aria-modal="true"
        className="form-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <FolderKanban size={30} />
      <p>{text}</p>
    </div>
  );
}
pages.push({
  id: "customers-contacts",
  name: "联系人管理",
  icon: Users,
  kinds: ["contact"],
});
