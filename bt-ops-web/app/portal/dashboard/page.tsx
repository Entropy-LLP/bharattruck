import type { Metadata } from 'next'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/badge'
import { Truck, Users, IndianRupee, TrendingUp, CheckCircle, Clock, AlertTriangle } from 'lucide-react'

export const metadata: Metadata = { title: 'Fleet Portal' }

const VEHICLES = [
  { reg: 'MH-04-AB-1234', type: 'HCV', driver: 'Suresh Kumar', status: 'active', lastTrip: '30 min ago', trips: 142, earnings: '₹3.2L' },
  { reg: 'MH-04-CD-5678', type: 'LCV', driver: 'Ramesh Patil', status: 'idle', lastTrip: '2 hrs ago', trips: 89, earnings: '₹1.8L' },
  { reg: 'MH-04-EF-9012', type: 'Mini Truck', driver: 'Unassigned', status: 'maintenance', lastTrip: '3 days ago', trips: 67, earnings: '₹1.1L' },
  { reg: 'MH-04-GH-3456', type: 'HCV', driver: 'Vijay Shinde', status: 'active', lastTrip: '1 hr ago', trips: 201, earnings: '₹4.5L' },
]

const STATUS_CONF: Record<string, { variant: 'success'|'warning'|'error'|'accent'|'muted'|'info'; label: string; dot?: boolean }> = {
  active:      { variant: 'success', label: 'Active',      dot: true },
  idle:        { variant: 'muted',   label: 'Idle'         },
  maintenance: { variant: 'warning', label: 'Maintenance'  },
}

export default function FleetDashboard() {
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">Fleet Dashboard</h1>
          <Badge variant="success" dot>Verified Fleet</Badge>
        </div>
        <p className="text-sm dark:text-[#888] text-[#71717A]">
          Surya Fleet Pvt Ltd · GST: 27AABCS1429B1ZB
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Vehicles" value="4" sub="3 active, 1 in maintenance" icon={Truck} accent />
        <StatCard label="Active Drivers" value="3" icon={Users} trend={{ value: '1', up: true }} />
        <StatCard label="Revenue (Month)" value="₹10.6L" icon={IndianRupee} trend={{ value: '18%', up: true }} />
        <StatCard label="Utilisation" value="78%" sub="Target: 80%" icon={TrendingUp} trend={{ value: '5%', up: true }} />
      </div>

      {/* Vehicles table */}
      <div className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7]">
        <div className="px-5 py-4 border-b dark:border-[#2A2A2A] border-[#E4E4E7] flex items-center justify-between">
          <h2 className="font-semibold dark:text-white text-[#09090B]">My Vehicles</h2>
          <button className="text-xs font-medium text-[#F97316] hover:underline">
            + Add Vehicle
          </button>
        </div>
        <div className="divide-y dark:divide-[#1A1A1A] divide-[#F4F4F5]">
          {VEHICLES.map(v => (
            <div key={v.reg}
              className="px-5 py-4 flex items-center gap-4 hover:dark:bg-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">
              <div className="w-10 h-10 rounded-xl dark:bg-[#1A1A1A] bg-[#F4F4F5] flex items-center justify-center shrink-0">
                <Truck size={16} className="dark:text-[#888] text-[#71717A]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold dark:text-white text-[#09090B] font-mono">{v.reg}</p>
                  <span className="text-xs dark:text-[#888] text-[#71717A]">{v.type}</span>
                </div>
                <p className="text-xs dark:text-[#888] text-[#71717A] mt-0.5">{v.driver}</p>
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-sm font-semibold dark:text-white text-[#09090B]">{v.earnings}</p>
                <p className="text-xs dark:text-[#888] text-[#71717A]">{v.trips} trips</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_CONF[v.status].variant} dot={STATUS_CONF[v.status].dot}>
                  {STATUS_CONF[v.status].label}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 dark:text-[#555] text-[#A1A1AA] hidden md:flex">
                <Clock size={11} />
                <span className="text-xs">{v.lastTrip}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div className="dark:bg-[#1A1A1A] bg-[#FFF7ED] rounded-2xl border dark:border-[#2A2A2A] border-[#FDBA74]/30 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-[#FBBF24] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold dark:text-white text-[#09090B] mb-1">Upcoming Expiries</p>
            <div className="space-y-1">
              <p className="text-xs dark:text-[#888] text-[#71717A]">
                <span className="font-medium dark:text-[#FBBF24] text-[#D97706]">MH-04-EF-9012</span> — Vehicle PUC expires in 12 days
              </p>
              <p className="text-xs dark:text-[#888] text-[#71717A]">
                <span className="font-medium dark:text-[#FBBF24] text-[#D97706]">Ramesh Patil</span> — Driving License renewal due in 45 days
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
