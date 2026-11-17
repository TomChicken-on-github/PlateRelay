import { NotificationBell, PageHeader } from "@/components/page-header";

/** Page whose content lands in a later change; only its title row for now. */
export function PlaceholderPage({ title }: { title: string }) {
  return <PageHeader title={title} actions={<NotificationBell />} />;
}
