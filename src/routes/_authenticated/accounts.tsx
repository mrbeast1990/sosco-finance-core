import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState, EmptyState } from "@/components/States";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/accounts")({ component: AccountsPage });

const typeLabels: Record<string, string> = {
  asset: "أصول", liability: "خصوم", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات",
};

interface AccountNode { id: string; code: string; name: string; type: string; parent_id: string | null; children: AccountNode[]; }

function AccountsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").order("code");
      if (error) throw error;
      const map: Record<string, AccountNode> = {};
      data.forEach((a: any) => { map[a.id] = { ...a, children: [] }; });
      const roots: AccountNode[] = [];
      data.forEach((a: any) => {
        if (a.parent_id && map[a.parent_id]) map[a.parent_id].children.push(map[a.id]);
        else roots.push(map[a.id]);
      });
      return roots;
    },
  });

  return (
    <div>
      <PageHeader title="شجرة الحسابات" description="هيكل الحسابات المحاسبية" />
      <Card>
        <CardContent className="p-6">
          {isLoading ? <LoadingState /> : (data?.length ?? 0) === 0 ? <EmptyState title="لا توجد حسابات" /> : (
            <div className="space-y-1">
              {data!.map((n) => <AccountRow key={n.id} node={n} depth={0} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountRow({ node, depth }: { node: AccountNode; depth: number }) {
  return (
    <>
      <div className="flex items-center gap-3 py-2 px-2 hover:bg-muted/50 rounded-md" style={{ paddingRight: depth * 24 + 8 }}>
        <span className="tabular-nums text-sm font-medium text-muted-foreground w-16" dir="ltr">{node.code}</span>
        <span className="font-medium flex-1">{node.name}</span>
        <Badge variant="outline" className="text-xs">{typeLabels[node.type]}</Badge>
      </div>
      {node.children.map((c) => <AccountRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}
