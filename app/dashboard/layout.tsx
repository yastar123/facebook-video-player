import { DashboardSessionProvider } from '@/components/dashboard/dashboard-session'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth'
import { getDashboardInitialData } from '@/lib/dashboard-data'

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await getAdminSession()
  if (!admin) redirect('/login')

  const initialData = await getDashboardInitialData(admin)
  return <DashboardSessionProvider initialData={initialData}><div id="fb-root" />{children}</DashboardSessionProvider>
}
