"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Empty, Layout, Menu, Popover, Tooltip } from "antd";
import {
  AlertOutlined,
  AuditOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CustomerServiceOutlined,
  FileDoneOutlined,
  IdcardOutlined,
  MailOutlined,
  MedicineBoxOutlined,
  ProfileOutlined,
  ReconciliationOutlined,
  SettingOutlined,
  SolutionOutlined as StudentIcon,
  UserAddOutlined,
  WalletOutlined,
  BankOutlined,
  BellOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileProtectOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  SolutionOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import { logoutAction } from "@/app/actions/auth";
import { Avatar, Logo, timeAgo } from "./common";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <DashboardOutlined />,
  faculty: <TeamOutlined />,
  students: <SolutionOutlined />,
  applications: <FileProtectOutlined />,
  documents: <FolderOpenOutlined />,
  inspections: <ScheduleOutlined />,
  verification: <SafetyCertificateOutlined />,
  institutions: <BankOutlined />,
  audit: <AuditOutlined />,
  users: <UsergroupAddOutlined />,
  profile: <ProfileOutlined />,
  annual: <FileDoneOutlined />,
  payments: <WalletOutlined />,
  appeals: <AlertOutlined />,
  messages: <MailOutlined />,
  help: <CustomerServiceOutlined />,
  onboarding: <UserAddOutlined />,
  council: <CalendarOutlined />,
  pharmacists: <MedicineBoxOutlined />,
  reports: <BarChartOutlined />,
  rules: <SettingOutlined />,
  accounts: <ReconciliationOutlined />,
  record: <IdcardOutlined />,
  student: <StudentIcon />,
};

export type NavItem = { href: string; label: string; icon: string; group: string; badge?: number };
export type ShellNotification = { id: number; title: string; body: string; link: string | null; createdAt: string };

export default function AppShell({
  nav,
  user,
  workspace,
  unread,
  notifications,
  children,
}: {
  nav: NavItem[];
  user: { name: string; username: string; roleLabel: string };
  workspace: { label: string; name: string; code?: string };
  unread: number;
  notifications: ShellNotification[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // narrow = phone-width layout (sidebar hidden behind a menu button); open = sidebar shown on a phone
  const [narrow, setNarrow] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (narrow) setHidden(true); // close the phone menu after navigating
  }, [pathname, narrow]);

  // A page restored from the browser's back-forward cache skips the server, so after
  // sign-out "Back" could show it. Reload such pages so the route protection runs again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const selected = [...nav].sort((a, b) => b.href.length - a.href.length).find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));

  const groups = [...new Set(nav.map((n) => n.group))];
  const items = groups.map((g) => ({
    type: "group" as const,
    key: g,
    label: g,
    children: nav
      .filter((n) => n.group === g)
      .map((n) => ({
        key: n.href,
        icon: ICONS[n.icon],
        label: (
          <Link href={n.href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{n.label}</span>
            {n.badge ? <span style={{ fontSize: 11, fontWeight: 700, background: "#c8a24a", color: "#1d1504", borderRadius: 999, padding: "0 7px", lineHeight: "18px" }}>{n.badge}</span> : null}
          </Link>
        ),
      })),
  }));

  const bell = (
    <div style={{ width: 360 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 4px 10px", borderBottom: "1px solid var(--line)" }}>
        <b>Notifications</b>
        <span className="faint" style={{ fontSize: 12 }}>In-app + email · every notice is stored</span>
      </div>
      {notifications.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You're all caught up" />
      ) : (
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          {notifications.map((n) => {
            const body = (
              <div style={{ padding: "10px 4px", borderBottom: "1px solid var(--line-2)", display: "flex", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--brand)", marginTop: 6, flex: "none" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{n.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{n.body}</div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link}>
                {body}
              </Link>
            ) : (
              <div key={n.id}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }} className={`pcp-shell${narrow ? " collapsed" : ""}`}>
      <Layout.Sider
        breakpoint="lg"
        collapsedWidth={0}
        width={252}
        className="pcp-sider no-print"
        collapsed={hidden}
        onCollapse={setHidden}
        onBreakpoint={(b) => {
          setNarrow(b);
          setHidden(b);
        }}
      >
        <Link href="/home" className="pcp-brand">
          <Logo size={36} />
          <div>
            <div className="pcp-brand-title">PCP Digital Portal</div>
            <div className="pcp-brand-sub">Pharmacy Council of Pakistan</div>
          </div>
        </Link>
        <div className="pcp-workspace">
          <div className="pcp-workspace-label">{workspace.label}</div>
          <div className="pcp-workspace-name">{workspace.name}</div>
          {workspace.code ? <div className="pcp-workspace-code">{workspace.code}</div> : null}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={selected ? [selected.href] : []} items={items} />
        <div className="pcp-sider-foot">
          <div className="pcp-userchip">
            <Avatar name={user.name} size={34} light />
            <div style={{ minWidth: 0 }}>
              <div className="pcp-userchip-name">{user.name}</div>
              <div className="pcp-userchip-role">{user.roleLabel}</div>
            </div>
          </div>
        </div>
      </Layout.Sider>
      <Layout style={{ background: "var(--bg)" }}>
        <Layout.Header className="pcp-header no-print">
          <div className="pcp-crumbs">
            <span>{workspace.label}</span>
            <RightOutlined style={{ fontSize: 10 }} />
            <b>{selected?.label ?? "Overview"}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Tooltip title="All institutions, people, CNICs and payments are fictional. No SMS is sent.">
              <span className="pcp-demo-chip">
                <ExperimentOutlined /> Demo data
              </span>
            </Tooltip>
            <Popover content={bell} trigger="click" placement="bottomRight" arrow={false}>
              <Badge count={unread} size="small" offset={[-2, 2]}>
                <Button type="text" shape="circle" aria-label="Notifications" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Popover>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 14, borderLeft: "1px solid var(--line)" }}>
              <Avatar name={user.name} size={32} />
              <div className="pcp-user-text" style={{ lineHeight: 1.25 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{user.roleLabel}</div>
              </div>
            </div>
            <form action={logoutAction}>
              <Button htmlType="submit" icon={<LogoutOutlined />}>
                Sign out
              </Button>
            </form>
          </div>
        </Layout.Header>
        <Layout.Content className="pcp-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
