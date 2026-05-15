import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Briefcase, Users, FileText, Tags, Receipt,
  BookOpen, Network, BarChart3, LogOut, Building2,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { Button } from "./ui/button";

const groups = [
  {
    label: "الرئيسية",
    items: [{ title: "لوحة التحكم", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "البيانات الأساسية",
    items: [
      { title: "المشاريع", url: "/projects", icon: Briefcase },
      { title: "الممولون", url: "/funders", icon: Users },
      { title: "صكوك التمويل", url: "/funding-checks", icon: FileText },
      { title: "فئات المصروفات", url: "/expense-categories", icon: Tags },
    ],
  },
  {
    label: "العمليات المالية",
    items: [
      { title: "المصروفات", url: "/expenses", icon: Receipt },
      { title: "القيود اليومية", url: "/journal-entries", icon: BookOpen },
      { title: "شجرة الحسابات", url: "/accounts", icon: Network },
    ],
  },
  {
    label: "التحليلات",
    items: [{ title: "التقارير", url: "/reports", icon: BarChart3 }],
  },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user, roles, signOut } = useAuth();

  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sidebar-primary/15 p-2 text-sidebar-primary"><Building2 className="size-5" /></div>
          <div className="flex flex-col">
            <span className="font-bold text-sidebar-foreground">سوسكو</span>
            <span className="text-[11px] text-sidebar-foreground/60">نظام محاسبي</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = path === item.url || path.startsWith(item.url + "/");
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex flex-col gap-2">
          <div className="px-1 text-xs">
            <div className="font-medium text-sidebar-foreground truncate">{user?.email}</div>
            <div className="text-sidebar-foreground/60">
              {roles.includes("admin") ? "مدير" : roles.includes("accountant") ? "محاسب" : "مشاهد"}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="justify-start text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="size-4" />
            تسجيل الخروج
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
