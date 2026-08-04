'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/auth'
import { TraceDetail } from '@/components/TraceDetail'

const card = { background: '#12151e', border: '1px solid #1e2535', borderRadius: 10, padding: 16 }
const mono = { fontFamily: 'var(--font-mono), ui-monospace, monospace' }
const inputStyle = { background:'#0d0f1a', color:'#e2e8f0', border:'1px solid #243047', borderRadius:6, padding:'8px 10px', fontFamily:'inherit', fontSize:12 }

export default function IntelligenceConsole() {
  const [orgs, setOrgs] = useState([])
  const [traces, setTraces] = useState([])
  const [tracePage, setTracePage] = useState(null)
  const [traceTotals, setTraceTotals] = useState(null)
  const [traceRange, setTraceRange] = useState('all')
  const [traceOrgId, setTraceOrgId] = useState('')
  const [traceListLoading, setTraceListLoading] = useState(false)
  const [traceListBusy, setTraceListBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [traceError, setTraceError] = useState('')
  const [orgSearch, setOrgSearch] = useState('')
  const [operators, setOperators] = useState([])
  const [scopedOperators, setScopedOperators] = useState([])
  const [operatorEmail, setOperatorEmail] = useState('')
  const [scopeOrgId, setScopeOrgId] = useState('')
  const [operatorMsg, setOperatorMsg] = useState('')
  const [operatorBusy, setOperatorBusy] = useState(false)
  const [workspaceForm, setWorkspaceForm] = useState({ name:'', slug:'', website:'', description:'', owner_email:'' })
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceMsg, setWorkspaceMsg] = useState('')
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState('')

  function loadOperators() {
    return api.getObservabilityOperators().then(d => {
      setOperators(d.operators || [])
      setScopedOperators(d.scoped || [])
    })
  }

  function loadOrgs() {
    return api.getObservabilityOverview().then(d => setOrgs(d.organizations || []))
  }

  async function loadTraces({ append = false, before = null } = {}) {
    if (append) setTraceListBusy(true)
    else setTraceListLoading(true)
    setTraceError('')
    try {
      const result = await api.getObservabilityTraces({
        org_id: traceOrgId || undefined,
        range: traceRange,
        limit: 100,
        before: before || undefined,
      })
      const next = result.traces || []
      setTraces((prev) => (append ? [...prev, ...next] : next))
      setTracePage(result.page || null)
      setTraceTotals(result.totals || null)
    } catch (e) {
      setTraceError(e.message)
      if (!append) setTraces([])
    } finally {
      setTraceListLoading(false)
      setTraceListBusy(false)
    }
  }

  useEffect(() => {
    Promise.all([api.getObservabilityOverview(), loadOperators()])
      .then(([a]) => setOrgs(a.organizations || []))
      .catch(e => setError(e.message))
  }, [])

  useEffect(() => {
    loadTraces().catch(() => {})
  }, [traceRange, traceOrgId])

  async function openTrace(id) {
    setTraceError('')
    try {
      const d = await api.getObservabilityTraces({ trace_id: id })
      setSelected(id)
      setDetail(d)
    } catch (e) {
      setTraceError(e.message)
    }
  }

  async function overrideTrace({ traceId, note }) {
    const result = await api.overrideObservabilityTrace(traceId, note)
    const refreshed = await api.getObservabilityTraces({ trace_id: traceId })
    setDetail(refreshed)
    return result
  }

  async function setOperator(email, granted, orgId = null) {
    setOperatorBusy(true)
    setOperatorMsg('')
    try {
      await api.setObservabilityOperator(email, granted, orgId)
      setOperatorEmail('')
      setOperatorMsg(granted
        ? `${email} can now access ${orgId ? 'the selected organisation' : 'all organisations'}.`
        : `${email} no longer has access.`)
      await loadOperators()
    } catch (e) {
      setOperatorMsg(e.message)
    } finally {
      setOperatorBusy(false)
    }
  }

  async function createWorkspace() {
    setWorkspaceBusy(true)
    setWorkspaceMsg('')
    try {
      const result = await api.createObservabilityWorkspace(workspaceForm)
      setWorkspaceForm({ name:'', slug:'', website:'', description:'', owner_email:'' })
      setWorkspaceMsg(`Created ${result.organization.name}.`)
      await loadOrgs()
    } catch (e) {
      setWorkspaceMsg(e.message)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function deleteWorkspace() {
    const workspace = orgs.find(o => o.id === deleteWorkspaceId)
    if (!workspace) return
    const confirmation = window.prompt(`Type exactly: ${workspace.name}\n\nThis permanently deletes the workspace and its associated data.`)
    if (confirmation === null) return
    setWorkspaceBusy(true)
    setWorkspaceMsg('')
    try {
      await api.deleteObservabilityWorkspace(workspace.id, confirmation)
      setDeleteWorkspaceId('')
      setWorkspaceMsg(`Deleted ${workspace.name}.`)
      await loadOrgs()
    } catch (e) {
      setWorkspaceMsg(e.message)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  if (error) {
    return (
      <main style={{ minHeight: '100vh', background: '#0d0f1a', color: '#f87171', padding: 48, fontFamily: 'system-ui' }}>
        Operator console unavailable: {error}
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0d0f1a', color: '#e2e8f0', padding: '34px clamp(18px,4vw,56px)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...mono, color: '#60a5fa', fontSize: 11, letterSpacing: '.16em' }}>SPILL / INTERNAL ONLY</div>
        <h1 style={{ fontSize: 25, fontWeight: 550, margin: '8px 0' }}>Organisation Intelligence</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>Every surfaced decision is inspectable: source → agent → prompt version → quality gate → outcome.</p>
      </div>

      <section style={{ ...card, marginBottom: 24 }}>
        <div style={{ ...mono, color:'#94a3b8', fontSize:11, letterSpacing:'.1em', marginBottom:10 }}>OPERATOR ACCESS</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input value={operatorEmail} onChange={e => setOperatorEmail(e.target.value)} placeholder="colleague@company.com" type="email" style={{ flex:'1 1 240px', ...inputStyle }}/>
          <select value={scopeOrgId} onChange={e=>setScopeOrgId(e.target.value)} style={inputStyle}>
            <option value="">All organisations (super admin)</option>
            {orgs.map(o=><option key={o.id} value={o.id}>{o.name} only</option>)}
          </select>
          <button disabled={operatorBusy || !operatorEmail.trim()} onClick={() => setOperator(operatorEmail, true, scopeOrgId || null)} style={{ padding:'8px 12px', border:0, borderRadius:6, background:'#2563eb', color:'white', cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
            {operatorBusy ? 'saving…' : scopeOrgId ? 'grant organisation access' : 'grant super admin'}
          </button>
        </div>
        <div style={{marginTop:7,color:'#64748b',fontSize:11}}>Organisation access exposes only that company’s overview, traces, prompts, and playground. Super admin access exposes all companies.</div>
        {operatorMsg && <div style={{ marginTop:8, color: operatorMsg.includes('access') && !operatorMsg.includes('no longer') ? '#4ade80' : '#fbbf24', fontSize:12 }}>{operatorMsg}</div>}
        <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginTop:12 }}>
          {operators.map(o => (
            <span key={o.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#191d2b', border:'1px solid #243047', padding:'5px 7px 5px 9px', borderRadius:99, color:'#94a3b8', fontSize:11 }}>
              {o.name || o.email} <em style={{color:'#60a5fa',fontStyle:'normal'}}>all orgs</em>
              <button disabled={operatorBusy} onClick={() => setOperator(o.email, false)} title="revoke super admin" style={{ background:'transparent', color:'#f87171', border:0, cursor:'pointer', fontSize:14, lineHeight:1 }}>×</button>
            </span>
          ))}
          {scopedOperators.map(o=>(
            <span key={o.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#191d2b', border:'1px solid #243047', padding:'5px 7px 5px 9px', borderRadius:99, color:'#94a3b8', fontSize:11 }}>
              {o.name || o.email} <em style={{color:'#4ade80',fontStyle:'normal'}}>{o.org_name}</em>
              <button disabled={operatorBusy} onClick={() => setOperator(o.email, false, o.org_id)} title="revoke organisation access" style={{ background:'transparent', color:'#f87171', border:0, cursor:'pointer', fontSize:14, lineHeight:1 }}>×</button>
            </span>
          ))}
        </div>
      </section>

      <section style={{ ...card, marginBottom:24 }}>
        <div style={{ ...mono, color:'#94a3b8', fontSize:11, letterSpacing:'.1em', marginBottom:10 }}>WORKSPACE MANAGEMENT</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:8 }}>
          <input value={workspaceForm.name} onChange={e=>setWorkspaceForm(f=>({...f,name:e.target.value}))} placeholder="Workspace name *" style={inputStyle}/>
          <input value={workspaceForm.slug} onChange={e=>setWorkspaceForm(f=>({...f,slug:e.target.value.toLowerCase()}))} placeholder="slug (lowercase) *" style={inputStyle}/>
          <input value={workspaceForm.owner_email} onChange={e=>setWorkspaceForm(f=>({...f,owner_email:e.target.value}))} placeholder="Owner email (optional)" type="email" style={inputStyle}/>
          <input value={workspaceForm.website} onChange={e=>setWorkspaceForm(f=>({...f,website:e.target.value}))} placeholder="Website (optional)" style={inputStyle}/>
        </div>
        <textarea value={workspaceForm.description} onChange={e=>setWorkspaceForm(f=>({...f,description:e.target.value}))} placeholder="Company context (optional)" style={{...inputStyle,width:'100%',boxSizing:'border-box',resize:'vertical',minHeight:58,marginTop:8}}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
          <button disabled={workspaceBusy || !workspaceForm.name.trim() || !workspaceForm.slug.trim()} onClick={createWorkspace} style={{padding:'8px 12px',border:0,borderRadius:6,background:'#2563eb',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12}}>
            {workspaceBusy ? 'saving…' : 'create workspace'}
          </button>
          <select value={deleteWorkspaceId} onChange={e=>setDeleteWorkspaceId(e.target.value)} style={{...inputStyle,flex:'1 1 220px'}}>
            <option value="">Select a workspace to delete</option>
            {orgs.map(o=><option key={o.id} value={o.id}>{o.name} · {o.slug}</option>)}
          </select>
          <button disabled={workspaceBusy || !deleteWorkspaceId} onClick={deleteWorkspace} style={{padding:'8px 12px',border:'1px solid #7f1d1d',borderRadius:6,background:'#450a0a',color:'#fca5a5',cursor:'pointer',fontFamily:'inherit',fontSize:12}}>
            delete workspace
          </button>
        </div>
        <div style={{marginTop:7,color:'#64748b',fontSize:11}}>Leave owner blank to assign the workspace to yourself. Deletion requires its exact name and permanently removes associated data.</div>
        {workspaceMsg && <div style={{marginTop:8,color:workspaceMsg.startsWith('Created') || workspaceMsg.startsWith('Deleted') ? '#4ade80' : '#f87171',fontSize:12}}>{workspaceMsg}</div>}
      </section>

      <section style={{ marginBottom:24 }}>
        <div style={{ ...mono, color:'#64748b', fontSize:10, marginBottom:8 }}>ALL WORKSPACES · {orgs.length}</div>
        <input value={orgSearch} onChange={e=>setOrgSearch(e.target.value)} placeholder="Search organisations by name, slug or ID" style={{width:'100%',boxSizing:'border-box',background:'#12151e',color:'#e2e8f0',border:'1px solid #243047',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}/>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(235px,1fr))', gap: 12 }}>
          {orgs.filter(o=>`${o.name} ${o.slug} ${o.id}`.toLowerCase().includes(orgSearch.toLowerCase())).map(o => (
            <button key={o.id} onClick={()=>window.location.href=`/internal/intelligence/${o.id}`} style={{...card,textAlign:'left',color:'#e2e8f0',cursor:'pointer'}}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                <strong>{o.name}</strong>
                <span style={{ ...mono, fontSize:10, color:'#64748b' }}>{o.slug}</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9, marginTop:15, fontSize:12 }}>
                <Metric label="signals" value={o.signals_detected}/>
                <Metric label="alerts" value={o.alerts_triggered}/>
                <Metric label="avg quality" value={o.avg_quality ?? '—'}/>
                <Metric label="false positive" value={o.false_positive_rate == null ? 'insufficient data' : `${o.false_positive_rate}%`}/>
              </div>
              <div style={{ marginTop:12, fontSize:11, color:'#64748b' }}>
                {(o.active_sources||[]).join(' · ') || 'No active sources'} · {(o.top_categories || []).slice(0,3).join(' · ') || 'No classified categories yet'}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display:'grid', gridTemplateColumns:'minmax(330px,1fr) minmax(360px,1.1fr)', gap:16, alignItems:'start' }}>
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'baseline', marginBottom:10 }}>
            <div style={{ ...mono, color:'#94a3b8', fontSize:11, letterSpacing:'.1em' }}>EVENT TRACE EXPLORER</div>
            <div style={{ ...mono, fontSize:9, color:'#64748b' }}>
              {traceTotals?.total != null ? `${traces.length} shown · ${traceTotals.total} total` : `${traces.length} shown`}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
            {['all','7d','30d','24h','6h'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTraceRange(r)}
                style={{
                  padding:'4px 8px', borderRadius:99,
                  border: traceRange === r ? '1px solid #2563eb' : '1px solid #243047',
                  background: traceRange === r ? '#1e3a8a' : 'transparent',
                  color: traceRange === r ? '#dbeafe' : '#94a3b8',
                  cursor:'pointer', fontSize:10, fontFamily:'inherit',
                }}
              >
                {r === 'all' ? 'all time' : r}
              </button>
            ))}
            <select
              value={traceOrgId}
              onChange={(e) => setTraceOrgId(e.target.value)}
              style={{ ...inputStyle, flex:'1 1 160px', minWidth:160 }}
            >
              <option value="">All organisations</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {traceTotals?.oldest && (
            <div style={{ ...mono, fontSize:9, color:'#475569', marginBottom:8 }}>
              oldest available {new Date(traceTotals.oldest).toLocaleString()}
            </div>
          )}
          <div style={{ maxHeight:560, overflow:'auto' }}>
            {traceListLoading ? (
              <p style={{ color:'#64748b', fontSize:13 }}>Loading history…</p>
            ) : traces.length ? traces.map(t => (
              <button key={t.id} onClick={() => openTrace(t.id)} style={{ width:'100%', textAlign:'left', background:selected===t.id?'#191d2b':'transparent', border:'none', borderTop:'1px solid #1e2535', color:'inherit', padding:'12px 4px', cursor:'pointer' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
                  <span style={{ color: t.decision==='surfaced' || t.decision==='surfaced_override' ? '#4ade80' : (String(t.decision||'').includes('reject') ? '#f87171' : '#fbbf24') }}>{t.decision}</span>
                  <span style={{ color:'#475569' }}>{timeAgo(t.created_at)}</span>
                </div>
                <div style={{ margin:'5px 0', fontSize:13 }}>{t.title || 'Suppressed candidate'}</div>
                <div style={{ ...mono, fontSize:10, color:'#64748b' }}>
                  {t.org_name} · {t.source} · {new Date(t.created_at).toLocaleString()} · quality {t.quality?.score ?? '—'} · escalation {t.escalation_score ?? '—'}
                </div>
              </button>
            )) : <p style={{ color:'#64748b', fontSize:13 }}>No traces in this range. Run a refresh or widen the time window.</p>}
          </div>
          {tracePage?.has_more && (
            <button
              type="button"
              disabled={traceListBusy}
              onClick={() => loadTraces({ append: true, before: tracePage.next_before })}
              style={{ marginTop:10, width:'100%', padding:'8px 10px', border:'1px solid #243047', borderRadius:6, background:'#191d2b', color:'#93c5fd', cursor:'pointer', fontSize:11 }}
            >
              {traceListBusy ? 'loading older…' : 'load older traces'}
            </button>
          )}
        </div>
        <div style={card}>
          {traceError && <div style={{ color:'#f87171', fontSize:12, marginBottom:10 }}>{traceError}</div>}
          {detail
            ? <TraceDetail detail={detail} onOverride={overrideTrace} onRefresh={openTrace} />
            : <div style={{ color:'#64748b', fontSize:13, padding:20 }}>Select an event to inspect its original content, agent outputs, prompt versions, model usage, and quality decision.</div>}
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div style={{ ...mono, fontSize:9, color:'#475569', textTransform:'uppercase' }}>{label}</div>
      <div style={{ fontSize:16, marginTop:2 }}>{value ?? 0}</div>
    </div>
  )
}
