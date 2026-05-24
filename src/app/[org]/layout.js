import OrgNav from '@/components/OrgNav'
import AuthGuard from '@/components/AuthGuard'

export default function OrgLayout({ children, params }) {
  return (
    <AuthGuard>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0f1a' }}>
        <OrgNav slug={params.org} />
        <main className="org-main">
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}
