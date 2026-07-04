import type { Metadata } from 'next'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/badge'
import {
  Truck, Users, IndianRupee, MapPin,
  ShieldCheck, TrendingUp, Clock, AlertCircle
} from 'lucide-react'

export const metadata: Metadata = { title: 'Dashboard' }

const RECENT_BOOKINGS = [
  { id: 'BT-2041', shipper: 'Raj Textiles', route: 'Mumbai → Pune', driver: 'Suresh Kumar', amount: '₹4,200', status: 'in_transit' },
  { id: 'BT-2040', shipper: 'Sharma Exports', route: 'Delhi → Jaipur', driver: 'Ramesh Singh', amount: '₹7,800', status: 'delivered' },
  { id: 'BT-2039', shipper: 'Patel Agro', route: 'Ahmedabad → Surat', driver: 'Mehul Patel', amount: '₹3,500', status: 'pending' },
  { id: 'BT-2038', shipper: 'Kapoor Logistics', route: 'Bangalore → Chennai', driver: 'Venkat Rao', amount: '₹9,200', status: 'delivered' },
  { id: 'BT-2037', shipper: 'Singh Traders', route: 'Kolkata → Patna', driver: 'Arvind Yadav', amount: '₹5,600', status: 'cancelled' },
]

const STATUS_BADGE: Record<string, { variant: 'success'|'warning'|'error'|'info'|'muted'|'accent'; label: string }> = {
  in_transit: { variant: 'accent',  label: 'In Transit' },
  delivered:  { variant: 'success', label: 'Delivered'  },
  pending:    { variant: 'warning', label: 'Pending'    },
  cancelled:  { variant: 'error',   label: 'Cancelled'  },
}

const KYC_QUEUE = [
  { name: 'Ravi Shankar', role: 'Driver', doc: 'Driving License', time: '2 min ago' },
  { name: 'Anjali Mehta', role: 'Shipper', doc: 'Aadhaar + PAN', time: '14 min ago' },
  { name: 'Surya Fleet Pvt Ltd', role: 'Fleet Owner', doc: 'GST + Company PAN', time: '31 min ago' },
]

export default function OpsDashboard() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">
            Good morning, Ops Team 👋
          </h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            Monday, 30 March 2026 · Mumbai
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl
          dark:bg-[#22C55E]/10 bg-[#22C55E]/10
          dark:border-[#22C55E]/20 border-[#22C55E]/20 border">
          <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
          <span className="text-sm font-medium text-[#22C55E]">Platform Live</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Trips" value="34" sub="Across 2 cities" icon={MapPin}
          trend={{ value: '12%', up: true }} accent />
        <StatCard label="Total Users" value="1,248" sub="218 drivers · 1,030 shippers" icon={Users}
          trend={{ value: '8%', up: true }} />
        <StatCard label="GMV Today" value="₹2.4L" sub="↑ from ₹1.9L yesterday" icon={IndianRupee}
          trend={{ value: '26%', up: true }} />
        <StatCard label="KYC Pending" value="12" sub="3 flagged for review" icon={ShieldCheck}
          trend={{ value: '3', up: false }} />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Bookings Today" value="89" icon={Truck} trend={{ value: '5%', up: true }} />
        <StatCard label="Completion Rate" value="96.2%" icon={TrendingUp} trend={{ value: '1.1%', up: true }} />
        <StatCard label="Avg Match Time" value="4m 12s" sub="Target: &lt;5 min" icon={Clock} />
        <StatCard label="Open Disputes" value="3" icon={AlertCircle} trend={{ value: '2', up: false }} />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent bookings */}
        <div className="lg:col-span-2 dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7]">
          <div className="px-5 py-4 flex items-center justify-between border-b dark:border-[#2A2A2A] border-[#E4E4E7]">
            <h2 className="font-semibold dark:text-white text-[#09090B]">Recent Bookings</h2>
            <a href="/ops/trips" className="text-xs text-[#F97316] hover:underline font-medium">View all →</a>
          </div>
          <div className="divide-y dark:divide-[#1A1A1A] divide-[#F4F4F5]">
            {RECENT_BOOKINGS.map(b => (
              <div key={b.id} className="px-5 py-3.5 flex items-center gap-4 hover:dark:bg-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">
                <div className="w-16 text-xs font-mono dark:text-[#555] text-[#A1A1AA]">{b.id}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium dark:text-white text-[#09090B] truncate">{b.shipper}</p>
                  <p className="text-xs dark:text-[#888] text-[#71717A] truncate">{b.route}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold dark:text-white text-[#09090B]">{b.amount}</p>
                  <p className="text-xs dark:text-[#888] text-[#71717A]">{b.driver}</p>
                </div>
                <Badge variant={STATUS_BADGE[b.status].variant}>
                  {STATUS_BADGE[b.status].label}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* KYC queue */}
        <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7]">
          <div className="px-5 py-4 flex items-center justify-between border-b dark:border-[#2A2A2A] border-[#E4E4E7]">
            <h2 className="font-semibold dark:text-white text-[#09090B]">KYC Queue</h2>
            <Badge variant="warning">12 pending</Badge>
          </div>
          <div className="divide-y dark:divide-[#1A1A1A] divide-[#F4F4F5]">
            {KYC_QUEUE.map((item, i) => (
              <div key={i} className="px-5 py-4 hover:dark:bg-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors cursor-pointer">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium dark:text-white text-[#09090B]">{item.name}</p>
                  <Badge variant="muted">{item.role}</Badge>
                </div>
                <p className="text-xs dark:text-[#888] text-[#71717A] mb-2">{item.doc}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs dark:text-[#555] text-[#A1A1AA]">{item.time}</p>
                  <button className="text-xs text-[#F97316] font-medium hover:underline">Review →</button>
                </div>
              </div>
            ))}
            <div className="px-5 py-3 text-center">
              <a href="/ops/kyc" className="text-xs text-[#F97316] hover:underline font-medium">
                See all 12 pending →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
