import type { Metadata } from 'next'
import { Badge } from '@/components/badge'
import { ShieldCheck, Eye, CheckCircle, XCircle, Clock, Filter } from 'lucide-react'

export const metadata: Metadata = { title: 'KYC Review' }

const KYC_ITEMS = [
  { id: 'KYC-501', name: 'Ravi Shankar Yadav', role: 'driver', tier: 'Tier 2', docs: ['DL', 'RC Book'], status: 'pending', flagged: false, submitted: '10 min ago', phone: '+91 98765 43210' },
  { id: 'KYC-500', name: 'Anjali Mehta', role: 'shipper', tier: 'Tier 1', docs: ['Aadhaar', 'PAN'], status: 'pending', flagged: false, submitted: '24 min ago', phone: '+91 87654 32109' },
  { id: 'KYC-499', name: 'Surya Fleet Pvt Ltd', role: 'fleet_owner', tier: 'Business', docs: ['GST', 'Company PAN', 'MOA'], status: 'pending', flagged: true, submitted: '1 hr ago', phone: '+91 76543 21098' },
  { id: 'KYC-498', name: 'Mohit Sharma', role: 'driver', tier: 'Tier 1', docs: ['Aadhaar', 'PAN'], status: 'approved', flagged: false, submitted: '3 hrs ago', phone: '+91 65432 10987' },
  { id: 'KYC-497', name: 'Priya Kapoor Traders', role: 'fleet_owner', tier: 'Business', docs: ['GST', 'Company PAN'], status: 'rejected', flagged: false, submitted: '5 hrs ago', phone: '+91 54321 09876' },
  { id: 'KYC-496', name: 'Deepak Patel', role: 'driver', tier: 'Tier 2', docs: ['DL', 'RC Book', 'Police Cert'], status: 'pending', flagged: false, submitted: '6 hrs ago', phone: '+91 43210 98765' },
]

const ROLE_LABEL: Record<string, string> = {
  driver: 'Driver', shipper: 'Shipper', fleet_owner: 'Fleet Owner'
}

export default function KycPage() {
  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">KYC Review</h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            Review and approve user identity documents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
            dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:text-[#888] text-[#71717A]
            dark:border-[#2A2A2A] border-[#E4E4E7] border
            hover:dark:text-white hover:text-[#09090B] transition-colors">
            <Filter size={14} />
            Filter
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { label: 'All', count: 12 },
          { label: 'Pending', count: 9 },
          { label: 'Flagged', count: 1 },
          { label: 'Approved', count: 0 },
          { label: 'Rejected', count: 2 },
        ].map((tab, i) => (
          <button key={tab.label}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
              ${i === 0
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'dark:bg-transparent bg-transparent dark:border-[#2A2A2A] border-[#E4E4E7] dark:text-[#888] text-[#71717A] hover:dark:text-white hover:text-[#09090B]'
              }`}>
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold
              ${i === 0 ? 'bg-white/20 text-white' : 'dark:bg-[#2A2A2A] dark:text-[#888] bg-[#E4E4E7] text-[#71717A]'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="dark:border-[#2A2A2A] border-[#E4E4E7] border-b">
              <th className="text-left px-5 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider">
                Applicant
              </th>
              <th className="text-left px-4 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider hidden md:table-cell">
                Role
              </th>
              <th className="text-left px-4 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider hidden lg:table-cell">
                Documents
              </th>
              <th className="text-left px-4 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider hidden sm:table-cell">
                Submitted
              </th>
              <th className="text-left px-4 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider">
                Status
              </th>
              <th className="text-right px-5 py-3.5 text-xs font-semibold dark:text-[#555] text-[#A1A1AA] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-[#1A1A1A] divide-[#F4F4F5]">
            {KYC_ITEMS.map(item => (
              <tr key={item.id}
                className="hover:dark:bg-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors group">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F97316]/10 flex items-center justify-center
                      text-[#F97316] text-xs font-bold shrink-0">
                      {item.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium dark:text-white text-[#09090B]">{item.name}</p>
                        {item.flagged && (
                          <span className="text-[10px] bg-[#EF4444]/10 text-[#EF4444] px-1.5 py-0.5 rounded-full font-semibold border border-[#EF4444]/20">
                            FLAGGED
                          </span>
                        )}
                      </div>
                      <p className="text-xs dark:text-[#888] text-[#71717A]">{item.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 hidden md:table-cell">
                  <Badge variant="muted">{ROLE_LABEL[item.role]}</Badge>
                </td>
                <td className="px-4 py-4 hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {item.docs.map(d => (
                      <span key={d} className="text-xs px-2 py-0.5 rounded-full
                        dark:bg-[#1A1A1A] bg-[#F4F4F5]
                        dark:text-[#888] text-[#71717A]
                        dark:border-[#2A2A2A] border-[#E4E4E7] border">
                        {d}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-4 hidden sm:table-cell">
                  <div className="flex items-center gap-1.5 dark:text-[#888] text-[#71717A]">
                    <Clock size={12} />
                    <span className="text-xs">{item.submitted}</span>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {item.status === 'pending' && <Badge variant="warning" dot>Pending</Badge>}
                  {item.status === 'approved' && <Badge variant="success">Approved</Badge>}
                  {item.status === 'rejected' && <Badge variant="error">Rejected</Badge>}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-2 rounded-lg dark:text-[#888] dark:hover:text-white dark:hover:bg-[#2A2A2A]
                      text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5] transition-colors"
                      title="View documents">
                      <Eye size={14} />
                    </button>
                    {item.status === 'pending' && (
                      <>
                        <button className="p-2 rounded-lg text-[#22C55E] hover:bg-[#22C55E]/10 transition-colors" title="Approve">
                          <CheckCircle size={14} />
                        </button>
                        <button className="p-2 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors" title="Reject">
                          <XCircle size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl
        dark:bg-[#1A1A1A] bg-[#F4F4F5]
        dark:border-[#2A2A2A] border-[#E4E4E7] border">
        <ShieldCheck size={16} className="text-[#F97316] mt-0.5 shrink-0" />
        <p className="text-xs dark:text-[#888] text-[#71717A] leading-relaxed">
          KYC powered by <strong className="dark:text-white text-[#09090B]">Surepass</strong> — Aadhaar OTP, DL, RC Book, and GST verification via Vahan API. All documents cross-verified. Approve only after document + Vahan cross-check passes.
        </p>
      </div>
    </div>
  )
}
