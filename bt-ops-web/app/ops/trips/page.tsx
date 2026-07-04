import type { Metadata } from 'next'
import { Badge } from '@/components/badge'
import { MapPin, Navigation, Clock, Truck, Phone, AlertTriangle } from 'lucide-react'

export const metadata: Metadata = { title: 'Live Trips' }

const LIVE_TRIPS = [
  { id: 'BT-2041', shipper: 'Raj Textiles', driver: 'Suresh Kumar', driverPhone: '98765 43210', from: 'Dharavi, Mumbai', to: 'Kharadi, Pune', vehicle: 'HCV · MH-04-AB-1234', progress: 68, eta: '47 min', status: 'in_transit', weight: '4,200 kg', cargo: 'Textiles' },
  { id: 'BT-2042', shipper: 'Verma Foods', driver: 'Ramesh Singh', driverPhone: '87654 32109', from: 'Connaught Place, Delhi', to: 'Malviya Nagar, Jaipur', vehicle: 'LCV · DL-08-CD-5678', progress: 23, eta: '3h 12m', status: 'in_transit', weight: '1,800 kg', cargo: 'Perishables' },
  { id: 'BT-2043', shipper: 'Patel Pharma', driver: 'Mehul Patel', driverPhone: '76543 21098', from: 'GIDC, Ahmedabad', to: 'Surat Main Market', vehicle: 'Mini Truck · GJ-01-EF-9012', progress: 91, eta: '8 min', status: 'near_destination', weight: '600 kg', cargo: 'Pharma' },
  { id: 'BT-2044', shipper: 'Nair Spices', driver: 'Venkat Rao', driverPhone: '65432 10987', from: 'Koramangala, Bangalore', to: 'T. Nagar, Chennai', vehicle: 'HCV · KA-05-GH-3456', progress: 5, eta: '8h 40m', status: 'pickup_confirmed', weight: '6,000 kg', cargo: 'General' },
  { id: 'BT-2045', shipper: 'Gupta Metals', driver: 'Arvind Yadav', driverPhone: '54321 09876', from: 'Howrah, Kolkata', to: 'Patna Junction', vehicle: 'Trailer · WB-02-IJ-7890', progress: 44, eta: '2h 5m', status: 'in_transit', weight: '12,000 kg', cargo: 'Heavy Machinery' },
]

const STATUS_CONF: Record<string, { variant: 'accent'|'success'|'warning'|'info'|'muted'|'error'; label: string }> = {
  in_transit:        { variant: 'accent',  label: 'In Transit'    },
  near_destination:  { variant: 'success', label: 'Near Dest.'    },
  pickup_confirmed:  { variant: 'info',    label: 'Just Started'  },
}

export default function TripsPage() {
  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white text-[#09090B]">Live Trips</h1>
          <p className="text-sm dark:text-[#888] text-[#71717A] mt-1">
            34 active trips across 2 cities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
          <span className="text-sm font-medium text-[#22C55E]">Live tracking active</span>
        </div>
      </div>

      {/* Map placeholder */}
      <div className="relative w-full h-56 rounded-2xl overflow-hidden
        dark:bg-[#111111] bg-[#F4F4F5]
        dark:border-[#2A2A2A] border-[#E4E4E7] border
        flex items-center justify-center">
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(#F97316 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }} />
        {/* Mock route lines */}
        <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 800 224">
          <path d="M 80 180 Q 300 60 500 100 T 720 80" stroke="#F97316" strokeWidth="2" fill="none" strokeDasharray="6 3" />
          <path d="M 120 160 Q 250 40 600 120" stroke="#3B82F6" strokeWidth="2" fill="none" strokeDasharray="6 3" />
          <circle cx="80" cy="180" r="5" fill="#F97316" />
          <circle cx="720" cy="80" r="5" fill="#F97316" />
          <circle cx="500" cy="100" r="8" fill="#F97316" className="animate-ping" opacity="0.5" />
        </svg>
        <div className="relative text-center">
          <MapPin size={24} className="text-[#F97316] mx-auto mb-2" />
          <p className="text-sm font-medium dark:text-white text-[#09090B]">Live Map</p>
          <p className="text-xs dark:text-[#888] text-[#71717A]">Google Maps integration · Sprint 3</p>
        </div>
      </div>

      {/* Trips list */}
      <div className="space-y-3">
        {LIVE_TRIPS.map(trip => (
          <div key={trip.id}
            className="dark:bg-[#111111] bg-white rounded-2xl border dark:border-[#2A2A2A] border-[#E4E4E7] p-5
              hover:dark:border-[#3A3A3A] hover:border-[#D4D4D8] transition-all">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F97316]/10 flex items-center justify-center">
                  <Truck size={16} className="text-[#F97316]" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold dark:text-white text-[#09090B]">{trip.id}</span>
                    <Badge variant={STATUS_CONF[trip.status].variant} dot>
                      {STATUS_CONF[trip.status].label}
                    </Badge>
                    {trip.cargo === 'Perishables' && (
                      <span className="text-[10px] bg-[#FBBF24]/10 text-[#FBBF24] px-1.5 py-0.5 rounded-full font-semibold border border-[#FBBF24]/20">
                        PERISHABLE
                      </span>
                    )}
                  </div>
                  <p className="text-xs dark:text-[#888] text-[#71717A] mt-0.5">{trip.shipper} · {trip.cargo} · {trip.weight}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 dark:text-[#888] text-[#71717A] shrink-0">
                <Clock size={12} />
                <span className="text-xs font-medium">ETA {trip.eta}</span>
              </div>
            </div>

            {/* Route */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
                  <p className="text-xs dark:text-white text-[#09090B] font-medium truncate">{trip.from}</p>
                </div>
                <div className="ml-1 w-px h-4 dark:bg-[#2A2A2A] bg-[#E4E4E7] my-0.5" />
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#F97316] shrink-0" />
                  <p className="text-xs dark:text-white text-[#09090B] font-medium truncate">{trip.to}</p>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs dark:text-[#888] text-[#71717A]">Progress</span>
                <span className="text-xs font-semibold dark:text-white text-[#09090B]">{trip.progress}%</span>
              </div>
              <div className="w-full h-1.5 dark:bg-[#2A2A2A] bg-[#E4E4E7] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F97316] rounded-full transition-all"
                  style={{ width: `${trip.progress}%` }} />
              </div>
            </div>

            {/* Driver + actions */}
            <div className="flex items-center justify-between pt-3 border-t dark:border-[#1A1A1A] border-[#F4F4F5]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full dark:bg-[#1A1A1A] bg-[#F4F4F5] flex items-center justify-center text-[10px] font-bold dark:text-white text-[#09090B]">
                  {trip.driver[0]}
                </div>
                <span className="text-xs dark:text-[#888] text-[#71717A]">{trip.driver}</span>
                <span className="text-xs dark:text-[#555] text-[#A1A1AA]">·</span>
                <span className="text-xs dark:text-[#555] text-[#A1A1AA]">{trip.vehicle}</span>
              </div>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:text-[#888] text-[#71717A]
                  dark:hover:text-white hover:text-[#09090B] transition-colors
                  dark:border-[#2A2A2A] border-[#E4E4E7] border">
                  <Phone size={11} /> {trip.driverPhone}
                </button>
                <button className="p-1.5 rounded-lg text-[#FBBF24] hover:bg-[#FBBF24]/10 transition-colors" title="Flag trip">
                  <AlertTriangle size={13} />
                </button>
                <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium
                  dark:bg-[#1A1A1A] bg-[#F4F4F5] dark:text-white text-[#09090B]
                  dark:border-[#2A2A2A] border-[#E4E4E7] border
                  hover:border-[#F97316] transition-colors">
                  <Navigation size={11} /> Track
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
