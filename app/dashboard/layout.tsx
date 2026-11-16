import { DashboardSessionProvider } from '@/components/dashboard/dashboard-session'

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DashboardSessionProvider><div id="fb-root" />{children}</DashboardSessionProvider>
}
